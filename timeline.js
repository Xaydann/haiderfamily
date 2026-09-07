// timeline.js — aggregates every recorded life event (plus automatic
// birth/passing entries) into one chronological view. Read-only, public
// (matching how viewing the tree itself is public), scoped to whichever
// family is selected via Auth. A ?person=ID param filters to just that
// person's own timeline.

(function(){
  const listEl = document.getElementById('timelineList');
  const emptyEl = document.getElementById('emptyTimeline');
  const headerEl = document.getElementById('timelineHeader');
  const params = new URLSearchParams(location.search);
  let loadedPeople = [];
  const personFilter = params.get('person') ? Number(params.get('person')) : null;

  function initials(name){
    return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
  }
  const AVATAR_COLORS = ['#2f4a3c','#5a6e8c','#8c6a4f','#7a5a7c','#3c6e6a','#8c5a4f'];
  function colorFor(seed){
    let hash = 0;
    for(let i=0;i<seed.length;i++) hash = seed.charCodeAt(i) + ((hash<<5)-hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }
  function formatDate(d){
    if(!d) return '';
    try{ return new Date(d+'T00:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}); }
    catch(e){ return d; }
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function avatarStyleFor(person){
    return person.photo ? `background-image:url(${person.photo})` : `background-color:${colorFor(person.name||'?')}`;
  }
  function personLink(person){
    const family = Auth.family;
    const qs = (family!=='main' ? `family=${encodeURIComponent(family)}&` : '') + `person=${person.id}`;
    return `timeline.html?${qs}`;
  }

  function render(events, peopleById){
    if(!events.length){
      emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      return;
    }
    emptyEl.style.display = 'none';
    let lastYear = null;
    const parts = [];
    events.forEach(ev=>{
      const year = (ev.date||'').slice(0,4);
      if(year !== lastYear){
        parts.push(`<div class="timeline-year">${escapeHtml(year)}</div>`);
        lastYear = year;
      }
      const participants = (ev.people||[]).map(pid=>peopleById.get(pid)).filter(Boolean);
      const avatars = participants.slice(0,4).map(p=>
        `<a href="${personLink(p)}" class="ti-avatar" title="${escapeHtml(p.name)}" style="${avatarStyleFor(p)}">${p.photo?'':initials(p.name)}</a>`
      ).join('');
      const names = participants.map(p=>escapeHtml(p.name||'Unknown')).join(', ');
      parts.push(`
        <div class="timeline-item" data-people="${(ev.people||[]).join(',')}">
          <div class="ti-dot"></div>
          <div class="ti-card">
            <div class="ti-top">
              <div class="ti-avatars">${avatars}</div>
              <div>
                <div class="ti-person">${names||'Unknown'}</div>
                <div class="ti-date">${formatDate(ev.date)}</div>
              </div>
            </div>
            <div class="ti-title">${escapeHtml(ev.title||'')}</div>
            ${ev.description ? `<div class="ti-desc">${escapeHtml(ev.description)}</div>` : ''}
          </div>
        </div>`);
    });
    listEl.innerHTML = parts.join('');
  }

  function renderHeader(person){
    if(!person){
      headerEl.innerHTML = `<h1>Timeline</h1><p class="hint-sm">Every life event recorded across the tree, oldest to newest.</p>`;
      return;
    }
    headerEl.innerHTML = `
      <div class="timeline-person-header">
        <div class="tph-avatar" style="${avatarStyleFor(person)}">${person.photo?'':initials(person.name)}</div>
        <div>
          <h1>${escapeHtml(person.name||'Unnamed')}'s timeline</h1>
          <a class="hint-sm" href="timeline.html${Auth.family!=='main'?'?family='+encodeURIComponent(Auth.family):''}" style="display:inline-block;">&larr; View everyone's timeline</a>
        </div>
      </div>`;
  }

  async function load(){
    try{
      const res = await fetch(Auth.apiUrl('api/tree.php'));
      const data = await res.json();
      const people = data.people || [];
      loadedPeople = people;
      const peopleById = new Map(people.map(p=>[p.id,p]));

      // Automatic birth/passing entries, one per person, synthesized fresh
      // each time (never stored) so they always stay in sync with dob/dod.
      const events = [];
      people.forEach(p=>{
        if(p.dob) events.push({title:'Born', date:p.dob, description:'', people:[p.id]});
        if(p.dod) events.push({title:'Passed away', date:p.dod, description:'', people:[p.id]});
      });
      (data.events||[]).forEach(ev=>{
        if(ev && ev.date && ev.people && ev.people.length) events.push(ev);
      });

      const filtered = personFilter!=null
        ? events.filter(ev=>ev.people.includes(personFilter))
        : events;
      filtered.sort((a,b)=> a.date.localeCompare(b.date) || String(a.title).localeCompare(String(b.title)));

      renderHeader(personFilter!=null ? peopleById.get(personFilter) : null);
      render(filtered, peopleById);
    }catch(e){
      listEl.innerHTML = '';
      emptyEl.textContent = 'Could not load the timeline — try refreshing.';
      emptyEl.style.display = 'block';
    }
  }

  // ---------- Public API for the shared search module ----------
  window.TimelineView = {
    listPeople: ()=>loadedPeople.map(p=>({id:p.id, name:p.name, nickname:p.nickname, photo:p.photo, dob:p.dob, dod:p.dod})),
    focusPerson(id){
      // Highlight every entry this person appears in, and scroll to the
      // first one so the match is immediately visible.
      const items = Array.from(document.querySelectorAll('.timeline-item'));
      let first = null;
      items.forEach(it=>{
        const ids = (it.dataset.people||'').split(',').filter(Boolean).map(Number);
        const hit = ids.includes(Number(id));
        it.classList.toggle('search-hit', hit);
        it.classList.toggle('search-dim', !hit);
        if(hit && !first) first = it;
      });
      if(first) first.scrollIntoView({behavior:'smooth', block:'center'});
      clearTimeout(window.__tlHighlightTimer);
      window.__tlHighlightTimer = setTimeout(()=>{
        items.forEach(it=>it.classList.remove('search-hit','search-dim'));
      }, 4000);
      return !!first;
    },
  };

  load().then(()=>{});
})();