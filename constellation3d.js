// constellation3d.js — real GPU-accelerated 3D for the constellation view.
//
// Why this exists: the first version positioned DOM cards with CSS
// transforms and rebuilt the whole node layer on every mousemove frame.
// That had two fatal problems. (1) Lag — hundreds of DOM nodes restyled
// per frame is the slowest possible way to animate. (2) Overlap — with
// perspective, a near card scaled up to ~2.3x, so a 104px card drew ~235px
// wide while its neighbours were only ~135px apart, guaranteeing collisions
// no matter how the layout was tuned.
//
// Three.js fixes both properly: sprites are drawn by the GPU in a single
// pass (so orbiting is smooth at hundreds of nodes), sprites are a fixed
// world size so perspective shrinks distant ones without the near ones
// bloating past their neighbours, and all the connecting lines live in one
// merged geometry instead of hundreds of SVG paths.

(function(){
  const NS = {};
  window.Constellation3D = NS;

  let renderer, scene, camera, raycaster, pointer;
  let spriteGroup, lineGroup;
  let sprites = [];            // {sprite, personId}
  let container = null;
  let keyHandler = null, keyUpHandler = null, blurHandler = null;
  const held = new Set();
  let shiftHeld = false;
  let vel = {x:0,y:0,z:0};
  let defaultDist = 1400;
  let running = false;
  let hovered = null;
  let selected = null;
  let moved = 0;
  let onSelect = null, onHover = null;
  let people = [], positions = {};

  // Orbit state (hand-rolled: OrbitControls isn't bundled with the core
  // three build, and this only needs orbit + zoom).
  // Camera holds a TARGET and eases toward it every frame. Direct
  // assignment made movement feel abrupt and hard to control; damping is
  // what makes an orbit camera feel good to fly.
  let camTheta = 0.6, camPhi = 1.15, camDist = 1400;
  let tgtTheta = 0.6, tgtPhi = 1.15, tgtDist = 1400;
  let pivot = {x:0,y:0,z:0}, tgtPivot = {x:0,y:0,z:0};
  const EASE = 0.12;
  let dragging = false, lastX = 0, lastY = 0;

  // The constellation viewport is ALWAYS a dark starfield, whatever the
  // site theme is. Using the light palette here painted near-black text on
  // a near-black sky — invisible. So this palette is fixed, not themed.
  const PAL = {
    line:     0x3d5470,   // resting: deliberately faint, just a hint of structure
    lineHot:  0xcfe9ff,   // highlighted lineage: bright and glowing
    label:    '#dce6f7',
    labelHot: '#ffffff',
    sub:      '#8fa3c2',
    ring:     'rgba(190,220,255,0.55)',
  };

  const AVATAR_COLORS = ['#2f4a3c','#5a6e8c','#8c6a4f','#7a5a7c','#3c6e6a','#8c5a4f'];
  function colorFor(seed){
    let h=0; seed=String(seed||'?');
    for(let i=0;i<seed.length;i++) h = seed.charCodeAt(i) + ((h<<5)-h);
    return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length];
  }
  // Fit text to an actual pixel width by shrinking the font, then
  // ellipsising only if it's still too wide. Truncating by CHARACTER COUNT
  // was the bug behind clipped names — "Syed Mohammed Haider" is 20 chars
  // but far wider than 20 narrow ones, so it overran the canvas on both
  // sides regardless of the character limit.
  function fitText(ctx, text, maxWidth, startPx, weight){
    let size = startPx;
    const font = px => `${weight} ${px}px Inter, system-ui, sans-serif`;
    ctx.font = font(size);
    while(ctx.measureText(text).width > maxWidth && size > startPx*0.6){
      size -= 1;
      ctx.font = font(size);
    }
    if(ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while(t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) t = t.slice(0, -1);
    return t + '\u2026';
  }

  function initials(name){
    return String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
  }

  // Two textures per person. The resting state is a STAR: a small glowing
  // point with their name underneath, so a big family reads as a night sky
  // rather than a wall of cards. Hovering swaps in the expanded texture
  // (avatar + name) and scales the sprite up.
  function drawStar(person, hot){
    const W=420, H=260;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const ctx=c.getContext('2d');
    const cx=W/2, cy=70;
    const tint = colorFor(person.name);

    // glow halo
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,hot?54:38);
    g.addColorStop(0, hot?'rgba(255,255,255,0.98)':'rgba(255,255,255,0.9)');
    g.addColorStop(0.28, tint);
    g.addColorStop(1, 'rgba(10,14,24,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(cx,cy,hot?54:38,0,Math.PI*2); ctx.fill();

    // core
    ctx.beginPath(); ctx.arc(cx,cy,hot?11:7,0,Math.PI*2);
    ctx.fillStyle = '#ffffff'; ctx.fill();

    const name=String(person.name||'Unnamed');
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle = hot ? PAL.labelHot : PAL.label;
    if(hot){ ctx.shadowColor='rgba(120,190,255,0.9)'; ctx.shadowBlur=12; }
    const shown = fitText(ctx, name, W-24, hot?30:27, hot?600:500);
    ctx.fillText(shown, cx, 132);
    ctx.shadowBlur=0;

    const years=[person.dob?String(person.dob).slice(0,4):'', person.dod?String(person.dod).slice(0,4):'']
      .filter(Boolean).join('\u2013');
    if(years){
      ctx.fillStyle=PAL.sub;
      ctx.font='400 22px Inter, system-ui, sans-serif';
      ctx.fillText(years, cx, 170);
    }
    const t=new THREE.CanvasTexture(c); t.anisotropy=4; t.needsUpdate=true; return t;
  }

  function drawExpanded(person, photoImg){
    const W=460, H=340;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const ctx=c.getContext('2d');
    const cx=W/2, cy=100, R=68;

    // outer glow so the focused person clearly pops off the sky
    const g=ctx.createRadialGradient(cx,cy,R*0.6,cx,cy,R*1.7);
    g.addColorStop(0,'rgba(150,205,255,0.5)');
    g.addColorStop(1,'rgba(10,14,24,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,R*1.7,0,Math.PI*2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.closePath();
    if(photoImg){
      ctx.clip();
      const sc=Math.max((R*2)/photoImg.width,(R*2)/photoImg.height);
      const w=photoImg.width*sc, h=photoImg.height*sc;
      ctx.drawImage(photoImg, cx-w/2, cy-h/2, w, h);
    } else {
      ctx.fillStyle=colorFor(person.name); ctx.fill();
      ctx.fillStyle='#fff';
      ctx.font='600 50px Fraunces, Georgia, serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(initials(person.name), cx, cy+2);
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2);
    ctx.strokeStyle=PAL.ring; ctx.lineWidth=5; ctx.stroke();

    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle=PAL.labelHot;
    ctx.shadowColor='rgba(120,190,255,0.9)'; ctx.shadowBlur=14;
    const name=String(person.name||'Unnamed');
    ctx.fillText(fitText(ctx, name, W-28, 32, 600), cx, 196);
    ctx.shadowBlur=0;

    const years=[person.dob?String(person.dob).slice(0,4):'', person.dod?String(person.dod).slice(0,4):'']
      .filter(Boolean).join('\u2013');
    if(years){
      ctx.fillStyle=PAL.sub; ctx.font='400 24px Inter, system-ui, sans-serif';
      ctx.fillText(years, cx, 240);
    }
    const t=new THREE.CanvasTexture(c); t.anisotropy=4; t.needsUpdate=true; return t;
  }

  const STAR_SCALE=[194,120,1];  // matches the 420x260 star canvas
  const HOT_SCALE=[290,214,1];   // matches the 460x340 expanded canvas

  // ---------- Cosmic backdrop ----------
  // A procedurally painted nebula on the inside of a huge sphere, plus two
  // layers of distant point-stars. Everything here is deliberately dim and
  // low-contrast: it should read as depth behind the family, never compete
  // with it. Drawn once into a texture, so it costs nothing per frame.
  let skyMesh=null, starFields=[];

  function paintNebula(){
    const W=2048, H=1024;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const ctx=c.getContext('2d');

    // deep space base, very slightly blue rather than pure black
    const base=ctx.createLinearGradient(0,0,0,H);
    base.addColorStop(0,'#05070d');
    base.addColorStop(0.5,'#080b14');
    base.addColorStop(1,'#05070c');
    ctx.fillStyle=base; ctx.fillRect(0,0,W,H);

    // Soft gas clouds. Additive blending and low alpha keep them as a haze
    // rather than blobs; the palette stays in cool blues/violets with one
    // warm ember so it doesn't feel monochrome.
    const clouds=[
      {x:0.18,y:0.30,r:0.34,c:'70,110,200'},
      {x:0.72,y:0.22,r:0.30,c:'120,80,190'},
      {x:0.52,y:0.68,r:0.38,c:'50,120,150'},
      {x:0.88,y:0.72,r:0.26,c:'160,90,140'},
      {x:0.32,y:0.82,r:0.24,c:'90,70,180'},
      {x:0.05,y:0.62,r:0.22,c:'180,110,80'},
    ];
    ctx.globalCompositeOperation='lighter';
    clouds.forEach(cl=>{
      // several offset passes give an irregular, wispy edge instead of a
      // perfect circle
      for(let k=0;k<5;k++){
        const jx=(Math.random()-0.5)*0.10*W, jy=(Math.random()-0.5)*0.10*H;
        const cx=cl.x*W+jx, cy=cl.y*H+jy, rr=cl.r*Math.min(W,H)*(0.55+Math.random()*0.5);
        const g=ctx.createRadialGradient(cx,cy,0,cx,cy,rr);
        g.addColorStop(0,`rgba(${cl.c},0.055)`);
        g.addColorStop(0.45,`rgba(${cl.c},0.022)`);
        g.addColorStop(1,`rgba(${cl.c},0)`);
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2); ctx.fill();
      }
    });

    // faint dust lanes across the band, like the Milky Way's plane
    for(let i=0;i<140;i++){
      const y=H*0.5+(Math.random()-0.5)*H*0.30;
      const x=Math.random()*W, len=40+Math.random()*220;
      const g=ctx.createLinearGradient(x,y,x+len,y+(Math.random()-0.5)*30);
      g.addColorStop(0,'rgba(150,180,230,0)');
      g.addColorStop(0.5,`rgba(150,180,230,${0.010+Math.random()*0.018})`);
      g.addColorStop(1,'rgba(150,180,230,0)');
      ctx.strokeStyle=g; ctx.lineWidth=1+Math.random()*7;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+len,y+(Math.random()-0.5)*30); ctx.stroke();
    }

    // background pinprick stars baked into the texture
    for(let i=0;i<2600;i++){
      const x=Math.random()*W, y=Math.random()*H;
      const r=Math.random()*0.9+0.25;
      const a=0.10+Math.random()*0.5;
      ctx.fillStyle=`rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';

    const t=new THREE.CanvasTexture(c);
    t.needsUpdate=true;
    return t;
  }

  function buildSky(){
    const R = 60000;
    const geo = new THREE.SphereGeometry(R, 40, 24);
    const mat = new THREE.MeshBasicMaterial({
      map: paintNebula(),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    skyMesh = new THREE.Mesh(geo, mat);
    skyMesh.renderOrder = -10;   // always behind everything
    scene.add(skyMesh);

    // Two point-star layers at different depths. Because they sit at finite
    // distance (unlike the painted sphere) they shift slightly as you fly,
    // giving real parallax — that's what sells depth rather than wallpaper.
    [
      {count: 1400, dist: 14000, size: 26, opacity: 0.55},
      {count: 900,  dist: 26000, size: 42, opacity: 0.35},
    ].forEach(layer=>{
      const pos=new Float32Array(layer.count*3);
      const col=new Float32Array(layer.count*3);
      for(let i=0;i<layer.count;i++){
        // even spread over a sphere shell
        const u=Math.random()*2-1, th=Math.random()*Math.PI*2;
        const rr=Math.sqrt(Math.max(0,1-u*u));
        const d=layer.dist*(0.75+Math.random()*0.5);
        pos[i*3]=Math.cos(th)*rr*d; pos[i*3+1]=u*d; pos[i*3+2]=Math.sin(th)*rr*d;
        // subtle colour variation: mostly white, some blue-white and amber
        const t=Math.random();
        const c = t<0.72 ? [1,1,1] : (t<0.9 ? [0.72,0.83,1.0] : [1.0,0.86,0.68]);
        const b = 0.5+Math.random()*0.5;
        col[i*3]=c[0]*b; col[i*3+1]=c[1]*b; col[i*3+2]=c[2]*b;
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos,3));
      g.setAttribute('color', new THREE.BufferAttribute(col,3));
      const m=new THREE.PointsMaterial({
        size: layer.size, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: layer.opacity, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts=new THREE.Points(g,m);
      pts.renderOrder=-9;
      scene.add(pts);
      starFields.push(pts);
    });
  }

  function buildSprites(){
    sprites.forEach(s=>{
      ['star','starHot','expanded'].forEach(k=>{ if(s.tex[k]) s.tex[k].dispose(); });
      s.sprite.material.dispose();
    });
    spriteGroup.clear();
    sprites=[];

    people.forEach(p=>{
      const pos=positions[p.id];
      if(!pos) return;
      const tex={ star:drawStar(p,false), starHot:drawStar(p,true), expanded:null };
      const mat=new THREE.SpriteMaterial({map:tex.star, transparent:true, depthWrite:false});
      const sprite=new THREE.Sprite(mat);
      sprite.position.set(pos.x3,pos.y3,pos.z3);
      sprite.scale.set(STAR_SCALE[0],STAR_SCALE[1],1);
      sprite.userData.personId=p.id;
      spriteGroup.add(sprite);
      const rec={sprite,personId:p.id,tex,person:p,photoImg:null};
      sprites.push(rec);

      if(p.photo){
        const img=new Image(); img.crossOrigin='anonymous';
        img.onload=()=>{ rec.photoImg=img; if(rec.tex.expanded){ rec.tex.expanded.dispose(); rec.tex.expanded=null; } };
        img.src=p.photo;
      }
    });
  }

  // Lineage = this person plus all their ancestors and descendants. Built
  // once from the people list so hovering is a cheap set lookup.
  let kidsOf=new Map(), parentsOf=new Map();
  function buildRelations(){
    kidsOf=new Map(); parentsOf=new Map();
    people.forEach(p=>{
      parentsOf.set(p.id, (p.parents||[]).slice());
      (p.parents||[]).forEach(pid=>{
        if(!kidsOf.has(pid)) kidsOf.set(pid,[]);
        kidsOf.get(pid).push(p.id);
      });
    });
  }
  function lineageOf(id){
    const out=new Set([id]);
    const up=[id];
    while(up.length){
      const cur=up.pop();
      (parentsOf.get(cur)||[]).forEach(pid=>{ if(!out.has(pid)){ out.add(pid); up.push(pid); } });
    }
    const down=[id];
    while(down.length){
      const cur=down.pop();
      (kidsOf.get(cur)||[]).forEach(cid=>{ if(!out.has(cid)){ out.add(cid); down.push(cid); } });
    }
    return out;
  }

  function applyHighlight(id){
    const lin = id==null ? null : lineageOf(id);
    sprites.forEach(rec=>{
      const inLin = lin ? lin.has(rec.personId) : true;
      const isHot = rec.personId===id;
      if(isHot){
        if(!rec.tex.expanded) rec.tex.expanded = drawExpanded(rec.person, rec.photoImg);
        rec.sprite.material.map = rec.tex.expanded;
        rec.sprite.scale.set(HOT_SCALE[0],HOT_SCALE[1],1);
        rec.sprite.material.opacity = 1;
      } else {
        rec.sprite.material.map = inLin && lin ? rec.tex.starHot : rec.tex.star;
        const sc = (inLin && lin) ? 1.22 : 1;
        rec.sprite.scale.set(STAR_SCALE[0]*sc, STAR_SCALE[1]*sc, 1);
        rec.sprite.material.opacity = lin ? (inLin ? 1 : 0.22) : 1;
      }
      rec.sprite.material.needsUpdate = true;
    });
    paintLines(lin);
  }

  // Edges are stored as data; the geometry is REBUILT to contain only the
  // lineage being shown. Previously non-lineage lines were merely recoloured
  // dark, but a dark stroke over a dark sky is still a visible stroke — the
  // only way to truly not see them is to not draw them.
  let lineSegs=null, allEdges=[];
  function buildLines(){
    lineGroup.clear();
    lineSegs=null;
    allEdges=[];
    people.forEach(p=>{
      if(!positions[p.id]) return;
      (p.parents||[]).forEach(pid=>{
        if(!positions[pid]) return;
        allEdges.push([pid, p.id]);
      });
    });
    const seen=new Set();
    people.forEach(p=>{
      (p.partners||[]).forEach(pt=>{
        const key=[p.id,pt.id].sort((a,b)=>a-b).join('-');
        if(seen.has(key)) return; seen.add(key);
        if(!positions[p.id] || !positions[pt.id]) return;
        allEdges.push([p.id, pt.id]);
      });
    });
    paintLines(null);
  }

  function paintLines(lin){
    // Nothing selected -> no lines exist at all, so the resting view is
    // purely stars.
    if(lineSegs){
      lineSegs.geometry.dispose();
      lineSegs.material.dispose();
      lineGroup.remove(lineSegs);
      lineSegs=null;
    }
    if(!lin) return;

    // Only edges where BOTH ends are in the selected lineage get built.
    const verts=[];
    allEdges.forEach(([a,b])=>{
      if(!lin.has(a) || !lin.has(b)) return;
      const pa=positions[a], pb=positions[b];
      verts.push(pa.x3,pa.y3,pa.z3, pb.x3,pb.y3,pb.z3);
    });
    if(!verts.length) return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
    const mat=new THREE.LineBasicMaterial({color:PAL.lineHot, transparent:true, opacity:0.9});
    lineSegs=new THREE.LineSegments(geo,mat);
    lineGroup.add(lineSegs);
  }

  // Two camera modes:
  //  - Nothing selected -> FREE LOOK. The camera stays put and the view
  //    direction turns, like looking around from where you're standing.
  //  - Someone selected -> ORBIT. The camera circles that person, which is
  //    what you want when you're studying one branch.
  // Both ease toward a target rather than snapping, so movement glides.
  let camPos = {x:0,y:0,z:1400};
  function lookDir(){
    return [
      Math.sin(camPhi)*Math.cos(camTheta),
      Math.cos(camPhi),
      Math.sin(camPhi)*Math.sin(camTheta),
    ];
  }
  // Applies whichever movement keys are currently held, as a smoothly
  // accelerating/decelerating velocity. Speed is deliberately gentle and
  // scales with how far out you are, so it feels controlled up close and
  // still covers ground when surveying the whole cluster.
  function stepMovement(){
    const d = lookDir();
    const F = [-d[0], -d[1], -d[2]];              // forward = where we look
    const R = [-F[2], 0, F[0]];                   // right, in the horizontal plane
    const rl = Math.hypot(R[0], R[2]) || 1; R[0]/=rl; R[2]/=rl;

    const speed = (selected!=null ? camDist : defaultDist) * 0.0042 * (shiftHeld ? 2.6 : 1);
    let ax=0, ay=0, az=0;
    if(held.has('fwd'))  { ax+=F[0]*speed; ay+=F[1]*speed; az+=F[2]*speed; }
    if(held.has('back')) { ax-=F[0]*speed; ay-=F[1]*speed; az-=F[2]*speed; }
    if(held.has('left')) { ax-=R[0]*speed; az-=R[2]*speed; }
    if(held.has('right')){ ax+=R[0]*speed; az+=R[2]*speed; }
    if(held.has('up'))   { ay+=speed; }
    if(held.has('down')) { ay-=speed; }

    // Ease the velocity toward the requested direction, then decay it when
    // keys are released — that's what removes the start/stop jerkiness.
    const ACCEL = 0.10, DAMP = 0.90;  // gentler ramp, longer glide
    vel.x += (ax-vel.x)*ACCEL;
    vel.y += (ay-vel.y)*ACCEL;
    vel.z += (az-vel.z)*ACCEL;
    if(!held.size){ vel.x*=DAMP; vel.y*=DAMP; vel.z*=DAMP; }
    if(Math.abs(vel.x)<0.01 && Math.abs(vel.y)<0.01 && Math.abs(vel.z)<0.01) return;
    tgtPivot = {x:tgtPivot.x+vel.x, y:tgtPivot.y+vel.y, z:tgtPivot.z+vel.z};
  }

  function stepCamera(){
    stepMovement();
    tgtPhi = Math.max(0.12, Math.min(Math.PI-0.12, tgtPhi));
    camTheta += (tgtTheta-camTheta)*EASE;
    camPhi   += (tgtPhi-camPhi)*EASE;
    camDist  += (tgtDist-camDist)*EASE;
    pivot.x  += (tgtPivot.x-pivot.x)*EASE;
    pivot.y  += (tgtPivot.y-pivot.y)*EASE;
    pivot.z  += (tgtPivot.z-pivot.z)*EASE;

    const d = lookDir();
    if(selected != null){
      // Orbit: position is derived from the pivot (the selected person).
      camera.position.set(
        pivot.x + camDist*d[0],
        pivot.y + camDist*d[1],
        pivot.z + camDist*d[2]
      );
      camera.lookAt(pivot.x, pivot.y, pivot.z);
      camPos = {x:camera.position.x, y:camera.position.y, z:camera.position.z};
    } else {
      // Free look: the pivot IS our position; we look outward from it.
      camPos = {x:pivot.x, y:pivot.y, z:pivot.z};
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(
        camPos.x - d[0]*1000,
        camPos.y - d[1]*1000,
        camPos.z - d[2]*1000
      );
    }
  }
  function updateCamera(){ stepCamera(); }

  function resize(){
    if(!container || !renderer) return;
    const w = container.clientWidth, h = container.clientHeight;
    if(!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  }

  function animate(){
    if(!running) return;
    requestAnimationFrame(animate);
    stepCamera();
    // An almost imperceptible drift — enough that the sky feels alive,
    // slow enough that you'd never call it movement.
    if(skyMesh) skyMesh.rotation.y += 0.000045;
    if(starFields.length){
      starFields[0].rotation.y -= 0.000022;
      if(starFields[1]) starFields[1].rotation.y += 0.000014;
    }
    renderer.render(scene, camera);
  }

  NS.mount = function(opts){
    container = opts.container;
    people = opts.people || [];
    positions = opts.positions || {};

    onSelect = opts.onSelect;
    onHover = opts.onHover;

    if(typeof THREE === 'undefined'){
      return false; // caller falls back
    }

    renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    scene = new THREE.Scene();
    // Far plane must clear the skybox sphere (60000) and the outer star
    // layer, or the backdrop gets clipped away entirely.
    camera = new THREE.PerspectiveCamera(50, 1, 2, 160000);
    spriteGroup = new THREE.Group();
    lineGroup = new THREE.Group();
    scene.add(lineGroup);
    scene.add(spriteGroup);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    buildSky();
    buildRelations();
    buildLines();
    buildSprites();

    // Frame the whole cluster on first mount.
    const rs = Object.values(positions).map(p=>Math.hypot(p.x3,p.y3,p.z3));
    const maxR = rs.length ? Math.max(...rs) : 500;
    camDist = tgtDist = defaultDist = Math.max(600, maxR*2.6);
    // Free-look is the starting mode, and there the pivot IS the camera
    // position — so place it out along the view axis, looking back at the
    // cluster, instead of sitting at the origin inside it.
    {
      const d0 = [
        Math.sin(camPhi)*Math.cos(camTheta),
        Math.cos(camPhi),
        Math.sin(camPhi)*Math.sin(camTheta),
      ];
      pivot = {x:d0[0]*defaultDist, y:d0[1]*defaultDist, z:d0[2]*defaultDist};
      tgtPivot = {...pivot};
    }
    updateCamera();
    resize();

    const el = renderer.domElement;
    el.addEventListener('pointerdown', e=>{ dragging=true; moved=0; lastX=e.clientX; lastY=e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', e=>{ dragging=false; try{el.releasePointerCapture(e.pointerId);}catch(_){} });
    el.addEventListener('pointermove', e=>{
      if(dragging){
        // Movement feeds the TARGET, which the loop eases toward — that's
        // what keeps it from feeling twitchy.
        //
        // The horizontal sign flips between modes, and it has to. Orbiting,
        // you're dragging the CLUSTER around, so pulling right should swing
        // it right. In free look you're turning your own head, so pulling
        // right should turn you right — which is the opposite rotation.
        const hSign = (selected != null) ? -1 : 1;
        tgtTheta += hSign * (e.clientX-lastX)*0.005;
        tgtPhi   -= (e.clientY-lastY)*0.005;
        lastX=e.clientX; lastY=e.clientY;
        moved += Math.abs(e.movementX||0)+Math.abs(e.movementY||0);
        return;
      }
      // Hover now ONLY changes the cursor. Highlighting on hover was
      // distracting in 3D because the pointer is almost always over
      // somebody; selection is an explicit click instead.
      const r = el.getBoundingClientRect();
      pointer.x = ((e.clientX-r.left)/r.width)*2-1;
      pointer.y = -((e.clientY-r.top)/r.height)*2+1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(spriteGroup.children, false);
      const id = hits.length ? hits[0].object.userData.personId : null;
      if(id !== hovered){
        hovered = id;
        el.style.cursor = id!=null ? 'pointer' : 'grab';
      }
    });

    el.addEventListener('click', ()=>{
      // A drag shouldn't register as a click.
      if(moved > 6){ moved = 0; return; }
      moved = 0;
      if(hovered == null){
        if(selected != null){
          // Hand control back to free-look from exactly where the camera
          // currently is, so deselecting doesn't teleport the view.
          selected = null;
          applyHighlight(null);
          pivot = {x:camera.position.x, y:camera.position.y, z:camera.position.z};
          tgtPivot = {...pivot};
        }
        return;
      }
      if(selected === hovered){
        if(onSelect) onSelect(hovered);   // second click opens their page
        return;
      }
      selected = hovered;
      applyHighlight(selected);
      NS.focus(selected);                 // click-to-move: camera comes to them
    });

    el.addEventListener('wheel', e=>{
      e.preventDefault();
      tgtDist = Math.max(200, Math.min(14000, tgtDist * (e.deltaY>0 ? 1.12 : 0.89)));
    }, {passive:false});

    // Keyboard flight: WASD/arrows orbit, Q/E zoom, R resets. Gives a
    // second, more controllable way to move than dragging alone — and the
    // easing means holding a key glides rather than jerks.
    // Free flight. Arrow keys TRANSLATE the camera through the cluster.
    //
    // Keys are TRACKED as held-down state and applied every frame in the
    // animation loop, rather than moving once per keydown event. Relying on
    // the OS key-repeat made movement stutter: one jump, a pause, then a
    // burst. Continuous velocity with easing glides instead.
    const MOVE_KEYS = {
      ArrowUp:'fwd', ArrowDown:'back', ArrowLeft:'left', ArrowRight:'right',
      PageUp:'up', PageDown:'down',
    };
    keyHandler = e=>{
      const tag = document.activeElement && document.activeElement.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
      if(document.querySelector('.overlay.show')) return;

      if(MOVE_KEYS[e.key]){
        held.add(MOVE_KEYS[e.key]);
        shiftHeld = e.shiftKey;
        e.preventDefault();
        return;
      }
      if(e.key==='Home'){
        const h = lookDir();
        tgtPivot = selected!=null ? {x:0,y:0,z:0}
          : {x:h[0]*defaultDist, y:h[1]*defaultDist, z:h[2]*defaultDist};
        tgtDist = defaultDist;
        e.preventDefault();
      } else if(e.key==='Escape'){
        if(selected!=null){
          selected=null; applyHighlight(null);
          pivot = {x:camera.position.x, y:camera.position.y, z:camera.position.z};
          tgtPivot = {...pivot};
        }
        e.preventDefault();
      }
    };
    keyUpHandler = e=>{
      if(MOVE_KEYS[e.key]) held.delete(MOVE_KEYS[e.key]);
      if(!e.shiftKey) shiftHeld = false;
    };
    // Releasing focus shouldn't leave the camera drifting forever.
    blurHandler = ()=>held.clear();
    window.addEventListener('keyup', keyUpHandler);
    window.addEventListener('blur', blurHandler);
    window.addEventListener('keydown', keyHandler);

    window.addEventListener('resize', resize);
    running = true;
    animate();
    return true;
  };

  // The 3D sky is always dark, so there's no themed palette to swap.
  NS.setTheme = function(){ /* intentionally a no-op */ };

  NS.focus = function(personId){
    const p = positions[personId];
    if(!p || !camera) return false;
    // Orbit around the selected person from here on, and ease in rather
    // than snapping — the movement reads as the camera flying to them.
    tgtPivot = {x:p.x3, y:p.y3, z:p.z3};
    tgtDist = 1100;
    return true;
  };

  // Select from outside (e.g. the search palette).
  NS.select = function(personId){
    if(!positions[personId]) return false;
    selected = personId;
    applyHighlight(selected);
    NS.focus(personId);
    return true;
  };
  NS.clearSelection = function(){
    selected = null;
    applyHighlight(null);
  };

  NS.unmount = function(){
    running = false;
    window.removeEventListener('resize', resize);
    if(keyHandler) window.removeEventListener('keydown', keyHandler);
    if(keyUpHandler) window.removeEventListener('keyup', keyUpHandler);
    if(blurHandler) window.removeEventListener('blur', blurHandler);
    held.clear();
    vel = {x:0,y:0,z:0};
    if(renderer){
      sprites.forEach(s=>{
        ['star','starHot','expanded'].forEach(k=>{ if(s.tex && s.tex[k]) s.tex[k].dispose(); });
        s.sprite.material.dispose();
      });
      lineGroup.children.forEach(c=>{ c.geometry.dispose(); c.material.dispose(); });
      if(skyMesh){
        skyMesh.geometry.dispose();
        if(skyMesh.material.map) skyMesh.material.map.dispose();
        skyMesh.material.dispose();
        skyMesh=null;
      }
      starFields.forEach(p=>{ p.geometry.dispose(); p.material.dispose(); });
      starFields=[];
      renderer.dispose();
      if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = scene = camera = null;
    sprites = [];
    container = null;
  };
})();