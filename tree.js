(function(){
  // ---------- State ----------
  // person: {id, name, photo, parents:[id,id], partners:[{id,status}],
  //          dob, dod, ethnicity, location, bio, gallery:[url,...]}
  let people = [];
  let events = []; // global life events, each optionally shared by several people
  let nextId = 1;
  let title = 'Family Tree';
  let subtitle = 'a quiet record of who belongs to whom';
  let editingId = null;
  let quickMode = null; // {type:'child'|'partner', from:id}
  let pendingPhoto = null;
  let pendingGallery = [];
  function emptyCapsule(){
    return {traits:[], quotes:[], hobbies:[], songs:[], voice:[], videos:[], recipes:[], handwriting:[], documents:[]};
  }
  let pendingCapsule = emptyCapsule();
  let pendingPlaces = [];
  let placeKind = 'lived'; // which Places tab is selected
  let pendingEvents = [];
  let mode = 'tree';
  let zoom = 0.85;
  let pan = {x:0, y:0};
  let lastPositions = {}; // positions from the most recent render, used by search to focus a person
  let threeMounted = false;
  const threeHost = document.getElementById('threeHost');

  const stage = document.getElementById('stage');
  const linesSvg = document.getElementById('lines');
  const nodesLayer = document.getElementById('nodes');
  const viewport = document.getElementById('viewport');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyText = document.getElementById('emptyText');
  const emptyAdd = document.getElementById('emptyAdd');
  const legend = document.getElementById('legend');
  const addPersonBtn = document.getElementById('addPersonBtn');
  const titleMark = document.getElementById('titleMark');

  const ROW_H = 190;
  const NODE_W = 132;        // must match .node width in style.css
  const EX_NODE_W = 96;      // smaller card for a docked divorced ex co-parent — must match .node.secondary width in style.css
  // Circle mode uses a deliberately compact card (avatar + name only, see
  // .viewport.mode-circle .node in style.css). Ring radius is derived from
  // card footprint, so a narrower card shrinks the whole circle — which is
  // what actually lets everything render bigger on screen instead of being
  // zoomed out to fit a huge diagram.
  const CIRCLE_NODE_W = 86;
  const CIRCLE_EX_NODE_W = 68;
  function nodeW(){ return mode==='circle' ? CIRCLE_NODE_W : NODE_W; }
  function exNodeW(){ return mode==='circle' ? CIRCLE_EX_NODE_W : EX_NODE_W; }
  function siblingGap(){ return mode==='circle' ? CIRCLE_SIBLING_GAP : SIBLING_GAP; }
  function partnerGap(){ return mode==='circle' ? 22 : PARTNER_GAP; }
  const EX_GAP = 26;         // gap between the primary couple and a docked ex slot
  const PARTNER_GAP = 40;    // gap between two partners sitting side by side
  const SIBLING_GAP = 56;    // gap between adjacent sibling/cousin branches
  const FAMILY_GAP = 130;    // extra gap between unrelated (disconnected) family trees
  const RADIAL_BASE = 80;    // starting radius for the oldest generation in circle mode
  const RING_GAP = 120;      // minimum radius added per generation in circle mode (actual gap grows if a ring is crowded)
  const RADIAL_SAFETY_GAP = 14; // minimum breathing room between angularly-adjacent cards on the same ring
  const CIRCLE_SIBLING_GAP = 40; // tighter angular sibling gap in circle mode
  const CONSTELLATION_BASE = 520;      // radius of the first descendant shell
  const CONSTELLATION_SHELL_GAP = 560; // radius added per generation shell
  const CONSTELLATION_MIN_SEP = 210;   // hard minimum pixel gap between any two people in 3D
  const FOCAL = 900;                   // perspective focal length for the 3D projection
  let camRotX = 0.35, camRotY = 0.6;   // 3D camera orientation for constellation mode
  const AVATAR_COLORS = ['#2f4a3c','#5a6e8c','#8c6a4f','#7a5a7c','#3c6e6a','#8c5a4f'];

  function colorFor(name){
    let h=0; for(let i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h);
    return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length];
  }
  function initials(name){
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase();
  }
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatDate(d){
    if(!d) return '';
    try{ return new Date(d+'T00:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}); }
    catch(e){ return d; }
  }
  function yearOf(d){
    if(!d) return null;
    const y = new Date(d+'T00:00:00').getFullYear();
    return Number.isFinite(y) ? y : null;
  }
  function ageLabel(p){
    const dobYear = yearOf(p.dob);
    const dodYear = yearOf(p.dod);
    if(dobYear && dodYear) return `${dobYear}\u2013${dodYear}`;
    if(dobYear && !dodYear){
      const dob = new Date(p.dob+'T00:00:00');
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const hadBirthdayThisYear = (today.getMonth()>dob.getMonth()) ||
        (today.getMonth()===dob.getMonth() && today.getDate()>=dob.getDate());
      if(!hadBirthdayThisYear) age--;
      return age>=0 ? String(age) : '';
    }
    if(!dobYear && dodYear) return `d. ${dodYear}`;
    return '';
  }

  // ---------- Server sync ----------
  async function loadTree(){
    try{
      const res = await fetch(Auth.apiUrl('api/tree.php'), {credentials:'include'});
      const data = await res.json();
      title = data.title || title;
      subtitle = data.subtitle || subtitle;
      people = data.people || [];
      nextId = data.nextId || (people.reduce((m,p)=>Math.max(m,p.id),0)+1);
      if(Array.isArray(data.events)){
        events = data.events;
      } else {
        // Migrating from the old per-person events format: each person's
        // own events[] becomes an independent global event tagged with
        // just that one person, rather than trying to guess which events
        // from different people were "the same" occasion.
        events = [];
        people.forEach(p=>{
          (p.events||[]).forEach(ev=>{
            events.push({id: ev.id || ('ev_'+Math.random().toString(36).slice(2)), title: ev.title,
              date: ev.date, description: ev.description||'', people:[p.id]});
          });
          delete p.events;
        });
      }
    }catch(e){
      console.error('Could not load tree data', e);
    }
    titleMark.textContent = title;
    document.getElementById('subtitleMark').textContent = subtitle;
    render();
  }

  async function saveTree(){
    try{
      const res = await fetch(Auth.apiUrl('api/tree.php'), {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({title, subtitle, people, events, nextId})
      });
      if(res.status===401){
        alert('Your session expired. Please sign in again to save changes.');
        Auth.openLogin();
        return false;
      }
      if(!res.ok){
        const d = await res.json().catch(()=>({}));
        alert(d.error || 'Could not save changes.');
        return false;
      }
      return true;
    }catch(e){
      alert('Could not reach the server to save changes.');
      return false;
    }
  }

  // ---------- Image upload / cropping ----------
  const cropOverlay = document.getElementById('cropOverlay');
  const cropImage = document.getElementById('cropImage');
  let cropper = null;
  let cropDoneCallback = null;

  function openCropper(file, {aspect=1, onDone}){
    const reader = new FileReader();
    reader.onload = ev=>{
      cropImage.src = ev.target.result;
      cropOverlay.classList.add('show');
      cropDoneCallback = onDone;
      if(cropper) cropper.destroy();
      cropper = new Cropper(cropImage, {
        aspectRatio: aspect, viewMode:1, background:false,
        autoCropArea:0.9, movable:true, zoomable:true, scalable:false,
      });
    };
    reader.readAsDataURL(file);
  }
  document.getElementById('cropSquare').onclick = ()=>{ if(cropper) cropper.setAspectRatio(1); };
  document.getElementById('cropFree').onclick = ()=>{ if(cropper) cropper.setAspectRatio(NaN); };
  document.getElementById('cropCancel').onclick = closeCropper;
  function closeCropper(){
    cropOverlay.classList.remove('show');
    if(cropper){ cropper.destroy(); cropper=null; }
    cropDoneCallback = null;
  }
  document.getElementById('cropConfirm').onclick = async ()=>{
    if(!cropper) return;
    const canvas = cropper.getCroppedCanvas({maxWidth:1000, maxHeight:1000, imageSmoothingQuality:'high'});
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const cb = cropDoneCallback;
    closeCropper();
    if(cb) await cb(dataUrl);
  };

  async function uploadImage(dataUrl){
    const res = await fetch(Auth.apiUrl('api/upload.php'), {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({image:dataUrl})
    });
    if(res.status===401){ alert('Please sign in again.'); Auth.openLogin(); return null; }
    const data = await res.json();
    if(!res.ok){ alert(data.error||'Upload failed.'); return null; }
    return data.url;
  }

  // ---------- Auth-gated UI ----------
  Auth.onChange(authed=>{
    document.body.classList.toggle('locked', !authed);
    addPersonBtn.style.display = authed ? 'flex' : 'none';
    titleMark.classList.toggle('editable', authed);
  });

  titleMark.addEventListener('click', ()=>{
    if(!Auth.isAuthed()) return;
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'title-edit'; input.value = title;
    titleMark.replaceWith(input);
    input.focus(); input.select();
    const commit = async ()=>{
      const val = input.value.trim() || 'Family Tree';
      title = val; titleMark.textContent = title;
      input.replaceWith(titleMark);
      await saveTree();
    };
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); if(e.key==='Escape'){ input.value=title; input.blur(); } });
    input.addEventListener('blur', commit);
  });

  // ---------- Generation computation ----------
  // Determines which row (generation) each person sits on. Kept close to the
  // original approach; `visiting` guards against malformed/cyclic parent data
  // (e.g. someone accidentally recorded as their own ancestor) so a bad edit
  // can't hang the page.
  function computeGenerations(){
    const gen = {}; const visiting = new Set();
    function genOf(id){
      if(gen[id]!==undefined) return gen[id];
      if(visiting.has(id)) return gen[id]=0;
      visiting.add(id);
      const p = people.find(p=>p.id===id);
      let g=0;
      if(p.parents.length){
        g = Math.max(...p.parents.map(pid=> people.find(pp=>pp.id===pid) ? genOf(pid)+1 : 0));
      } else if(p.partners.length){
        const firstValid = p.partners.find(pt=>people.find(pp=>pp.id===pt.id));
        if(firstValid) g = genOf(firstValid.id);
      }
      visiting.delete(id);
      return gen[id]=g;
    }
    people.forEach(p=>genOf(p.id));
    return gen;
  }

  // ---------- Layout ----------
  // Two view modes share the same "who belongs with whom" logic (pairing
  // partners, docking exes, ordering siblings, computing subtree weights)
  // and only differ in how that gets turned into on-screen coordinates:
  // - "tree": the original left-to-right generational layout.
  // - "circle": a radial layout, oldest ancestors at the center, each
  //   generation forming a ring further out.
  //
  // Known limitation: if someone's spouse "married in" but also has their
  // own recorded ancestors elsewhere in the tree, that spouse's ancestor
  // branch can only be anchored under one side of the marriage — a true
  // general solution is a much harder graph-layout problem. It still
  // renders without overlap or crashing; it just won't always be
  // perfectly centered in that specific case.
  function buildUnits(){
    const gen = computeGenerations();
    const byId = new Map(people.map(p=>[p.id,p]));

    // Primary pairing: current/non-divorced partner preferred.
    const claimed = new Set();
    const unitPartnerOf = new Map();
    people.forEach(p=>{
      if(claimed.has(p.id)) return;
      const candidates = p.partners.filter(pt=>byId.has(pt.id) && !claimed.has(pt.id));
      if(!candidates.length) return;
      const preferred = candidates.find(pt=>pt.status!=='divorced') || candidates[0];
      unitPartnerOf.set(p.id, preferred.id);
      unitPartnerOf.set(preferred.id, p.id);
      claimed.add(p.id); claimed.add(preferred.id);
    });

    // Find co-parents who share a child but aren't paired as each other's
    // primary partner (typically: an ex, once someone has remarried). These
    // get "docked" next to their co-parent's unit instead of becoming an
    // unrelated root positioned wherever the layout happens to put them.
    const dockedTo = new Map(); // exId -> anchorId
    people.forEach(child=>{
      const validParents = child.parents.filter(pid=>byId.has(pid));
      if(validParents.length!==2) return;
      const [p1,p2] = validParents;
      if(unitPartnerOf.get(p1)===p2) return; // already a shared primary pair
      const p1Solo = !unitPartnerOf.has(p1), p2Solo = !unitPartnerOf.has(p2);
      let anchorId=null, exId=null;
      if(p2Solo && !p1Solo){ anchorId=p1; exId=p2; }
      else if(p1Solo && !p2Solo){ anchorId=p2; exId=p1; }
      else if(p1Solo && p2Solo){ anchorId=p1; exId=p2; }
      if(anchorId==null) return; // both already primary-paired with other people — rare, unresolved
      if(!dockedTo.has(exId)) dockedTo.set(exId, anchorId);
    });

    // Build primary units, skipping anyone who'll be docked instead.
    const personToUnit = new Map();
    const units = [];
    const seenP = new Set();
    people.forEach(p=>{
      if(seenP.has(p.id) || dockedTo.has(p.id)) return;
      const partnerId = unitPartnerOf.get(p.id);
      const ids = partnerId!=null ? [p.id, partnerId] : [p.id];
      ids.forEach(id=>seenP.add(id));
      const unit = {ids, secondary:[]};
      units.push(unit);
      ids.forEach(id=>personToUnit.set(id, unit));
    });

    // Attach docked exes to their anchor's unit as a secondary slot. Only
    // relationships actually recorded as 'divorced' render smaller —
    // docking still happens for any non-primary co-parent so nobody gets
    // flung off screen, but sizing follows the real relationship status.
    // "side" records which member of the primary pair the anchor actually
    // is, so the ex docks next to the right person, not past the couple.
    const secondaryIds = new Set();
    dockedTo.forEach((anchorId, exId)=>{
      const anchorUnit = personToUnit.get(anchorId);
      if(!anchorUnit){
        if(!personToUnit.has(exId)){
          const unit = {ids:[exId], secondary:[]};
          units.push(unit); personToUnit.set(exId, unit);
        }
        return;
      }
      const rel = byId.get(anchorId).partners.find(pt=>pt.id===exId);
      let side = anchorUnit.ids.indexOf(anchorId);
      if(side<0) side = 0;
      anchorUnit.secondary.push({exId, kids:[], small: rel && rel.status==='divorced', side});
      personToUnit.set(exId, anchorUnit);
      secondaryIds.add(exId);
    });

    // Attach each child to the right place: the shared primary pair, a
    // specific secondary/ex slot, or (single-parent case) that parent's unit.
    function findUnitForChild(child){
      const validParents = child.parents.filter(pid=>byId.has(pid));
      if(!validParents.length) return null;
      if(validParents.length===2){
        const [p1,p2] = validParents;
        const u1 = personToUnit.get(p1);
        if(u1 && u1.ids.includes(p2)) return {unit:u1, slot:null};
        const u2 = personToUnit.get(p2);
        if(u1){ const slot = u1.secondary.find(s=>s.exId===p2); if(slot) return {unit:u1, slot}; }
        if(u2){ const slot = u2.secondary.find(s=>s.exId===p1); if(slot) return {unit:u2, slot}; }
      }
      for(const pid of validParents){
        const u = personToUnit.get(pid);
        if(u) return {unit:u, slot:null};
      }
      return null;
    }
    const unitChildren = new Map();
    people.forEach(p=>{
      if(!p.parents.length) return;
      const found = findUnitForChild(p);
      if(!found) return;
      if(found.slot){ found.slot.kids.push(p.id); }
      else {
        if(!unitChildren.has(found.unit)) unitChildren.set(found.unit, []);
        unitChildren.get(found.unit).push(p.id);
      }
    });
    // Order each sibling group oldest-to-youngest by date of birth. Anyone
    // without a recorded dob is placed after their dated siblings.
    function sortKids(kids){
      kids.sort((a,b)=>{
        const da = byId.get(a).dob, db = byId.get(b).dob;
        if(da && db) return da<db ? -1 : da>db ? 1 : 0;
        if(da && !db) return -1;
        if(!da && db) return 1;
        return 0;
      });
    }
    unitChildren.forEach(sortKids);
    units.forEach(u=>u.secondary.forEach(s=>sortKids(s.kids)));

    // Bottom-up: how much horizontal "weight" does each unit need, including
    // its primary children plus any docked ex slots (each on its own side)
    // and their own children? This is used as literal pixel width in "tree"
    // mode and as a proportional share of the full circle in "circle" mode.
    const widthCache = new Map();
    function slotOwnKidsWidth(slot, visiting){
      let w = 0;
      slot.kids.forEach(cid=>{ const cu = personToUnit.get(cid); if(cu) w += unitWidth(cu, visiting); });
      if(slot.kids.length>1) w += (slot.kids.length-1)*siblingGap();
      const own = slot.small ? exNodeW() : nodeW();
      return Math.max(own, w);
    }
    function unitWidth(unit, visiting){
      if(widthCache.has(unit)) return widthCache.get(unit);
      if(visiting.has(unit)) return nodeW();
      visiting.add(unit);
      const kids = unitChildren.get(unit) || [];
      let childrenTotal = 0;
      kids.forEach(cid=>{
        const cu = personToUnit.get(cid);
        if(cu) childrenTotal += unitWidth(cu, visiting);
      });
      if(kids.length>1) childrenTotal += (kids.length-1)*siblingGap();
      const ownWidth = unit.ids.length===2 ? nodeW()*2+partnerGap() : nodeW();
      const primaryBlockWidth = Math.max(ownWidth, childrenTotal);
      let leftTotal = 0, rightTotal = 0;
      unit.secondary.forEach(slot=>{
        slot._width = slotOwnKidsWidth(slot, visiting);
        if(slot.side===0) leftTotal += slot._width + EX_GAP;
        else rightTotal += slot._width + EX_GAP;
      });
      const w = leftTotal + primaryBlockWidth + rightTotal;
      visiting.delete(unit);
      widthCache.set(unit, w);
      unit._primaryBlockWidth = primaryBlockWidth;
      unit._leftTotal = leftTotal;
      unit._rightTotal = rightTotal;
      unit._ownWidth = ownWidth;
      return w;
    }
    units.forEach(u=>unitWidth(u, new Set()));

    // Roots: units where nobody has a recorded parent.
    const rootUnits = units.filter(u=>!u.ids.some(id=>byId.get(id).parents.length>0));

    return {gen, byId, personToUnit, units, unitChildren, unitWidth, rootUnits, secondaryIds};
  }

  // "tree" mode: top-down, generations as rows, x is a plain pixel offset.
  // Every person gets dirX:0, dirY:1 ("flowing downward") so the branch-line
  // curve code below can treat both modes the same way.
  function layoutLinear(){
    const ctx = buildUnits();
    const {gen, personToUnit, unitChildren, unitWidth, rootUnits, secondaryIds} = ctx;

    const positioned = new Set();
    const centerXOf = new Map();
    const exCenterX = new Map();
    function assignChildrenRow(kids, centerX){
      const totalW = kids.reduce((s,cid)=>{
        const cu = personToUnit.get(cid);
        return s + (cu ? unitWidth(cu, new Set()) : 0);
      }, 0) + Math.max(0, kids.length-1)*siblingGap();
      let cx = centerX - totalW/2;
      kids.forEach(cid=>{
        const cu = personToUnit.get(cid);
        if(!cu) return;
        const cw = unitWidth(cu, new Set());
        assignX(cu, cx);
        cx += cw + siblingGap();
      });
    }
    function assignX(unit, startX){
      if(positioned.has(unit)) return; // already placed (rare DAG merge) or a cycle
      positioned.add(unit);
      unitWidth(unit, new Set());
      const primaryStartX = startX + unit._leftTotal;
      const primaryCenterX = primaryStartX + unit._primaryBlockWidth/2;
      centerXOf.set(unit, primaryCenterX);
      assignChildrenRow(unitChildren.get(unit) || [], primaryCenterX);

      function anchorXFor(side){
        if(unit.ids.length===2){
          return side===0 ? primaryCenterX-(nodeW()+partnerGap())/2 : primaryCenterX+(nodeW()+partnerGap())/2;
        }
        return primaryCenterX;
      }
      let leftCursor = primaryStartX;
      unit.secondary.filter(s=>s.side===0).forEach(slot=>{
        leftCursor -= EX_GAP;
        const exCx = leftCursor - slot._width/2;
        exCenterX.set(slot, exCx);
        assignChildrenRow(slot.kids, (anchorXFor(0)+exCx)/2);
        leftCursor -= slot._width;
      });
      let rightCursor = primaryStartX + unit._primaryBlockWidth;
      unit.secondary.filter(s=>s.side!==0).forEach(slot=>{
        rightCursor += EX_GAP;
        const exCx = rightCursor + slot._width/2;
        exCenterX.set(slot, exCx);
        assignChildrenRow(slot.kids, (anchorXFor(1)+exCx)/2);
        rightCursor += slot._width;
      });
    }
    let cursorX = 0;
    rootUnits.forEach(u=>{
      const w = unitWidth(u, new Set());
      assignX(u, cursorX);
      cursorX += w + FAMILY_GAP;
    });
    ctx.units.forEach(u=>{
      if(!positioned.has(u)){
        const w = unitWidth(u, new Set());
        assignX(u, cursorX);
        cursorX += w + FAMILY_GAP;
      }
    });

    const rawPositions = {};
    ctx.units.forEach(u=>{
      const cx = centerXOf.get(u);
      if(u.ids.length===2){
        rawPositions[u.ids[0]] = {x: cx-(nodeW()+partnerGap())/2, y: gen[u.ids[0]]*ROW_H, gen: gen[u.ids[0]], dirX:0, dirY:1};
        rawPositions[u.ids[1]] = {x: cx+(nodeW()+partnerGap())/2, y: gen[u.ids[1]]*ROW_H, gen: gen[u.ids[1]], dirX:0, dirY:1};
      } else {
        rawPositions[u.ids[0]] = {x: cx, y: gen[u.ids[0]]*ROW_H, gen: gen[u.ids[0]], dirX:0, dirY:1};
      }
      u.secondary.forEach(slot=>{
        rawPositions[slot.exId] = {x: exCenterX.get(slot), y: gen[slot.exId]*ROW_H, gen: gen[slot.exId], dirX:0, dirY:1};
      });
    });
    const allX = Object.values(rawPositions).map(p=>p.x);
    const centerShift = allX.length ? (Math.min(...allX)+Math.max(...allX))/2 : 0;
    const positions = {};
    Object.keys(rawPositions).forEach(id=>{
      const p = rawPositions[id];
      positions[id] = {...p, x: p.x-centerShift};
    });
    return {positions, secondaryIds};
  }

  // "circle" mode: oldest ancestors at the center, each generation forming
  // a ring further out. Uses the exact same recursive weighting as "tree"
  // mode to assign ANGLES (proportional slices of the full circle instead
  // of pixel width) — but each ring's RADIUS is computed dynamically from
  // the actual angular density at that ring, not a fixed step. Since arc
  // length = radius × angle, a fixed radius-per-generation can't guarantee
  // safe spacing: the same angular slice that's roomy on an outer ring
  // becomes cramped on an inner one. Deriving the radius from the real
  // angles assigned (rather than guessing a constant) is what actually
  // rules out overlap, for any tree shape.
  function layoutRadial(){
    const ctx = buildUnits();
    const {gen, personToUnit, unitChildren, unitWidth, rootUnits, secondaryIds} = ctx;

    const totalRootWeight = rootUnits.reduce((s,u)=>s+unitWidth(u, new Set()), 0) + rootUnits.length*FAMILY_GAP;
    const radPerUnit = totalRootWeight>0 ? (2*Math.PI)/totalRootWeight : 0;

    const positioned = new Set();
    const angleOf = new Map();
    const exAngleOf = new Map();

    function assignChildrenArc(kids, centerAngle){
      const totalW = kids.reduce((s,cid)=>{
        const cu = personToUnit.get(cid);
        return s + (cu ? unitWidth(cu, new Set()) : 0);
      }, 0) + Math.max(0, kids.length-1)*siblingGap();
      const totalAngle = totalW*radPerUnit;
      let a = centerAngle - totalAngle/2;
      kids.forEach(cid=>{
        const cu = personToUnit.get(cid);
        if(!cu) return;
        const cw = unitWidth(cu, new Set());
        const span = cw*radPerUnit;
        assignAngle(cu, a+span/2);
        a += span + siblingGap()*radPerUnit;
      });
    }
    function assignAngle(unit, centerAngle){
      if(positioned.has(unit)) return;
      positioned.add(unit);
      unitWidth(unit, new Set());
      angleOf.set(unit, centerAngle);
      assignChildrenArc(unitChildren.get(unit) || [], centerAngle);
      let cursor = centerAngle;
      unit.secondary.forEach(slot=>{
        const span = slot._width*radPerUnit;
        const dir = slot.side===0 ? -1 : 1;
        cursor += dir*(EX_GAP*radPerUnit + span/2);
        exAngleOf.set(slot, cursor);
        assignChildrenArc(slot.kids, (centerAngle+cursor)/2);
        cursor += dir*(span/2);
      });
    }
    let cursor = 0;
    rootUnits.forEach(u=>{
      const w = unitWidth(u, new Set());
      const span = w*radPerUnit;
      assignAngle(u, cursor+span/2);
      cursor += span + FAMILY_GAP*radPerUnit;
    });
    ctx.units.forEach(u=>{ if(!positioned.has(u)) assignAngle(u, cursor += radPerUnit*nodeW()); });

    // Dynamic per-ring radius: for each generation, look at every
    // occupant's angle (unit centers AND docked ex slots) and its own
    // physical card footprint, and make sure the ring is wide enough that
    // no two ANGULARLY-ADJACENT occupants can be less than their combined
    // half-footprints + a safety gap apart. Rings are also kept at least
    // RING_GAP further out than the previous ring.
    const ringOccupants = new Map();
    function addOccupant(g, angle, footprint){
      if(!ringOccupants.has(g)) ringOccupants.set(g, []);
      ringOccupants.get(g).push({angle, footprint});
    }
    ctx.units.forEach(u=>{
      addOccupant(gen[u.ids[0]], angleOf.get(u), u._ownWidth);
      u.secondary.forEach(slot=>{
        addOccupant(gen[slot.exId], exAngleOf.get(slot), slot.small ? exNodeW() : nodeW());
      });
    });
    const maxGenSeen = Math.max(0, ...Array.from(ringOccupants.keys()));
    const ringRadius = {};
    let prevRadius = 0;
    for(let g=0; g<=maxGenSeen; g++){
      const occ = (ringOccupants.get(g) || []).slice().sort((a,b)=>a.angle-b.angle);
      let required = RADIAL_BASE;
      if(occ.length>=2){
        for(let i=0;i<occ.length;i++){
          const a = occ[i], b = occ[(i+1)%occ.length];
          let gap = b.angle-a.angle;
          if(i===occ.length-1) gap = (b.angle+2*Math.PI)-a.angle; // wraparound
          if(gap<=0) continue;
          const neededArc = (a.footprint+b.footprint)/2 + RADIAL_SAFETY_GAP;
          required = Math.max(required, neededArc/gap);
        }
      }
      let radius = Math.max(required, prevRadius+RING_GAP);
      // The innermost ring is special: if the oldest generation is a single
      // person, they belong at the dead centre rather than orbiting it. A
      // founding COUPLE sits just off centre so the two cards can sit side
      // by side. This is what makes the whole diagram visibly radiate from
      // the oldest ancestor — and it re-resolves automatically when an
      // older generation is discovered and added later.
      if(g === 0){
        // Exactly ONE unit at the oldest generation — a lone ancestor, or a
        // founding couple (which counts as one unit and straddles the
        // origin) — sits at the dead centre. Several unrelated roots can't
        // all be centred, so they fall back to a normal ring.
        if(occ.length === 1) radius = 0;
        else radius = Math.max(required, (nodeW()+partnerGap())*0.6);
      }
      ringRadius[g] = radius;
      // The next ring has to clear whatever the centre actually occupies,
      // which for a straddling couple is half their combined width — not
      // just the ring radius, which may be zero.
      // A couple is ONE unit, so counting occupants can't tell us how wide
      // the centre really is — use the recorded footprint, which is already
      // double-width for a pair.
      const innerExtent = (g===0)
        ? occ.reduce((m,o)=>Math.max(m, o.footprint/2), 0)
        : 0;
      prevRadius = radius + innerExtent;
    }

    // Global rotation: rather than special-casing the root's own offset
    // (which risks pushing it radially into its own children's territory
    // — the exact bug that caused overlap), rotate every angle by a
    // constant so the root lands at -90°, where the tangential direction
    // (perpendicular to its own radius, used for every couple uniformly)
    // is plain horizontal. That makes the root read as a clean,
    // symmetrical side-by-side pair with no special case, and therefore
    // no special-case bug.
    const firstRootAngle = rootUnits.length ? angleOf.get(rootUnits[0]) : 0;
    const rotation = (-Math.PI/2) - firstRootAngle;

    const positions = {};
    ctx.units.forEach(u=>{
      const angle = angleOf.get(u) + rotation;
      const r = ringRadius[gen[u.ids[0]]];
      const cx = r*Math.cos(angle), cy = r*Math.sin(angle);
      const dirX = Math.cos(angle), dirY = Math.sin(angle);
      if(u.ids.length===2){
        const tx = -Math.sin(angle), ty = Math.cos(angle); // tangential — always perpendicular to radius
        const half = (nodeW()+partnerGap())/2;
        positions[u.ids[0]] = {x: cx-tx*half, y: cy-ty*half, gen: gen[u.ids[0]], dirX, dirY, r, angle};
        positions[u.ids[1]] = {x: cx+tx*half, y: cy+ty*half, gen: gen[u.ids[1]], dirX, dirY, r, angle};
      } else {
        positions[u.ids[0]] = {x: cx, y: cy, gen: gen[u.ids[0]], dirX, dirY, r, angle};
      }
      u.secondary.forEach(slot=>{
        const sAngle = exAngleOf.get(slot) + rotation;
        const sR = ringRadius[gen[slot.exId]];
        positions[slot.exId] = {x: sR*Math.cos(sAngle), y: sR*Math.sin(sAngle), gen: gen[slot.exId], dirX: Math.cos(sAngle), dirY: Math.sin(sAngle), r: sR, angle: sAngle};
      });
    });
    return {positions, secondaryIds};
  }

  // "constellation" mode: a genuine 3D layout using solid-angle cone packing.
  //
  // Every subtree owns a CONE of directions (an axis plus a half-angle).
  // A node's children receive sub-cones packed inside their parent's cone,
  // arranged as a ring around the parent's axis, with the ring offset
  // solved from two constraints: sibling cones must not overlap, AND
  // siblings must clear a minimum pixel gap at their shell radius (cone
  // angles alone shrink with depth and stop guaranteeing visual spacing).
  //
  // Because each subtree stays inside its own disjoint cone, whole branches
  // provably cannot cross into one another. And because children are
  // offset in a full 3D ring around their parent's axis — rather than
  // varying only azimuth, which was the old bug — the result fills a
  // sphere instead of collapsing into a flat ring.
  function v_norm(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
  function v_cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function v_perp(d){
    const ref = Math.abs(d[0]) < 0.9 ? [1,0,0] : [0,1,0];
    return v_norm(v_cross(d, ref));
  }
  // Rotate unit vector d away from its own axis by `beta`, in the direction
  // given by azimuth `phi`, using an orthonormal frame built on d.
  function v_offset(d, beta, phi){
    const u = v_perp(d), v = v_cross(d, u);
    const sb = Math.sin(beta), cb = Math.cos(beta);
    return v_norm([
      d[0]*cb + (u[0]*Math.cos(phi) + v[0]*Math.sin(phi))*sb,
      d[1]*cb + (u[1]*Math.cos(phi) + v[1]*Math.sin(phi))*sb,
      d[2]*cb + (u[2]*Math.cos(phi) + v[2]*Math.sin(phi))*sb,
    ]);
  }

  function layoutConstellation(){
    const ctx = buildUnits();
    const {gen, secondaryIds} = ctx;
    const byId = new Map(people.map(p=>[p.id,p]));

    const kidsOf = new Map();
    people.forEach(p=>{
      const par = (p.parents||[]).filter(id=>byId.has(id));
      if(!par.length) return;
      const k = par[0];
      if(!kidsOf.has(k)) kidsOf.set(k, []);
      kidsOf.get(k).push(p.id);
    });
    kidsOf.forEach(list=>list.sort((a,b)=>((byId.get(a).dob)||'').localeCompare((byId.get(b).dob)||'')));

    const rootIds = people.filter(p=>!(p.parents||[]).some(id=>byId.has(id))).map(p=>p.id);

    const wMemo = new Map();
    function weightOf(id, seen){
      if(wMemo.has(id)) return wMemo.get(id);
      if(seen.has(id)) return 1;
      seen.add(id);
      const c = kidsOf.get(id) || [];
      const w = c.length ? c.reduce((s,k)=>s+weightOf(k, seen), 0) : 1;
      seen.delete(id);
      wMemo.set(id, w);
      return w;
    }

    const positions = {};
    const placed = new Set();
    // A lone root sits at the exact centre; several roots share a small
    // inner shell so they can never stack on the same point.
    const coreR = rootIds.length > 1 ? CONSTELLATION_BASE*0.45 : 0;

    function place(id, g, dir, alpha){
      if(placed.has(id)) return;
      placed.add(id);
      const r = g===0 ? coreR : CONSTELLATION_BASE + (g-1)*CONSTELLATION_SHELL_GAP;
      positions[id] = {
        x3: dir[0]*r, y3: dir[1]*r, z3: dir[2]*r,
        gen: gen[id]!==undefined ? gen[id] : g, x:0, y:0,
      };
      const kids = kidsOf.get(id) || [];
      if(!kids.length) return;
      const total = kids.reduce((s,k)=>s+weightOf(k, new Set()), 0) || 1;
      // Cone half-angle scales with the square root of a child's share,
      // because solid angle grows with the square of angular radius.
      const alphas = kids.map(k => Math.max(0.06, alpha*0.82*Math.sqrt(weightOf(k, new Set())/total)));

      const childR = CONSTELLATION_BASE + g*CONSTELLATION_SHELL_GAP;
      let beta;
      if(kids.length === 1){
        beta = 0; // the shell gap alone separates a single child
      } else {
        const step = 2*Math.PI/kids.length;
        const chord = 2*Math.sin(step/2);
        let need = 0;
        for(let i=0;i<kids.length;i++){
          const j = (i+1)%kids.length;
          need = Math.max(need, (alphas[i]+alphas[j])/chord);
        }
        const needPx = CONSTELLATION_MIN_SEP/(chord*Math.max(childR,1));
        beta = Math.max(need, needPx);
        const roomy = Math.max(0, alpha - Math.max(...alphas));
        if(beta < roomy) beta = Math.min(roomy, Math.max(beta, roomy*0.75));
        beta = Math.min(beta, Math.PI*0.48);
      }

      kids.forEach((k,i)=>{
        const phi = (2*Math.PI*i)/kids.length + (g%2 ? Math.PI/kids.length : 0);
        const cdir = kids.length===1 ? dir : v_offset(dir, beta, phi);
        place(k, g+1, cdir, alphas[i]);
      });
    }

    // Roots spread over the whole sphere via a Fibonacci distribution, each
    // getting a cone sized by its share of the family.
    const totalW = rootIds.reduce((s,r)=>s+weightOf(r, new Set()), 0) || 1;
    const golden = Math.PI*(3-Math.sqrt(5));
    rootIds.forEach((rid,i)=>{
      let dir;
      if(rootIds.length===1){ dir = [0,1,0]; }
      else {
        const y = 1-(i/(rootIds.length-1))*2;
        const rad = Math.sqrt(Math.max(0,1-y*y));
        const th = golden*i;
        dir = v_norm([Math.cos(th)*rad, y, Math.sin(th)*rad]);
      }
      place(rid, 0, dir, Math.PI*0.5*Math.sqrt(weightOf(rid, new Set())/totalW) + 0.35);
    });

    // Safety net for anyone unreachable (e.g. dangling parent references).
    let orphan = 0;
    people.forEach(p=>{
      if(placed.has(p.id)) return;
      const r = CONSTELLATION_BASE + (gen[p.id]||0)*CONSTELLATION_SHELL_GAP;
      const a = orphan*0.9;
      positions[p.id] = {x3:r*Math.cos(a), y3:r*0.35, z3:r*Math.sin(a), gen:gen[p.id]||0, x:0, y:0};
      orphan++;
    });

    return {positions, secondaryIds, is3D:true};
  }
  function layout(){
    if(mode==='constellation') return layoutConstellation();
    return mode==='circle' ? layoutRadial() : layoutLinear();
  }

  // ---------- Render ----------
  function render(){
    const authed = Auth.isAuthed();
    emptyState.classList.toggle('hidden', people.length>0);
    emptyState.classList.toggle('locked', !authed);
    if(!people.length){
      if(authed){ emptyTitle.textContent='Start your family tree'; emptyText.textContent='Add the first person to begin. From there, use the icons on each card to branch out.'; emptyAdd.style.display='flex'; }
      else { emptyTitle.textContent='This family tree is empty'; emptyText.textContent='Sign in with the family password to start adding people.'; emptyAdd.style.display='none'; }
    }
    legend.classList.toggle('hidden', people.length===0);
    nodesLayer.innerHTML=''; linesSvg.innerHTML='';
    if(!people.length) return;

    const layoutResult = layout();
    const pos = layoutResult.positions;
    lastPositions = pos;
    const secondaryIds = layoutResult.secondaryIds;

    // Constellation mode hands rendering to WebGL (see constellation3d.js).
    // Positioning hundreds of DOM cards per orbit frame was the source of
    // the lag, and CSS perspective scaling was the source of the overlap;
    // a real 3D engine solves both. The DOM layers stay empty while it's
    // active so nothing is drawn twice.
    if(layoutResult.is3D && (!window.Constellation3D || typeof THREE === 'undefined')){
      // Fall back to the DOM renderer, but SAY SO. Failing over silently
      // once already cost a round trip of confusion — if the 3D engine
      // didn't load, that should be visible, not something to deduce from
      // the view looking subtly wrong.
      showConstellationWarning(typeof THREE === 'undefined'
        ? '3D engine failed to load (check your connection or ad-blocker) — showing the basic view.'
        : 'The 3D renderer script is missing — showing the basic view.');
    } else {
      hideConstellationWarning();
    }
    if(layoutResult.is3D && window.Constellation3D && typeof THREE !== 'undefined'){
      viewport.classList.add('webgl-active');
      if(!threeMounted){
        threeMounted = window.Constellation3D.mount({
          container: threeHost,
          people, positions: pos,
          theme: document.documentElement.getAttribute('data-theme')==='dark' ? 'dark' : 'light',
          onSelect: id=>openBioModal(id),
        });
      }
      return;
    }
    viewport.classList.remove('webgl-active');
    if(threeMounted){ window.Constellation3D.unmount(); threeMounted = false; }

    // In constellation mode, project the true 3D positions through a real
    // perspective camera. Each node gets a scale (nearer = larger) and a
    // depth used for z-ordering and atmospheric fading, so the cluster
    // genuinely reads as 3D rather than being a flat diagram tilted over.
    if(layoutResult.is3D){
      const cosY = Math.cos(camRotY), sinY = Math.sin(camRotY);
      const cosX = Math.cos(camRotX), sinX = Math.sin(camRotX);
      Object.keys(pos).forEach(id=>{
        const p = pos[id];
        const x1 = p.x3*cosY + p.z3*sinY;
        const z1 = -p.x3*sinY + p.z3*cosY;
        const y1 = p.y3*cosX - z1*sinX;
        const z2 = p.y3*sinX + z1*cosX;
        const denom = FOCAL + z2;
        const scale = denom > 1 ? FOCAL/denom : 0.01;
        p.x = x1*scale;
        p.y = y1*scale;
        p.scale = scale;
        p.depth = z2;
      });
    }

    people.forEach(p=>{
      if(!p.parents.length) return;
      const childPos = pos[p.id];
      const parentPositions = p.parents.map(pid=>pos[pid]).filter(Boolean);
      if(!parentPositions.length) return;
      const midX = parentPositions.reduce((s,pp)=>s+pp.x,0)/parentPositions.length;
      const midY = parentPositions.reduce((s,pp)=>s+pp.y,0)/parentPositions.length;
      const OFFSET = 34;
      let x1,y1,x2,y2,cx1,cy1,cx2,cy2;

      if(mode==='constellation'){
        // In 3D, a straight line between two points projects to a straight
        // line, so these are simple segments rather than curves. The end
        // offsets scale with each node's own perspective scale so the line
        // meets the edge of a near (large) card and a far (small) card
        // correctly instead of overshooting or falling short.
        const pScale = parentPositions.reduce((s,pp)=>s+(pp.scale||1),0)/parentPositions.length;
        const cScale = childPos.scale||1;
        const dx = childPos.x-midX, dy = childPos.y-midY;
        const len = Math.hypot(dx,dy) || 1;
        const ux = dx/len, uy = dy/len;
        const startOff = 26*pScale, endOff = 26*cScale;
        x1 = 4000+midX+ux*startOff; y1 = 4000+midY+uy*startOff;
        x2 = 4000+childPos.x-ux*endOff; y2 = 4000+childPos.y-uy*endOff;
        // Very slight bow so overlapping segments stay visually separable.
        const bow = Math.min(28, len*0.06);
        const mx = (x1+x2)/2, my = (y1+y2)/2;
        cx1 = mx - uy*bow; cy1 = my + ux*bow;
        cx2 = cx1; cy2 = cy1;
      } else if(mode==='circle'){
        // A generic Cartesian S-curve doesn't read as "radial" — it cuts
        // straight across rings instead of sweeping with the circle. This
        // interpolates radius and angle separately (matching how radial
        // tree diagrams are conventionally drawn): the curve leaves the
        // parent heading straight outward along its own angle, arrives at
        // the child heading straight outward along its angle, and sweeps
        // between the two angles at the midpoint radius in between.
        const midR = Math.hypot(midX,midY), midA = Math.atan2(midY,midX);
        const startR = midR+OFFSET, startA = midA;
        const endR = Math.max(startR+1, childPos.r-OFFSET), endA = childPos.angle;
        x1 = 4000+startR*Math.cos(startA); y1 = 4000+startR*Math.sin(startA);
        x2 = 4000+endR*Math.cos(endA); y2 = 4000+endR*Math.sin(endA);
        const halfR = (startR+endR)/2;
        cx1 = 4000+halfR*Math.cos(startA); cy1 = 4000+halfR*Math.sin(startA);
        cx2 = 4000+halfR*Math.cos(endA); cy2 = 4000+halfR*Math.sin(endA);
      } else {
        // Each point carries its own "flow direction" (straight down in
        // tree mode) so the curve leaves the parent(s) and arrives at the
        // child heading the way that view is meant to read.
        let pDirX = parentPositions.reduce((s,pp)=>s+pp.dirX,0)/parentPositions.length;
        let pDirY = parentPositions.reduce((s,pp)=>s+pp.dirY,0)/parentPositions.length;
        const pLen = Math.hypot(pDirX,pDirY) || 1; pDirX/=pLen; pDirY/=pLen;
        const cDirX = childPos.dirX, cDirY = childPos.dirY;
        const startX = midX + pDirX*OFFSET, startY = midY + pDirY*OFFSET;
        const endX = childPos.x - cDirX*OFFSET, endY = childPos.y - cDirY*OFFSET;
        x1=4000+startX; y1=4000+startY; x2=4000+endX; y2=4000+endY;
        // Curve "strength" is the displacement projected onto the average
        // flow direction — in tree mode (flow is always straight down)
        // this is exactly |y2-y1|, matching the original curve exactly.
        const flowX=(pDirX+cDirX)/2, flowY=(pDirY+cDirY)/2;
        const flen = Math.hypot(flowX,flowY) || 1;
        const c = Math.abs((x2-x1)*(flowX/flen) + (y2-y1)*(flowY/flen))/2;
        cx1 = x1+pDirX*c; cy1 = y1+pDirY*c; cx2 = x2-cDirX*c; cy2 = y2-cDirY*c;
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`);
      path.setAttribute('class','branch');
      path.dataset.child = p.id;
      linesSvg.appendChild(path);
    });

    const drawn = new Set();
    people.forEach(p=>{
      p.partners.forEach(pt=>{
        const key = [p.id,pt.id].sort((a,b)=>a-b).join('-');
        if(drawn.has(key)) return; drawn.add(key);
        const partner = people.find(x=>x.id===pt.id);
        if(!partner) return;
        const a=pos[p.id], b=pos[partner.id];
        if(!a||!b) return;
        const status = pt.status||'partner';
        const dx=b.x-a.x, dy=b.y-a.y;
        const dist = Math.hypot(dx,dy) || 1;
        const ux=dx/dist, uy=dy/dist;
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        const offA = 56*(a.scale||1), offB = 56*(b.scale||1);
        line.setAttribute('x1',4000+a.x+ux*offA); line.setAttribute('y1',4000+a.y+uy*offA);
        line.setAttribute('x2',4000+b.x-ux*offB); line.setAttribute('y2',4000+b.y-uy*offB);
        line.setAttribute('class','union-link union-'+status);
        line.dataset.a = p.id; line.dataset.b = partner.id;
        linesSvg.appendChild(line);
        const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
        dot.setAttribute('cx',4000+(a.x+b.x)/2); dot.setAttribute('cy',4000+(a.y+b.y)/2);
        dot.setAttribute('r',4.5); dot.setAttribute('class','union-dot '+status);
        dot.dataset.a = p.id; dot.dataset.b = partner.id;
        linesSvg.appendChild(dot);
      });
    });

    people.forEach(p=>{
      const P = pos[p.id];
      const el = document.createElement('div');
      el.className = 'node' + (secondaryIds.has(p.id) ? ' secondary' : '');
      el.dataset.id = p.id;
      el.style.left=(4000+P.x)+'px'; el.style.top=(4000+P.y)+'px';
      el.style.transform='translate(-50%,-50%)';
      if(P.scale!==undefined){
        // Perspective scaling + depth cues: distant people are smaller,
        // dimmer and sit behind nearer ones, which is what sells the 3D.
        el.style.transform = `translate(-50%,-50%) scale(${P.scale.toFixed(3)})`;
        el.style.zIndex = String(Math.round(10000 - P.depth));
        const fade = Math.max(0.28, Math.min(1, P.scale*0.85));
        el.style.opacity = fade.toFixed(2);
      } else {
        el.style.zIndex = '';
        el.style.opacity = '';
      }
      const avatarStyle = p.photo ? `background-image:url(${p.photo})` : `background-color:${colorFor(p.name||'?')}`;
      const age = ageLabel(p);
      const lockBadge = p.locked ? `<div class="lock-badge" title="Locked — protected from accidental deletion">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>` : '';
      el.innerHTML = `
        <div class="card" data-id="${p.id}">
          ${lockBadge}
          <div class="actions">
            <button class="edit-btn" data-act="edit" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button data-act="parent" title="Add parent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 20V10"/><path d="M8 14l4-4 4 4"/><circle cx="12" cy="5" r="2.4" fill="currentColor" stroke="none"/></svg>
            </button>
            <button data-act="child" title="Add child">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><circle cx="12" cy="19" r="2.4" fill="currentColor" stroke="none"/></svg>
            </button>
            <button data-act="partner" title="Add partner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg>
            </button>
          </div>
          <div class="avatar" style="${avatarStyle}">${p.photo?'':initials(p.name||'?')}</div>
          <div class="name">${escapeHtml(p.name||'Unnamed')}</div>
          ${p.nickname ? `<div class="nickname">"${escapeHtml(p.nickname)}"</div>` : ''}
          ${age ? `<div class="age">${escapeHtml(age)}</div>` : ''}
        </div>`;
      nodesLayer.appendChild(el);
    });
    applyTransform();
  }

  function applyTransform(){
    stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }

  // ---------- Hover lineage highlight ----------
  // On hover, walks up through recorded parents and down through recorded
  // children (not sideways to siblings/cousins — just direct lineage) and
  // glows that whole chain plus the lines connecting it, while dimming
  // everyone else so the line of descent actually reads at a glance.
  function ancestorsOf(id){
    const out = new Set(); const stack=[id];
    while(stack.length){
      const cur = stack.pop();
      const p = people.find(x=>x.id===cur);
      if(!p) continue;
      p.parents.forEach(pid=>{
        if(!out.has(pid) && people.find(x=>x.id===pid)){ out.add(pid); stack.push(pid); }
      });
    }
    return out;
  }
  function descendantsOf(id){
    const out = new Set(); const stack=[id];
    while(stack.length){
      const cur = stack.pop();
      people.filter(k=>k.parents.includes(cur)).forEach(k=>{
        if(!out.has(k.id)){ out.add(k.id); stack.push(k.id); }
      });
    }
    return out;
  }
  function setLineageHighlight(id){
    const lineage = new Set([id, ...ancestorsOf(id), ...descendantsOf(id)]);
    nodesLayer.querySelectorAll('.node').forEach(el=>{
      const on = lineage.has(Number(el.dataset.id));
      el.classList.toggle('lineage-on', on);
      el.classList.toggle('lineage-dim', !on);
    });
    linesSvg.querySelectorAll('.branch').forEach(el=>{
      el.classList.toggle('lineage-on', lineage.has(Number(el.dataset.child)));
    });
    linesSvg.querySelectorAll('.union-link, .union-dot').forEach(el=>{
      el.classList.toggle('lineage-on', lineage.has(Number(el.dataset.a)) && lineage.has(Number(el.dataset.b)));
    });
  }
  function clearLineageHighlight(){
    nodesLayer.querySelectorAll('.node').forEach(el=>el.classList.remove('lineage-on','lineage-dim'));
    linesSvg.querySelectorAll('.lineage-on').forEach(el=>el.classList.remove('lineage-on'));
  }
  nodesLayer.addEventListener('mouseover', e=>{
    const card = e.target.closest('.card');
    if(!card) return;
    setLineageHighlight(Number(card.dataset.id));
  });
  nodesLayer.addEventListener('mouseout', e=>{
    const card = e.target.closest('.card');
    if(!card) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.card');
    if(to === card) return;
    clearLineageHighlight();
  });

  function applyModeClasses(){
    viewport.classList.toggle('mode-circle', mode==='circle');
    viewport.classList.toggle('mode-constellation', mode==='constellation');
  }
  document.getElementById('modeToggle').addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    if(btn.dataset.mode===mode) return;
    mode = btn.dataset.mode;
    document.querySelectorAll('#modeToggle button').forEach(b=>b.classList.toggle('active', b===btn));
    applyModeClasses();
    if(mode!=='constellation' && threeMounted){
      window.Constellation3D.unmount();
      threeMounted = false;
      viewport.classList.remove('webgl-active');
    }
    pan = {x:0,y:0}; zoom = defaultZoom(); // layouts have very different scales
    render();
    applyTransform();
  });

  // ---------- Pan & zoom ----------
  function defaultZoom(){
    const w = window.innerWidth;
    const base = w < 560 ? 0.72 : (w < 900 ? 0.9 : 1.05);
    // Circle mode is now compact enough to sit comfortably at a higher zoom.
    return mode==='circle' ? base*1.05 : base;
  }
  zoom = defaultZoom();

  // Zooms so that whatever point in the tree is currently under
  // (clientX, clientY) stays under the cursor/finger after the zoom change,
  // instead of always zooming toward the center of the screen.
  function zoomAt(clientX, clientY, newZoom){
    const rect = viewport.getBoundingClientRect();
    const vcx = rect.width/2, vcy = rect.height/2;
    const mx = clientX-rect.left, my = clientY-rect.top;
    const clamped = Math.min(2.4, Math.max(0.25, newZoom));
    const ratio = clamped/zoom;
    pan.x = mx - vcx - ratio*(mx - vcx - pan.x);
    pan.y = my - vcy - ratio*(my - vcy - pan.y);
    zoom = clamped;
    applyTransform();
  }
  function zoomAtCenter(newZoom){
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.left+rect.width/2, rect.top+rect.height/2, newZoom);
  }

  let dragging=false, dragStart={x:0,y:0}, panStart={x:0,y:0}, camStart={x:0,y:0}, orbiting=false;
  viewport.addEventListener('mousedown', e=>{
    if(e.target.closest('.node')) return;
    dragging=true;
    // In constellation mode a plain drag orbits the camera (that's the
    // whole point of a 3D view); hold Shift to pan instead.
    orbiting = (mode==='constellation' && !e.shiftKey);
    viewport.classList.add('grabbing');
    dragStart={x:e.clientX,y:e.clientY};
    panStart={...pan};
    camStart={x:camRotX, y:camRotY};
  });
  window.addEventListener('mousemove', e=>{
    if(!dragging) return;
    if(orbiting){
      camRotY = camStart.y + (e.clientX-dragStart.x)*0.006;
      camRotX = Math.max(-1.2, Math.min(1.2, camStart.x + (e.clientY-dragStart.y)*0.006));
      render();
    } else {
      pan.x = panStart.x + (e.clientX-dragStart.x);
      pan.y = panStart.y + (e.clientY-dragStart.y);
      applyTransform();
    }
  });
  window.addEventListener('mouseup', ()=>{ dragging=false; orbiting=false; viewport.classList.remove('grabbing'); });
  viewport.addEventListener('wheel', e=>{
    e.preventDefault();
    const delta = e.deltaY>0 ? -0.08 : 0.08;
    zoomAt(e.clientX, e.clientY, zoom + delta*zoom);
  }, {passive:false});
  document.getElementById('zoomIn').onclick = ()=>zoomAtCenter(zoom+0.15);
  document.getElementById('zoomOut').onclick = ()=>zoomAtCenter(zoom-0.15);
  document.getElementById('resetView').onclick = ()=>{ zoom=defaultZoom(); pan={x:0,y:0}; applyTransform(); };

  // ---- Touch: one finger drags, two fingers pinch-zoom around their midpoint ----
  function touchDist(a,b){ return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); }
  let pinch = null;
  viewport.addEventListener('touchstart', e=>{
    if(e.target.closest('.node')) return;
    if(e.touches.length===1){
      pinch = null; dragging = true;
      const t = e.touches[0];
      dragStart = {x:t.clientX, y:t.clientY}; panStart = {...pan};
    } else if(e.touches.length===2){
      dragging = false;
      pinch = { startDist: touchDist(e.touches[0], e.touches[1]), startZoom: zoom };
    }
  }, {passive:true});
  viewport.addEventListener('touchmove', e=>{
    if(e.touches.length===1 && dragging){
      e.preventDefault();
      const t = e.touches[0];
      pan.x = panStart.x + (t.clientX-dragStart.x);
      pan.y = panStart.y + (t.clientY-dragStart.y);
      applyTransform();
    } else if(e.touches.length===2 && pinch){
      e.preventDefault();
      const [a,b] = e.touches;
      const newZoom = pinch.startZoom * (touchDist(a,b)/pinch.startDist);
      zoomAt((a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2, newZoom);
    }
  }, {passive:false});
  viewport.addEventListener('touchend', e=>{
    if(e.touches.length===0){ dragging=false; pinch=null; }
    else if(e.touches.length===1){
      pinch = null; dragging = true;
      const t = e.touches[0];
      dragStart = {x:t.clientX, y:t.clientY}; panStart = {...pan};
    }
  });

  // ---- Keyboard arrows: nudge the view, unless typing in a field or a modal is open ----
  const PAN_STEP = 70;
  window.addEventListener('keydown', e=>{
    const tag = document.activeElement && document.activeElement.tagName;
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT') return;
    if(document.querySelector('.overlay.show')) return;
    // In constellation mode the 3D renderer owns the arrow keys for flight;
    // panning the (hidden) 2D stage as well would double-handle them.
    if(mode==='constellation' && threeMounted) return;
    if(e.key==='ArrowUp') pan.y += PAN_STEP;
    else if(e.key==='ArrowDown') pan.y -= PAN_STEP;
    else if(e.key==='ArrowLeft') pan.x += PAN_STEP;
    else if(e.key==='ArrowRight') pan.x -= PAN_STEP;
    else return;
    e.preventDefault();
    applyTransform();
  });

  // ---- On-screen pan pad: tap to nudge, press and hold to keep moving ----
  function stepPan(dir){
    if(dir==='up') pan.y += PAN_STEP;
    else if(dir==='down') pan.y -= PAN_STEP;
    else if(dir==='left') pan.x += PAN_STEP;
    else if(dir==='right') pan.x -= PAN_STEP;
    applyTransform();
  }
  document.querySelectorAll('.pan-btn').forEach(btn=>{
    btn.addEventListener('pointerdown', e=>{
      e.preventDefault();
      stepPan(btn.dataset.dir);
      let timer = setTimeout(function repeat(){ stepPan(btn.dataset.dir); timer=setTimeout(repeat,70); }, 380);
      const stop = ()=>{ clearTimeout(timer); window.removeEventListener('pointerup',stop); window.removeEventListener('pointercancel',stop); };
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    });
  });


  // ---------- View-only bio modal ----------
  const bioOverlay = document.getElementById('bioOverlay');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  function openBioModal(id){
    const p = people.find(x=>x.id===id);
    if(!p) return;
    document.getElementById('bioAvatar').style.cssText = p.photo
      ? `background-image:url(${p.photo})` : `background-color:${colorFor(p.name||'?')}`;
    document.getElementById('bioAvatar').textContent = p.photo ? '' : initials(p.name||'?');
    document.getElementById('bioName').textContent = p.name || 'Unnamed';
    document.getElementById('bioNickname').textContent = p.nickname ? `"${p.nickname}"` : '';

    let dates = '';
    if(p.dob) dates += 'Born ' + formatDate(p.dob);
    if(p.dod) dates += (dates?' · ':'') + 'Passed away ' + formatDate(p.dod);
    document.getElementById('bioDates').textContent = dates;

    const facts = [];
    if(p.birthplace) facts.push(['Place of birth', escapeHtml(p.birthplace)]);
    if(p.ethnicity) facts.push(['Ethnicity', escapeHtml(p.ethnicity)]);
    if(p.location) facts.push(['Current location', escapeHtml(p.location)]);
    document.getElementById('bioFacts').innerHTML = facts.map(([k,v])=>
      `<div class="bio-fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

    // ---- Connections: everyone directly related to this person ----
    // Grouped by relationship so it reads as a summary of where they sit in
    // the family, and clickable so you can walk the tree from the popup.
    const connRows = [];
    const pushGroup = (label, list, extra) => {
      if(!list.length) return;
      connRows.push(`<div class="bc-conn-group"><div class="bc-conn-label">${label}</div>` +
        list.map(q=>{
          const style = q.photo ? `background-image:url(${q.photo})` : `background-color:${colorFor(q.name||'?')}`;
          const note = extra ? extra(q) : '';
          return `<button type="button" class="bc-conn" data-goto="${q.id}">
            <span class="bcc-avatar" style="${style}">${q.photo?'':initials(q.name||'?')}</span>
            <span class="bcc-name">${escapeHtml(q.name||'Unnamed')}</span>
            ${note?`<span class="bcc-note">${note}</span>`:''}
          </button>`;
        }).join('') + `</div>`);
    };

    const parents  = (p.parents||[]).map(pid=>people.find(x=>x.id===pid)).filter(Boolean);
    const partners = (p.partners||[]).map(pt=>{
      const q = people.find(x=>x.id===pt.id);
      return q ? Object.assign({}, q, {_status: pt.status||'partner'}) : null;
    }).filter(Boolean);
    const children = people.filter(q=>(q.parents||[]).includes(p.id));
    // Siblings share at least one parent, excluding the person themselves.
    const siblings = people.filter(q=>q.id!==p.id &&
      (q.parents||[]).some(pid=>(p.parents||[]).includes(pid)));

    pushGroup('Parents', parents);
    pushGroup('Partners', partners, q=>cap(q._status));
    pushGroup('Children', children);
    pushGroup('Siblings', siblings);

    const connWrap = document.getElementById('bioConnWrap');
    if(connRows.length){
      connWrap.style.display='block';
      document.getElementById('bioConnections').innerHTML = connRows.join('');
    } else connWrap.style.display='none';

    // ---- Link out to this person's own family tree, if one is recorded ----
    const linkWrap = document.getElementById('bioLinkWrap');
    const linkEl = document.getElementById('bioFamilyLink');
    if(p.linkedFamily && p.linkedFamily.slug){
      const lf = p.linkedFamily;
      const q = 'family='+encodeURIComponent(lf.slug) + (lf.personId ? '&person='+encodeURIComponent(lf.personId) : '');
      linkEl.href = 'index.html?'+q;
      linkEl.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`
        + `Open ${escapeHtml((p.name||'their').split(' ')[0])}'s family tree`
        + (lf.personId ? '' : ' <span style="opacity:.7;font-weight:400;">(family only)</span>');
      linkWrap.style.display='block';
    } else linkWrap.style.display='none';

    // Offer to spin a whole new tree off this person. Only shown to people
    // who could actually do it (creating a family mints a password), and
    // only when they aren't already linked somewhere.
    const spawnWrap = document.getElementById('bioSpawnWrap');
    if(spawnWrap){
      const mayCreate = Auth.isAuthed() && Auth.canAdmin() && !(p.linkedFamily && p.linkedFamily.slug);
      spawnWrap.style.display = mayCreate ? 'block' : 'none';
      if(mayCreate){
        document.getElementById('bioSpawnLabel').textContent =
          `Create a family tree for ${(p.name||'them').split(' ')[0]}`;
        spawnWrap.dataset.personId = p.id;
      }
    }

    const bioTextWrap = document.getElementById('bioTextWrap');
    if(p.bio){ bioTextWrap.style.display='block'; document.getElementById('bioText').textContent = p.bio; }
    else bioTextWrap.style.display='none';

    const galWrap = document.getElementById('bioGalleryWrap');
    const gal = document.getElementById('bioGallery');
    if(p.gallery && p.gallery.length){
      galWrap.style.display='block';
      gal.innerHTML = p.gallery.map(url=>`<img src="${url}" data-full="${url}">`).join('');
    } else galWrap.style.display='none';

    const eventsWrap = document.getElementById('bioEventsWrap');
    const eventsEl = document.getElementById('bioEvents');
    const personEvents = events.filter(ev=>ev.people && ev.people.includes(p.id));
    const synthesized = [];
    if(p.dob) synthesized.push({title:'Born', date:p.dob, description:'', people:[p.id], synthetic:true});
    if(p.dod) synthesized.push({title:'Passed away', date:p.dod, description:'', people:[p.id], synthetic:true});
    const allEvents = synthesized.concat(personEvents).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    if(allEvents.length){
      eventsWrap.style.display='block';
      eventsEl.innerHTML = allEvents.map(ev=>{
        const others = (ev.people||[]).filter(pid=>pid!==p.id).map(pid=>people.find(x=>x.id===pid)).filter(Boolean);
        const withNote = others.length ? ` <span style="font-weight:400;">with ${others.map(o=>escapeHtml(o.name)).join(', ')}</span>` : '';
        return `
        <div class="bio-event">
          <div class="be-dot"></div>
          <div class="be-body">
            <div class="be-date">${ev.date?formatDate(ev.date):''}</div>
            <div class="be-title">${escapeHtml(ev.title)}${withNote}</div>
            ${ev.description ? `<div class="be-desc">${escapeHtml(ev.description)}</div>` : ''}
          </div>
        </div>`;
      }).join('') + `<a class="bio-timeline-link" href="timeline.html${Auth.family!=='main'?'?family='+encodeURIComponent(Auth.family)+'&person='+p.id:'?person='+p.id}">View ${escapeHtml((p.name||'their').split(' ')[0])}'s full timeline &rarr;</a>`;
    } else eventsWrap.style.display='none';

    const capWrap = document.getElementById('bioCapsuleWrap');
    const capEl = document.getElementById('bioCapsule');
    const c = p.capsule || {};
    const fileGroup = (label, key, badge) => (c[key] && c[key].length)
      ? `<div class="bc-group"><div class="bc-label">${label}</div><div class="bc-files">${c[key].map(f=>
          `<div class="bc-file"><div class="bcf-icon">${badge}</div><a href="${f.url}" target="_blank" rel="noopener">${escapeHtml(f.name||'file')}</a></div>`
        ).join('')}</div></div>` : '';
    const groups = [
      (c.traits && c.traits.length) ? `<div class="bc-group"><div class="bc-label">Personality traits</div><div class="bc-tags">${c.traits.map(t=>`<span class="bc-tag">${escapeHtml(t)}</span>`).join('')}</div></div>` : '',
      (c.quotes && c.quotes.length) ? `<div class="bc-group"><div class="bc-label">Quotes</div>${c.quotes.map(q=>`<div class="bc-quote">"${escapeHtml(q)}"</div>`).join('')}</div>` : '',
      (c.hobbies && c.hobbies.length) ? `<div class="bc-group"><div class="bc-label">Hobbies</div><div class="bc-tags">${c.hobbies.map(t=>`<span class="bc-tag">${escapeHtml(t)}</span>`).join('')}</div></div>` : '',
      (c.songs && c.songs.length) ? `<div class="bc-group"><div class="bc-label">Favorite songs</div><div class="bc-tags">${c.songs.map(t=>`<span class="bc-tag">${escapeHtml(t)}</span>`).join('')}</div></div>` : '',
      (c.voice && c.voice.length) ? `<div class="bc-group"><div class="bc-label">Voice recordings</div>${c.voice.map(f=>`<audio controls src="${f.url}"></audio>`).join('')}</div>` : '',
      (c.videos && c.videos.length) ? `<div class="bc-group"><div class="bc-label">Videos</div>${c.videos.map(f=>`<video controls src="${f.url}"></video>`).join('')}</div>` : '',
      fileGroup('Recipes','recipes','R'),
      fileGroup('Handwriting samples','handwriting','H'),
      fileGroup('Other documents','documents','D'),
    ].filter(Boolean);
    if(groups.length){ capWrap.style.display='block'; capEl.innerHTML = groups.join(''); }
    else capWrap.style.display='none';

    bioOverlay.classList.add('show');
  }
  // Clicking a connection walks to that person, so you can explore
  // relationships without closing and hunting for them on the canvas.
  document.getElementById('bioConnections').addEventListener('click', e=>{
    const btn = e.target.closest('[data-goto]');
    if(!btn) return;
    const id = Number(btn.dataset.goto);
    openBioModal(id);
    if(window.TreeView && window.TreeView.focusPerson) window.TreeView.focusPerson(id);
  });

  // ---------- Create a family tree from a person ----------
  const spawnOverlay = document.getElementById('spawnOverlay');
  let spawnPersonId = null;

  // Mirrors the server's selection rule so the dialog can honestly say how
  // many people will travel BEFORE you commit to creating anything.
  function lineageSet(id){
    // Must mirror spawn_family.php exactly, or the dialog would promise a
    // different number of people than actually get imported.
    const take = new Set([id]);
    const ancestors = new Set();
    const up=[id];
    while(up.length){
      const cur=up.pop();
      const q=people.find(x=>x.id===cur);
      (q?.parents||[]).forEach(pid=>{
        if(people.some(x=>x.id===pid) && !ancestors.has(pid)){
          ancestors.add(pid); take.add(pid); up.push(pid);
        }
      });
    }
    // Descend from the person AND from every ancestor, which is what picks
    // up siblings, cousins, aunts and uncles.
    const dn=[id, ...ancestors];
    while(dn.length){
      const cur=dn.pop();
      people.filter(x=>(x.parents||[]).includes(cur)).forEach(k=>{
        if(!take.has(k.id)){ take.add(k.id); dn.push(k.id); }
      });
    }
    [...take].forEach(pid=>{
      const q=people.find(x=>x.id===pid);
      (q?.partners||[]).forEach(pt=>{ if(people.some(x=>x.id===pt.id)) take.add(pt.id); });
    });
    return take;
  }
  function updateSpawnCount(){
    const mode = document.querySelector('input[name=spawnmode]:checked')?.value || 'lineage';
    const n = mode==='lineage' ? lineageSet(spawnPersonId).size : 1;
    document.getElementById('spawnCount').textContent =
      n===1 ? 'Will start with just this one person.' : `Will bring across ${n} people.`;
  }
  function slugify(name){
    return String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
  }

  function openSpawnDialog(personId){
    spawnPersonId = Number(personId);
    const p = people.find(x=>x.id===spawnPersonId);
    if(!p) return;
    const surname = (p.name||'').trim().split(/\s+/).slice(-1)[0] || 'family';
    document.getElementById('spawnTitle').textContent = `Create a family tree for ${(p.name||'them').split(' ')[0]}`;
    document.getElementById('spawnSubhead').textContent =
      'This makes a separate tree with its own password, and links it from this person.';
    document.getElementById('spawnName').value = `The ${surname} Family`;
    document.getElementById('spawnSlug').value = slugify(surname);
    document.getElementById('spawnPassword').value = '';
    document.getElementById('spawnError').classList.remove('show');
    document.querySelector('input[name=spawnmode][value=lineage]').checked = true;
    document.querySelectorAll('#spawnModeGroup .radio-opt').forEach(r=>r.classList.toggle('checked', r.dataset.val==='lineage'));
    updateSpawnCount();
    spawnOverlay.classList.add('show');
  }
  document.getElementById('bioSpawnBtn')?.addEventListener('click', ()=>{
    openSpawnDialog(document.getElementById('bioSpawnWrap').dataset.personId);
  });
  // The edit panel is where you actually reach this, since clicking a card
  // while signed in opens the editor rather than the read-only popup.
  document.getElementById('editSpawnBtn')?.addEventListener('click', ()=>{
    if(!editingId){ alert('Save this person first, then you can give them their own tree.'); return; }
    openSpawnDialog(editingId);
  });
  document.getElementById('spawnModeGroup')?.addEventListener('change', e=>{
    document.querySelectorAll('#spawnModeGroup .radio-opt').forEach(r=>
      r.classList.toggle('checked', r.querySelector('input').checked));
    updateSpawnCount();
  });
  // Keep the short name in step with the family name until it's hand-edited.
  let slugTouched = false;
  document.getElementById('spawnSlug')?.addEventListener('input', ()=>{ slugTouched = true; });
  document.getElementById('spawnName')?.addEventListener('input', e=>{
    if(!slugTouched) document.getElementById('spawnSlug').value = slugify(e.target.value);
  });
  // Generates a readable-but-strong password so nobody has to invent one.
  // Word-shaped chunks are far easier to pass along to a relative over the
  // phone than a random character soup, and 4 chunks + digits is plenty for
  // a private family site.
  document.getElementById('spawnGenPw')?.addEventListener('click', ()=>{
    const words = ['amber','birch','cedar','delta','ember','fable','grove','harbor','ivory','jasper',
                   'lantern','meadow','nectar','opal','pebble','quartz','raven','sable','thistle','umber',
                   'violet','willow','yarrow','zephyr','copper','marble','orchard','saffron'];
    // crypto.getRandomValues, not Math.random — the latter isn't meant for
    // anything security-related. Three words plus three digits keeps it
    // sayable over the phone while being far harder to guess than a
    // two-word version.
    const rnd = n=>{
      const a = new Uint32Array(1);
      (window.crypto||window.msCrypto).getRandomValues(a);
      return a[0] % n;
    };
    const pick = ()=>words[rnd(words.length)];
    const num = 100 + rnd(900);
    const pw = `${pick()}-${pick()}-${pick()}-${num}`;
    const el = document.getElementById('spawnPassword');
    el.value = pw;
    el.focus(); el.select();
    const hint = document.getElementById('spawnPwHint');
    hint.textContent = 'Generated — copy it somewhere safe now. It can be reset later, but not looked up.';
    hint.style.color = 'var(--accent)';
  });

  document.getElementById('spawnCancel')?.addEventListener('click', ()=>spawnOverlay.classList.remove('show'));
  spawnOverlay?.addEventListener('click', e=>{ if(e.target===spawnOverlay) spawnOverlay.classList.remove('show'); });

  document.getElementById('spawnSubmit')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('spawnSubmit');
    const err = document.getElementById('spawnError');
    const name = document.getElementById('spawnName').value.trim();
    const slug = document.getElementById('spawnSlug').value.trim();
    const password = document.getElementById('spawnPassword').value;
    const mode = document.querySelector('input[name=spawnmode]:checked')?.value || 'lineage';
    const fail = m=>{ err.textContent=m; err.classList.add('show'); };
    err.classList.remove('show');
    if(!name) return fail('Give the new family a name.');
    if(!slug) return fail('Give the new family a short name.');
    if(password.length < 4) return fail('Choose a password at least 4 characters long.');

    btn.disabled = true; btn.textContent = 'Creating…';
    try{
      const res = await fetch(Auth.apiUrl('api/spawn_family.php'), {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({personId: spawnPersonId, slug, name, password, mode})
      });
      const data = await res.json();
      if(!res.ok){ fail(data.error || 'Could not create that family.'); }
      else {
        spawnOverlay.classList.remove('show');
        // Reload so this person shows their new link, then offer to go there.
        await loadTree();
        if(confirm(`Created "${name}" with ${data.imported} ${data.imported===1?'person':'people'}.\n\nOpen it now?`)){
          location.href = data.url;
        }
      }
    }catch(e){ fail('Could not reach the server.'); }
    btn.disabled = false; btn.textContent = 'Create tree';
  });

  document.getElementById('bioCloseBtn').onclick = ()=>bioOverlay.classList.remove('show');
  bioOverlay.addEventListener('click', e=>{ if(e.target===bioOverlay) bioOverlay.classList.remove('show'); });
  document.getElementById('bioGallery').addEventListener('click', e=>{
    const img = e.target.closest('img'); if(!img) return;
    lightboxImg.src = img.dataset.full;
    lightbox.classList.add('show');
  });
  document.getElementById('lightboxClose').onclick = ()=>lightbox.classList.remove('show');
  lightbox.addEventListener('click', e=>{ if(e.target===lightbox) lightbox.classList.remove('show'); });

  // ---------- Edit modal ----------
  const overlay = document.getElementById('overlay');
  const modalError = document.getElementById('modalError');
  const nameInput = document.getElementById('nameInput');
  const nicknameInput = document.getElementById('nicknameInput');
  const photoPreview = document.getElementById('photoPreview');
  const photoInput = document.getElementById('photoInput');
  const relationField = document.getElementById('relationField');
  const relationGroup = document.getElementById('relationGroup');
  const parentPick = document.getElementById('parentPick');
  const partnerPick = document.getElementById('partnerPick');
  const childPick = document.getElementById('childPick');
  const alsoParentField = document.getElementById('alsoParentField');
  const alsoParentPick = document.getElementById('alsoParentPick');
  const alsoParentQ = document.getElementById('alsoParentQ');
  const alsoPartnerField = document.getElementById('alsoPartnerField');
  const alsoPartnerCheck = document.getElementById('alsoPartnerCheck');
  const alsoPartnerStatus = document.getElementById('alsoPartnerStatus');
  const alsoPartnerQ = document.getElementById('alsoPartnerQ');
  const pickHint = document.getElementById('pickHint');
  const deleteBtn = document.getElementById('deleteBtn');
  const modalTitle = document.getElementById('modalTitle');
  const modalSubhead = document.getElementById('modalSubhead');
  const connField = document.getElementById('connField');
  const connList = document.getElementById('connList');
  const quickParentField = document.getElementById('quickParentField');
  const quickParentFixed = document.getElementById('quickParentFixed');
  const quickParentHint = document.getElementById('quickParentHint');
  const quickParentPick = document.getElementById('quickParentPick');
  const statusField = document.getElementById('statusField');
  const statusSelect = document.getElementById('statusSelect');
  const quickPartnerField = document.getElementById('quickPartnerField');
  const quickPartnerFixed = document.getElementById('quickPartnerFixed');
  const dobInput = document.getElementById('dobInput');
  const dodInput = document.getElementById('dodInput');
  const deceasedInput = document.getElementById('deceasedInput');
  const dodWrap = document.getElementById('dodWrap');
  const buriedTab = document.getElementById('buriedTab');
  const birthplaceInput = document.getElementById('birthplaceInput');
  const ethnicityInput = document.getElementById('ethnicityInput');
  const locationInput = document.getElementById('locationInput');
  const bioInput = document.getElementById('bioInput');
  const lockInput = document.getElementById('lockInput');
  const linkedFamilySelect = document.getElementById('linkedFamilySelect');
  const linkedPersonSelect = document.getElementById('linkedPersonSelect');
  const linkedPersonHint = document.getElementById('linkedPersonHint');

  // Populate the "their own family tree" picker from the families on this
  // site. Fails quietly: if the list can't be fetched the field just stays
  // at "Not linked" rather than blocking the whole edit panel.
  (function loadFamilyOptions(){
    if(!linkedFamilySelect) return;
    fetch('api/families.php').then(r=>r.json()).then(data=>{
      (data.families||[]).forEach(f=>{
        if(f.slug === Auth.family) return; // no point linking a person to the tree they're already in
        const opt = document.createElement('option');
        opt.value = f.slug;
        opt.textContent = f.name || f.slug;
        linkedFamilySelect.appendChild(opt);
      });
    }).catch(()=>{});
  })();

  // Once a family is chosen, load ITS people so you can pick exactly who
  // this person is over there. That's what makes the jump land on them
  // rather than dropping you at the other tree to search by hand.
  const familyPeopleCache = {};
  async function loadLinkedPeople(slug, preselectId){
    if(!linkedPersonSelect) return;
    if(!slug){
      linkedPersonSelect.style.display='none';
      linkedPersonHint.style.display='none';
      return;
    }
    linkedPersonSelect.style.display='';
    linkedPersonSelect.innerHTML = '<option value="">Loading people…</option>';
    let list = familyPeopleCache[slug];
    if(!list){
      try{
        const res = await fetch('api/tree.php?family='+encodeURIComponent(slug));
        const data = await res.json();
        list = (data.people||[]).map(p=>({id:p.id, name:p.name}));
        familyPeopleCache[slug] = list;
      }catch(e){ list = null; }
    }
    if(!list){
      linkedPersonSelect.innerHTML = '<option value="">Could not load that family</option>';
      return;
    }
    list.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    linkedPersonSelect.innerHTML = '<option value="">Just link the family (no specific person)</option>' +
      list.map(p=>`<option value="${p.id}">${escapeHtml(p.name||'Unnamed')}</option>`).join('');

    // Convenience: if nothing is preselected, guess by matching the name
    // being edited — married-in relatives usually appear under the same
    // name in their own tree.
    let chosen = preselectId ? String(preselectId) : '';
    if(!chosen){
      const typed = (nameInput.value||'').trim().toLowerCase();
      const hit = typed && list.find(p=>String(p.name||'').trim().toLowerCase()===typed);
      if(hit){
        chosen = String(hit.id);
        linkedPersonHint.textContent = 'Matched "'+hit.name+'" automatically — change it if that\'s the wrong person.';
        linkedPersonHint.style.display='block';
      } else {
        linkedPersonHint.style.display='none';
      }
    } else {
      linkedPersonHint.style.display='none';
    }
    linkedPersonSelect.value = chosen;
  }
  if(linkedFamilySelect){
    linkedFamilySelect.addEventListener('change', ()=>loadLinkedPeople(linkedFamilySelect.value, null));
  }
  const galleryGrid = document.getElementById('galleryGrid');
  const galleryInput = document.getElementById('galleryInput');
  const capsuleFileInput = document.getElementById('capsuleFileInput');
  const eventsList = document.getElementById('eventsList');
  const placesList = document.getElementById('placesList');
  const placeStatus = document.getElementById('placeStatus');

  // Locking a person disables the delete button (rather than hiding it) so
  // it's clear *why* delete isn't available, and unticking the box brings
  // it back immediately without having to reopen the modal.
  function updateDeleteLockState(){
    // When an admin password is configured, locking is an admin-only act
    // and locked people can't be edited or deleted by plain editors. With
    // no admin password set, canAdmin() is true for any editor, so this
    // behaves exactly as it did before the admin tier existed.
    const mayAdmin = Auth.canAdmin();
    lockInput.disabled = !mayAdmin;
    const lockLabel = document.getElementById('lockToggleLabel');
    if(lockLabel){
      lockLabel.classList.toggle('disabled', !mayAdmin);
      lockLabel.title = mayAdmin ? '' : 'Only an admin can lock or unlock people';
    }
    if(!editingId){ deleteBtn.disabled=false; deleteBtn.title=''; return; }
    const lockedAndNotAdmin = lockInput.checked && !mayAdmin;
    deleteBtn.disabled = lockInput.checked;
    deleteBtn.title = lockedAndNotAdmin
      ? 'This person is locked — the admin password is needed'
      : (lockInput.checked ? 'Unlock this person first to delete them' : '');
    // A locked person is read-only for non-admins: disable the save button
    // so it's obvious up front rather than failing on submit.
    const saveBtn = document.getElementById('saveBtn');
    if(saveBtn){
      saveBtn.disabled = lockedAndNotAdmin;
      saveBtn.title = lockedAndNotAdmin ? 'This person is locked — the admin password is needed to edit them' : '';
    }
  }
  lockInput.addEventListener('change', updateDeleteLockState);

  // "Deceased" gates both the date-of-death field and the Buried place
  // option — neither makes sense for someone who's alive, and hiding them
  // keeps the panel shorter for the common case.
  function updateDeceasedState(){
    const on = deceasedInput.checked;
    if(dodWrap) dodWrap.style.display = on ? '' : 'none';
    if(buriedTab) buriedTab.style.display = on ? '' : 'none';
    if(!on){
      dodInput.value = '';
      // If Buried was the selected tab, fall back to a sensible default.
      if(placeKind === 'buried'){
        placeKind = 'lived';
        const tabs = document.getElementById('placeTabs');
        if(tabs) tabs.querySelectorAll('.place-tab').forEach(b=>b.classList.toggle('active', b.dataset.kind==='lived'));
      }
    }
  }
  deceasedInput.addEventListener('change', updateDeceasedState);

  function resetModalFields(){
    pendingPhoto = null; pendingGallery = [];
    modalError.classList.remove('show');
    nameInput.value=''; nicknameInput.value=''; photoPreview.style.backgroundImage=''; photoPreview.textContent='＋';
    document.querySelectorAll('input[name=relation]').forEach(r=>r.checked=false);
    document.querySelectorAll('.radio-opt').forEach(r=>r.classList.remove('checked'));
    parentPick.classList.remove('show'); partnerPick.classList.remove('show'); childPick.classList.remove('show');
    if(alsoParentField){ alsoParentField.style.display='none'; alsoParentPick.innerHTML=''; }
    if(alsoPartnerField){ alsoPartnerField.style.display='none'; delete alsoPartnerField.dataset.otherId; }
    pickHint.style.display='none'; relationField.style.display='none'; connField.style.display='none';
    quickParentField.style.display='none'; quickPartnerField.style.display='none';
    quickParentHint.textContent='Optionally add a second parent:'; quickParentHint.style.display='block';
    quickParentPick.style.display=''; quickParentPick.innerHTML='';
    statusField.style.display='none'; deleteBtn.style.display='none';
    dobInput.value=''; dodInput.value=''; birthplaceInput.value='';
    deceasedInput.checked=false; updateDeceasedState();
    if(linkedFamilySelect) linkedFamilySelect.value='';
    if(linkedPersonSelect){ linkedPersonSelect.style.display='none'; linkedPersonSelect.value=''; }
    if(linkedPersonHint) linkedPersonHint.style.display='none';
    const eswReset = document.getElementById('editSpawnWrap');
    if(eswReset) eswReset.style.display='none';
    ethnicityInput.value=''; locationInput.value=''; bioInput.value='';
    lockInput.checked=false; updateDeleteLockState();
    pendingCapsule = emptyCapsule();
    pendingPlaces = [];
    renderPlacesList();
    pendingEvents = events.map(e=>({...e, people:(e.people||[]).slice()}));
    document.getElementById('eventsSection').style.display = 'none';
    renderGalleryGrid(); renderCapsuleLists(); renderEventsList();
  }

  function renderGalleryGrid(){
    galleryGrid.innerHTML = pendingGallery.map((url,i)=>`
      <div class="gallery-thumb" style="background-image:url(${url})">
        <button class="rm" data-i="${i}" type="button">&times;</button>
      </div>`).join('') + `<div class="gallery-add" id="galleryAddBtn">＋</div>`;
    document.getElementById('galleryAddBtn').onclick = ()=>galleryInput.click();
    galleryGrid.querySelectorAll('.rm').forEach(btn=>{
      btn.onclick = ()=>{ pendingGallery.splice(Number(btn.dataset.i),1); renderGalleryGrid(); };
    });
  }
  galleryInput.addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    openCropper(file, {aspect:1, onDone: async dataUrl=>{
      const url = await uploadImage(dataUrl);
      if(url){ pendingGallery.push(url); renderGalleryGrid(); }
    }});
    galleryInput.value = '';
  });

  function miniRow(p){
    return `<span class="mini-avatar" style="${p.photo?`background-image:url(${p.photo})`:`background-color:${colorFor(p.name)}`}"></span> ${escapeHtml(p.name)}`;
  }
  function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }

  // ---------- Memory capsule ----------
  const CAPSULE_TEXT_KEYS = ['traits','quotes','hobbies','songs'];
  const CAPSULE_FILE_KEYS = ['voice','videos','recipes','handwriting','documents'];
  const CAPSULE_FILE_BADGE = {voice:'A', videos:'V', recipes:'R', handwriting:'H', documents:'D'};
  const CAPSULE_FILE_CATEGORY = {voice:'audio', videos:'video', recipes:'document', handwriting:'image', documents:'document'};

  function renderCapsuleLists(){
    CAPSULE_TEXT_KEYS.forEach(key=>{
      const list = document.querySelector(`.tag-list[data-list="${key}"]`);
      if(!list) return;
      list.innerHTML = (pendingCapsule[key]||[]).map((val,i)=>`
        <div class="tag-chip"><span>${escapeHtml(val)}</span><button type="button" data-remove-tag="${key}" data-idx="${i}">&times;</button></div>
      `).join('');
    });
    CAPSULE_FILE_KEYS.forEach(key=>{
      const list = document.querySelector(`.file-list[data-list="${key}"]`);
      if(!list) return;
      list.innerHTML = (pendingCapsule[key]||[]).map((f,i)=>{
        if(f.uploading){
          return `<div class="file-row uploading"><div class="file-icon">${CAPSULE_FILE_BADGE[key]}</div><span>${escapeHtml(f.name)} — uploading…</span></div>`;
        }
        return `<div class="file-row"><div class="file-icon">${CAPSULE_FILE_BADGE[key]}</div>
          <a href="${f.url}" target="_blank" rel="noopener">${escapeHtml(f.name||'file')}</a>
          <button type="button" data-remove-file="${key}" data-idx="${i}">&times;</button>
        </div>`;
      }).join('');
    });
  }

  document.querySelectorAll('.tag-add-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.tagAdd;
      const input = document.querySelector(`input[data-tag-input="${key}"]`);
      const val = input.value.trim();
      if(!val) return;
      if(!pendingCapsule[key]) pendingCapsule[key]=[];
      pendingCapsule[key].push(val);
      input.value='';
      renderCapsuleLists();
    });
  });
  document.querySelectorAll('[data-tag-input]').forEach(input=>{
    input.addEventListener('keydown', e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        document.querySelector(`.tag-add-btn[data-tag-add="${input.dataset.tagInput}"]`).click();
      }
    });
  });
  document.querySelectorAll('.tag-list').forEach(list=>{
    list.addEventListener('click', e=>{
      const btn = e.target.closest('[data-remove-tag]'); if(!btn) return;
      pendingCapsule[btn.dataset.removeTag].splice(Number(btn.dataset.idx),1);
      renderCapsuleLists();
    });
  });
  document.querySelectorAll('.file-list').forEach(list=>{
    list.addEventListener('click', e=>{
      const btn = e.target.closest('[data-remove-file]'); if(!btn) return;
      pendingCapsule[btn.dataset.removeFile].splice(Number(btn.dataset.idx),1);
      renderCapsuleLists();
    });
  });

  let capsuleUploadTarget = null;
  document.querySelectorAll('.capsule-upload-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      capsuleUploadTarget = btn.dataset.key;
      capsuleFileInput.accept = btn.dataset.accept;
      capsuleFileInput.value = '';
      capsuleFileInput.click();
    });
  });
  capsuleFileInput.addEventListener('change', ()=>{
    const file = capsuleFileInput.files[0];
    const key = capsuleUploadTarget;
    if(!file || !key) return;
    const category = CAPSULE_FILE_CATEGORY[key];
    const reader = new FileReader();
    reader.onload = async ()=>{
      const dataUrl = reader.result;
      if(!pendingCapsule[key]) pendingCapsule[key]=[];
      const tempEntry = {name:file.name, uploading:true};
      pendingCapsule[key].push(tempEntry);
      renderCapsuleLists();
      try{
        const res = await fetch(Auth.apiUrl('api/upload.php'), {
          method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({category, data:dataUrl})
        });
        const data = await res.json();
        const idx = pendingCapsule[key].indexOf(tempEntry);
        if(!res.ok){
          if(idx>=0) pendingCapsule[key].splice(idx,1);
          alert(data.error || 'Upload failed.');
        } else if(idx>=0){
          pendingCapsule[key][idx] = {url:data.url, name:file.name};
        }
      }catch(e){
        const idx = pendingCapsule[key].indexOf(tempEntry);
        if(idx>=0) pendingCapsule[key].splice(idx,1);
        alert('Could not reach the server.');
      }
      renderCapsuleLists();
    };
    reader.readAsDataURL(file);
  });

  // ---------- Life events ----------
  function renderEventSharedPick(){
    const pick = document.getElementById('eventSharedPick');
    if(!pick) return;
    const others = people.filter(p=>p.id!==editingId);
    pick.innerHTML = others.length
      ? others.map(p=>`<label class="pick-row"><input type="checkbox" class="event-share-check" value="${p.id}">${miniRow(p)}</label>`).join('')
      : '<div class="pick-row disabled">No one else in the tree yet</div>';
  }
  function renderEventsList(){
    const mine = pendingEvents.filter(ev=>ev.people && ev.people.includes(editingId));
    const sorted = mine.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    eventsList.innerHTML = sorted.map(ev=>{
      const others = ev.people.filter(pid=>pid!==editingId).map(pid=>people.find(p=>p.id===pid)).filter(Boolean);
      const sharedNote = others.length ? `<div class="edate" style="margin-top:2px;">with ${others.map(o=>escapeHtml(o.name)).join(', ')}</div>` : '';
      return `
      <div class="event-row">
        <div class="erow-top">
          <div class="etitle">${escapeHtml(ev.title)}</div>
          <div class="edate">${ev.date?formatDate(ev.date):''}</div>
          <button type="button" class="erm" data-remove-event="${ev.id}">&times;</button>
        </div>
        ${ev.description ? `<div class="edesc">${escapeHtml(ev.description)}</div>` : ''}
        ${ev.place ? `<div class="edate" style="margin-top:2px;">${escapeHtml(ev.place)}${(ev.lat!=null)?' · pinned':''}</div>` : ''}
        ${sharedNote}
      </div>`;
    }).join('');
  }
  document.getElementById('addEventBtn').addEventListener('click', async ()=>{
    const titleEl = document.getElementById('eventTitleInput');
    const dateEl = document.getElementById('eventDateInput');
    const descEl = document.getElementById('eventDescInput');
    const placeEl = document.getElementById('eventPlaceInput');
    const placeStatusEl = document.getElementById('eventPlaceStatus');
    const btn = document.getElementById('addEventBtn');
    const title = titleEl.value.trim(), date = dateEl.value, description = descEl.value.trim();
    if(!title || !date){ (title?dateEl:titleEl).focus(); return; }
    const sharedWith = Array.from(document.querySelectorAll('.event-share-check:checked')).map(el=>Number(el.value));
    const peopleIds = [editingId, ...sharedWith];

    // An event can optionally carry a location, which puts it on the Map
    // alongside the Places pins. Same approach as Places: resolve the
    // coordinates once, here, and store them — never geocode at view time.
    const placeName = placeEl ? placeEl.value.trim() : '';
    let coords = null;
    if(placeName){
      btn.disabled = true;
      if(placeStatusEl){ placeStatusEl.textContent = 'Looking up…'; placeStatusEl.className = 'place-status'; }
      try{ coords = await geocode(placeName); }catch(e){ coords = null; }
      btn.disabled = false;
      if(placeStatusEl){
        if(coords){ placeStatusEl.textContent = 'Pinned'; placeStatusEl.className = 'place-status ok'; }
        else { placeStatusEl.textContent = "Couldn't find that place — saved without a pin."; placeStatusEl.className = 'place-status warn'; }
      }
    }

    pendingEvents.push({
      id: 'ev_'+Date.now()+'_'+Math.random().toString(36).slice(2),
      title, date, description, people: peopleIds,
      place: placeName || '',
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
    });
    titleEl.value=''; dateEl.value=''; descEl.value='';
    if(placeEl) placeEl.value='';
    document.querySelectorAll('.event-share-check:checked').forEach(el=>el.checked=false);
    renderEventsList();
  });
  eventsList.addEventListener('click', e=>{
    const btn = e.target.closest('[data-remove-event]'); if(!btn) return;
    const ev = pendingEvents.find(x=>String(x.id)===btn.dataset.removeEvent);
    if(!ev) return;
    ev.people = ev.people.filter(pid=>pid!==editingId);
    if(ev.people.length===0){
      pendingEvents = pendingEvents.filter(x=>x!==ev);
    }
    renderEventsList();
  });

  function openModal(id=null, quick=null){
    if(!Auth.isAuthed()){ Auth.openLogin(); return; }
    editingId = id; quickMode = quick;
    resetModalFields();

    if(id){
      const p = people.find(x=>x.id===id);
      modalTitle.textContent='Edit person'; modalSubhead.textContent=''; deleteBtn.style.display='inline-block';
      nameInput.value = p.name;
      nicknameInput.value = p.nickname||'';
      if(p.photo){ photoPreview.style.backgroundImage=`url(${p.photo})`; photoPreview.textContent=''; pendingPhoto=p.photo; }
      dobInput.value = p.dob||''; dodInput.value = p.dod||'';
      // Treat an existing death date (or an explicit flag) as deceased, so
      // records created before this checkbox existed still display right.
      deceasedInput.checked = !!(p.deceased || p.dod);
      updateDeceasedState();
      birthplaceInput.value = p.birthplace||'';
      ethnicityInput.value = p.ethnicity||''; locationInput.value = p.location||''; bioInput.value = p.bio||'';
      lockInput.checked = !!p.locked; updateDeleteLockState();
      if(linkedFamilySelect){
        linkedFamilySelect.value = (p.linkedFamily && p.linkedFamily.slug) || '';
        if(linkedFamilySelect.value) loadLinkedPeople(linkedFamilySelect.value, p.linkedFamily && p.linkedFamily.personId);
      }
      // Offer to spin off a new tree only when it makes sense: the person
      // exists, isn't already linked, and this session could create one.
      const esw = document.getElementById('editSpawnWrap');
      if(esw){
        const already = !!(p.linkedFamily && p.linkedFamily.slug);
        esw.style.display = (Auth.canAdmin() && !already) ? 'block' : 'none';
        document.getElementById('editSpawnLabel').textContent =
          `Create a new family tree for ${(p.name||'this person').split(' ')[0]}`;
      }
      pendingGallery = (p.gallery||[]).slice(); renderGalleryGrid();
      pendingCapsule = Object.assign(emptyCapsule(), p.capsule||{});
      pendingPlaces = (p.places||[]).map(x=>({...x}));
      renderPlacesList();
      document.getElementById('eventsSection').style.display = '';
      renderCapsuleLists(); renderEventSharedPick(); renderEventsList();

      const tags = [];
      p.parents.forEach(pid=>{ const pp=people.find(x=>x.id===pid); if(pp) tags.push(`<div class="conn-tag">Child of <b>${escapeHtml(pp.name)}</b></div>`); });
      p.partners.forEach(pt=>{ const pp=people.find(x=>x.id===pt.id); if(pp) tags.push(`<div class="conn-tag">${cap(pt.status)} to <b>${escapeHtml(pp.name)}</b></div>`); });
      people.filter(k=>k.parents.includes(id)).forEach(k=>tags.push(`<div class="conn-tag">Parent of <b>${escapeHtml(k.name)}</b></div>`));
      if(tags.length){ connField.style.display='block'; connList.innerHTML = tags.join(''); }

    } else if(quick){
      const from = people.find(x=>x.id===quick.from);
      if(quick.type==='child'){
        modalTitle.textContent='Add a child'; modalSubhead.textContent=`Connecting as a child of ${from.name}`;
        quickParentField.style.display='block';
        const partnerOptions = from.partners.map(pt=>people.find(x=>x.id===pt.id)).filter(Boolean);
        quickMode.autoPartnerId = null;
        if(partnerOptions.length===1){
          // Only one partner on record — no need to ask, just use them.
          const partner = partnerOptions[0];
          quickMode.autoPartnerId = partner.id;
          quickParentFixed.innerHTML = miniRow(from) + ' <span class="fixed-and">and</span> ' + miniRow(partner);
          quickParentHint.style.display = 'none';
          quickParentPick.innerHTML = '';
          quickParentPick.style.display = 'none';
        } else {
          quickParentFixed.innerHTML = miniRow(from);
          quickParentPick.style.display = '';
          if(partnerOptions.length>1){
            quickParentHint.style.display = 'block';
            quickParentHint.textContent = 'Which partner is the other parent?';
            quickParentPick.innerHTML = partnerOptions.map(p=>`
              <label class="pick-row"><input type="radio" name="qpPartnerRadio" value="${p.id}">${miniRow(p)}</label>`).join('');
          } else {
            quickParentHint.style.display = 'block';
            quickParentHint.textContent = `${from.name} has no recorded partner yet — this child will only be linked to them.`;
            quickParentPick.innerHTML = '';
          }
        }
      } else if(quick.type==='partner'){
        modalTitle.textContent='Add a partner'; modalSubhead.textContent=`Connecting as a partner of ${from.name}`;
        quickPartnerField.style.display='block'; quickPartnerFixed.innerHTML=miniRow(from);
        statusField.style.display='block';
        // The mirror-image follow-up: if this person already has children,
        // their new partner is often (not always) the other parent. Offer
        // it per-child, since step-families are common.
        const theirKids = people.filter(k=>(k.parents||[]).includes(from.id) &&
          (k.parents||[]).filter(id=>people.some(x=>x.id===id)).length < 2);
        if(theirKids.length){
          alsoParentField.style.display='block';
          alsoParentQ.textContent = `Is this person also the biological parent of ${from.name}'s ${theirKids.length===1?'child':'children'}?`;
          alsoParentPick.innerHTML = theirKids.map(k=>`
            <label class="pick-row"><input type="checkbox" class="also-parent-check" value="${k.id}">${miniRow(k)}</label>`).join('');
        }
      } else if(quick.type==='parent'){
        modalTitle.textContent='Add a parent';
        const existingParents = (from.parents||[]).map(id=>people.find(x=>x.id===id)).filter(Boolean);
        modalSubhead.textContent = existingParents.length >= 2
          ? `${from.name} already has two parents recorded`
          : `Adding a parent of ${from.name}`;
        quickPartnerField.style.display='block';
        quickPartnerFixed.innerHTML = miniRow(from);
        if(existingParents.length >= 2){
          modalError.textContent = 'Remove one of their existing parents first.';
          modalError.classList.add('show');
        } else if(existingParents.length === 1){
          // The natural follow-up: if this child already has one parent,
          // the second is usually that parent's partner. Ask rather than
          // making you go and record it separately afterwards.
          const other = existingParents[0];
          alsoPartnerField.style.display='block';
          alsoPartnerQ.textContent = `Also record them as ${other.name}'s partner?`;
          alsoPartnerCheck.checked = true;
          alsoPartnerStatus.value = 'married';
          alsoPartnerField.dataset.otherId = other.id;
        }
      }
    } else {
      modalTitle.textContent='Add a person'; modalSubhead.textContent='';
      relationField.style.display = people.length>0 ? 'block' : 'none';
      buildPickLists();
    }
    overlay.classList.add('show');
    setTimeout(()=>nameInput.focus(), 50);
  }
  function closeModal(){ overlay.classList.remove('show'); }

  function buildPickLists(){
    parentPick.innerHTML = people.map(p=>`
      <label class="pick-row"><input type="checkbox" value="${p.id}" class="parent-check">${miniRow(p)}</label>`).join('');
    partnerPick.innerHTML = people.map(p=>`
      <label class="pick-row"><input type="radio" name="partnerRadio" value="${p.id}">${miniRow(p)}</label>`).join('');
    // "Parent of" — a person can be given as the parent of several existing
    // people at once (siblings), so this is checkboxes rather than a radio.
    childPick.innerHTML = people.map(p=>{
      const full = (p.parents||[]).filter(id=>people.some(x=>x.id===id)).length >= 2;
      return `<label class="pick-row${full?' disabled':''}">
        <input type="checkbox" name="childCheck" value="${p.id}" class="child-check"${full?' disabled':''}>
        ${miniRow(p)}${full?' <span style="margin-left:auto;font-size:11px;">already has two parents</span>':''}
      </label>`;
    }).join('');
  }

  relationGroup.addEventListener('change', e=>{
    const val = e.target.value;
    document.querySelectorAll('.radio-opt').forEach(r=>r.classList.toggle('checked', r.dataset.val===val));
    parentPick.classList.toggle('show', val==='child');
    partnerPick.classList.toggle('show', val==='partner');
    childPick.classList.toggle('show', val==='parent');
    statusField.style.display = val==='partner' ? 'block':'none';
    const hints = {
      child: 'Select up to two parents.',
      partner: 'Select their partner.',
      parent: 'Select everyone they are a parent of — pick several to add a parent to a whole set of siblings.',
    };
    pickHint.style.display = hints[val] ? 'block' : 'none';
    pickHint.textContent = hints[val] || '';
  });

  document.getElementById('photoBtn').onclick = ()=>photoInput.click();
  emptyAdd.onclick = ()=>openModal();
  addPersonBtn.onclick = ()=>openModal();
  document.getElementById('cancelBtn').onclick = closeModal;
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });

  photoInput.addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    openCropper(file, {aspect:1, onDone: async dataUrl=>{
      photoPreview.style.backgroundImage = `url(${dataUrl})`; photoPreview.textContent='';
      const url = await uploadImage(dataUrl);
      if(url) pendingPhoto = url;
    }});
    photoInput.value = '';
  });

  function linkPartners(idA, idB, status){
    const a = people.find(p=>p.id===idA), b = people.find(p=>p.id===idB);
    if(!a||!b) return;
    a.partners.push({id:idB, status}); b.partners.push({id:idA, status});
  }

  // ---------- Places ----------
  const PLACE_KINDS = {
    lived:  {label:'Lived',   color:'#2f4a3c'},
    married:{label:'Married', color:'#8c6a4f'},
    worked: {label:'Worked',  color:'#5a6e8c'},
    school: {label:'School',  color:'#7a5a7c'},
    buried: {label:'Buried',  color:'#6b6f66'},
  };
  function renderPlacesList(){
    if(!placesList) return;
    placesList.innerHTML = pendingPlaces.map((pl,i)=>{
      const kind = PLACE_KINDS[pl.kind] || PLACE_KINDS.lived;
      const coords = (pl.lat!=null && pl.lng!=null)
        ? `<span class="pl-ok" title="Pinned at ${pl.lat.toFixed(3)}, ${pl.lng.toFixed(3)}">pinned</span>`
        : `<span class="pl-warn" title="No coordinates — won't appear on the map">not pinned</span>`;
      return `<div class="place-row">
        <span class="pl-kind" style="background:${kind.color}">${kind.label}</span>
        <span class="pl-body">
          <span class="pl-name">${escapeHtml(pl.name||'')}${pl.year?` <span class="pl-year">${escapeHtml(pl.year)}</span>`:''}</span>
          ${pl.note?`<span class="pl-note">${escapeHtml(pl.note)}</span>`:''}
        </span>
        ${coords}
        <button type="button" class="pl-rm" data-remove-place="${i}">&times;</button>
      </div>`;
    }).join('');
  }
  if(placesList){
    placesList.addEventListener('click', e=>{
      const btn = e.target.closest('[data-remove-place]');
      if(!btn) return;
      pendingPlaces.splice(Number(btn.dataset.removePlace),1);
      renderPlacesList();
    });
  }
  // Geocoding uses OpenStreetMap's Nominatim: free and keyless, but rate
  // limited and not meant for bulk use. So we resolve a place ONCE here,
  // when it's added, and store the coordinates in the person's record —
  // the map page then just reads those and never geocodes anything.
  async function geocode(query){
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(query);
    const res = await fetch(url, {headers:{'Accept':'application/json'}});
    if(!res.ok) throw new Error('lookup failed');
    const data = await res.json();
    if(!data.length) return null;
    return {lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name};
  }
  // Places kind is chosen via a tab strip rather than a dropdown.
  const placeTabs = document.getElementById('placeTabs');
  if(placeTabs){
    placeTabs.addEventListener('click', e=>{
      const btn = e.target.closest('.place-tab');
      if(!btn) return;
      placeKind = btn.dataset.kind;
      placeTabs.querySelectorAll('.place-tab').forEach(b=>b.classList.toggle('active', b===btn));
    });
  }
  const placeLookupBtn = document.getElementById('placeLookupBtn');
  if(placeLookupBtn){
    placeLookupBtn.addEventListener('click', async ()=>{
      const nameEl = document.getElementById('placeNameInput');
      const yearEl = document.getElementById('placeYearInput');
      const noteEl = document.getElementById('placeNoteInput');
      const name = nameEl.value.trim();
      if(!name){ nameEl.focus(); return; }
      placeLookupBtn.disabled = true;
      placeStatus.textContent = 'Looking up…';
      placeStatus.className = 'place-status';
      let coords = null;
      try{ coords = await geocode(name); }
      catch(e){ coords = null; }
      placeLookupBtn.disabled = false;
      const entry = {
        kind: placeKind, name, year: yearEl.value.trim(), note: noteEl.value.trim(),
        lat: coords ? coords.lat : null, lng: coords ? coords.lng : null,
      };
      pendingPlaces.push(entry);
      if(coords){
        placeStatus.textContent = 'Pinned: '+coords.display.split(',').slice(0,2).join(',');
        placeStatus.className = 'place-status ok';
      } else {
        // Still added — a place with no coordinates is kept as a written
        // record, it just can't be drawn on the map.
        placeStatus.textContent = "Couldn't find that place — saved without a map pin.";
        placeStatus.className = 'place-status warn';
      }
      nameEl.value=''; yearEl.value=''; noteEl.value='';
      renderPlacesList();
    });
  }

  document.getElementById('saveBtn').onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name){ nameInput.focus(); return; }
    const extra = {
      dob: dobInput.value || '', dod: deceasedInput.checked ? (dodInput.value || '') : '',
      deceased: deceasedInput.checked,
      birthplace: birthplaceInput.value.trim(),
      nickname: nicknameInput.value.trim(),
      ethnicity: ethnicityInput.value.trim(), location: locationInput.value.trim(),
      bio: bioInput.value.trim(), gallery: pendingGallery.slice(),
      locked: lockInput.checked,
      linkedFamily: (linkedFamilySelect && linkedFamilySelect.value)
        ? {slug: linkedFamilySelect.value,
           personId: (linkedPersonSelect && linkedPersonSelect.value) ? Number(linkedPersonSelect.value) : null}
        : null,
      capsule: pendingCapsule, places: pendingPlaces,
    };

    if(editingId){
      const p = people.find(x=>x.id===editingId);
      p.name = name; if(pendingPhoto) p.photo = pendingPhoto;
      Object.assign(p, extra);
      events = pendingEvents; // life events are only editable from an existing person's panel
    } else if(quickMode){
      if(quickMode.type==='child'){
        let parents;
        if(quickMode.autoPartnerId){
          parents = [quickMode.from, quickMode.autoPartnerId];
        } else {
          const sel = quickParentPick.querySelector('input[name=qpPartnerRadio]:checked');
          parents = sel ? [quickMode.from, Number(sel.value)] : [quickMode.from];
        }
        people.push({ id: nextId++, name, photo: pendingPhoto, parents, partners: [], ...extra });
      } else if(quickMode.type==='partner'){
        const status = statusSelect.value;
        const newPerson = { id: nextId++, name, photo: pendingPhoto, parents: [], partners: [], ...extra };
        people.push(newPerson);
        linkPartners(newPerson.id, quickMode.from, status);
        // Follow-up: also record them as the other parent of any children ticked.
        Array.from(document.querySelectorAll('.also-parent-check:checked')).forEach(el=>{
          const kid = people.find(x=>x.id===Number(el.value));
          if(!kid) return;
          kid.parents = kid.parents || [];
          if(kid.parents.includes(newPerson.id)) return;
          if(kid.parents.filter(id=>people.some(x=>x.id===id)).length >= 2) return;
          kid.parents.push(newPerson.id);
        });
      } else if(quickMode.type==='parent'){
        const child = people.find(x=>x.id===quickMode.from);
        const existing = child ? (child.parents||[]).filter(id=>people.some(x=>x.id===id)).length : 2;
        if(existing >= 2){
          modalError.textContent = 'That person already has two parents recorded.';
          modalError.classList.add('show');
          return;
        }
        const newPerson = { id: nextId++, name, photo: pendingPhoto, parents: [], partners: [], ...extra };
        people.push(newPerson);
        child.parents = child.parents || [];
        child.parents.push(newPerson.id);
        // Follow-up: also pair them with the child's existing parent.
        const otherId = alsoPartnerField.dataset.otherId;
        if(otherId && alsoPartnerCheck.checked){
          linkPartners(newPerson.id, Number(otherId), alsoPartnerStatus.value);
        }
      }
    } else {
      const relation = document.querySelector('input[name=relation]:checked')?.value || 'root';
      const newPerson = { id: nextId++, name, photo: pendingPhoto, parents: [], partners: [], ...extra };
      if(relation==='child'){
        newPerson.parents = Array.from(parentPick.querySelectorAll('.parent-check:checked')).map(el=>Number(el.value)).slice(0,2);
        people.push(newPerson);
      } else if(relation==='partner'){
        const sel = partnerPick.querySelector('input[name=partnerRadio]:checked');
        people.push(newPerson);
        if(sel) linkPartners(newPerson.id, Number(sel.value), statusSelect.value);
      } else if(relation==='parent'){
        // The new person becomes a parent of everyone ticked. Guarded at two
        // parents each, since the layout (and reality) assume at most two.
        const targets = Array.from(childPick.querySelectorAll('.child-check:checked')).map(el=>Number(el.value));
        people.push(newPerson);
        const coParents = new Set();
        targets.forEach(cid=>{
          const child = people.find(x=>x.id===cid);
          if(!child) return;
          child.parents = child.parents || [];
          if(child.parents.includes(newPerson.id)) return;
          if(child.parents.filter(id=>people.some(x=>x.id===id)).length >= 2) return;
          // Remember anyone they now co-parent with, to offer pairing below.
          child.parents.filter(id=>people.some(x=>x.id===id)).forEach(id=>coParents.add(id));
          child.parents.push(newPerson.id);
        });
        // If every child ticked shares exactly one existing parent, that
        // person is almost certainly this one's partner — confirm rather
        // than assume, since it's a real claim about a relationship.
        if(coParents.size === 1){
          const other = people.find(x=>x.id===[...coParents][0]);
          if(other && confirm(`Is ${name} also ${other.name}'s partner?`)){
            linkPartners(newPerson.id, other.id, 'married');
          }
        }
      } else {
        people.push(newPerson);
      }
    }
    closeModal(); render();
    const ok = await saveTree();
    if(!ok) await loadTree(); // roll back to server state if save failed
  };

  deleteBtn.onclick = async ()=>{
    if(!editingId) return;
    const target = people.find(p=>p.id===editingId);
    if(target && target.locked){ alert('This person is locked. Uncheck "Lock this person" first, then you can delete them.'); return; }
    if(!confirm('Delete this person? Related children and partners will keep their own records, minus this link.')) return;
    people.forEach(p=>{
      p.parents = p.parents.filter(pid=>pid!==editingId);
      p.partners = p.partners.filter(pt=>pt.id!==editingId);
    });
    people = people.filter(p=>p.id!==editingId);
    closeModal(); render();
    const ok = await saveTree();
    if(!ok) await loadTree();
  };

  nodesLayer.addEventListener('click', e=>{
    const btn = e.target.closest('button[data-act]');
    const card = e.target.closest('.card');
    if(!card) return;
    const id = Number(card.dataset.id);
    if(!Auth.isAuthed()){ openBioModal(id); return; }
    if(btn){
      const act = btn.dataset.act;
      if(act==='edit') openModal(id);
      else if(act==='child') openModal(null, {type:'child', from:id});
      else if(act==='partner') openModal(null, {type:'partner', from:id});
      else if(act==='parent') openModal(null, {type:'parent', from:id});
    } else {
      openModal(id);
    }
  });

  // ---------- Public API for the shared search module ----------
  // Kept deliberately small: search shouldn't need to know anything about
  // layout modes, projections or transforms — just "who is there" and
  // "take me to this person".
  window.TreeView = {
    listPeople: ()=>people.map(p=>({id:p.id, name:p.name, nickname:p.nickname, photo:p.photo, dob:p.dob, dod:p.dod})),
    focusPerson(id){
      if(threeMounted && window.Constellation3D.select && window.Constellation3D.select(id)) return true;
      const P = lastPositions[id];
      if(!P) return false;
      // Centre the viewport on them at a comfortable reading zoom.
      zoom = Math.max(zoom, mode==='constellation' ? 1.0 : 1.15);
      pan.x = -P.x*zoom;
      pan.y = -P.y*zoom;
      applyTransform();
      setLineageHighlight(id);
      const el = nodesLayer.querySelector(`.node[data-id="${id}"]`);
      if(el){
        el.classList.add('search-hit');
        setTimeout(()=>el.classList.remove('search-hit'), 2200);
      }
      return true;
    },
    clearHighlight(){ clearLineageHighlight(); },
    openPerson(id){ openBioModal(id); },
  };

  function showConstellationWarning(msg){
    let el = document.getElementById('constellationWarning');
    if(!el){
      el = document.createElement('div');
      el.id = 'constellationWarning';
      el.className = 'constellation-warning';
      viewport.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
  }
  function hideConstellationWarning(){
    const el = document.getElementById('constellationWarning');
    if(el) el.style.display = 'none';
  }

  // Keep the 3D scene's palette in step with light/dark mode.
  new MutationObserver(()=>{
    if(threeMounted && window.Constellation3D.setTheme){
      window.Constellation3D.setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light');
    }
  }).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

  // ---------- Init ----------
  Auth.checkStatus().then(loadTree).then(()=>{
    // Deep link: index.html?person=ID focuses (and opens) that person once
    // the tree has loaded. This is what makes the cross-family jump land on
    // the right relative rather than just dumping you at the other tree.
    const wanted = Number(new URLSearchParams(location.search).get('person'));
    if(!wanted) return;
    const target = people.find(p=>p.id===wanted);
    if(!target) return;
    if(window.TreeView && window.TreeView.focusPerson) window.TreeView.focusPerson(wanted);
    openBioModal(wanted);
  });
})();