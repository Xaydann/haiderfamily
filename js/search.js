// search.js — a shared, keyboard-first search palette used by the tree and
// timeline pages.
//
// Two ways in, because discoverability matters: just start typing anywhere
// on the page, or click the search icon in the nav. Typing is only captured
// when it clearly isn't meant for something else — never while a field is
// focused, a modal is open, or a modifier key is held.

(function(){
  const host = document.getElementById('searchHost');
  if(!host) return;

  host.innerHTML = `
    <div class="search-overlay" id="searchOverlay">
      <div class="search-panel" role="dialog" aria-label="Search people">
        <div class="search-inputrow">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input type="text" id="searchInput" placeholder="Search people…" autocomplete="off" spellcheck="false">
          <kbd class="search-esc">esc</kbd>
        </div>
        <div class="search-results" id="searchResults"></div>
        <div class="search-hint">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
          <span><kbd>&crarr;</kbd> go to</span>
          <span>start typing anywhere to search</span>
        </div>
      </div>
    </div>`;

  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  const resultsEl = document.getElementById('searchResults');
  let results = [];
  let activeIndex = 0;

  const AVATAR_COLORS = ['#2f4a3c','#5a6e8c','#8c6a4f','#7a5a7c','#3c6e6a','#8c5a4f'];
  function colorFor(seed){
    let h=0; seed=String(seed||'?');
    for(let i=0;i<seed.length;i++) h = seed.charCodeAt(i) + ((h<<5)-h);
    return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length];
  }
  function initials(name){
    return String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
  }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Subsequence match with a simple relevance score: exact prefix beats
  // word-start beats a scattered subsequence, so typing "jo" surfaces
  // "John" before "Marjorie".
  function score(haystack, needle){
    if(!needle) return 0;
    const h = String(haystack||'').toLowerCase(), n = needle.toLowerCase();
    if(!h) return -1;
    if(h === n) return 1000;
    if(h.startsWith(n)) return 800 - h.length;
    const wordStart = h.split(/\s+/).some(w=>w.startsWith(n));
    if(wordStart) return 600 - h.length;
    if(h.includes(n)) return 400 - h.length;
    // scattered subsequence (typo-tolerant-ish)
    let i=0;
    for(const ch of h){ if(ch===n[i]) i++; if(i===n.length) break; }
    return i===n.length ? 150 - h.length : -1;
  }

  // Whichever view this page provides. Each exposes the same tiny
  // contract, so search itself stays page-agnostic.
  function activeView(){
    return [window.TreeView, window.TimelineView, window.MapView]
      .find(v => v && typeof v.listPeople === 'function' && typeof v.focusPerson === 'function') || null;
  }
  function peopleSource(){
    const v = activeView();
    return v ? v.listPeople() : [];
  }

  function search(q){
    const people = peopleSource();
    if(!q.trim()){
      return people.slice(0,8).map(p=>({p, s:0}));
    }
    return people
      .map(p=>{
        const s = Math.max(score(p.name, q), score(p.nickname, q) - 20);
        return {p, s};
      })
      .filter(r=>r.s >= 0)
      .sort((a,b)=>b.s-a.s)
      .slice(0, 12);
  }

  function renderResults(){
    if(!results.length){
      resultsEl.innerHTML = `<div class="search-empty">No one found</div>`;
      return;
    }
    resultsEl.innerHTML = results.map((r,i)=>{
      const p = r.p;
      const style = p.photo ? `background-image:url(${p.photo})` : `background-color:${colorFor(p.name)}`;
      const years = [p.dob?String(p.dob).slice(0,4):'', p.dod?String(p.dod).slice(0,4):'']
        .filter(Boolean).join('–');
      return `<button class="search-result${i===activeIndex?' active':''}" data-idx="${i}" data-id="${p.id}">
        <span class="sr-avatar" style="${style}">${p.photo?'':initials(p.name)}</span>
        <span class="sr-body">
          <span class="sr-name">${escapeHtml(p.name||'Unnamed')}</span>
          ${p.nickname?`<span class="sr-nick">"${escapeHtml(p.nickname)}"</span>`:''}
        </span>
        ${years?`<span class="sr-years">${escapeHtml(years)}</span>`:''}
      </button>`;
    }).join('');
    const active = resultsEl.querySelector('.search-result.active');
    if(active) active.scrollIntoView({block:'nearest'});
  }

  function open(prefill){
    // Nothing to search on a page with no people view (e.g. the forum) —
    // stay out of the way rather than opening an empty palette.
    if(!activeView()) return;
    overlay.classList.add('show');
    input.value = prefill || '';
    results = search(input.value);
    activeIndex = 0;
    renderResults();
    setTimeout(()=>{ input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 10);
  }
  function close(){
    overlay.classList.remove('show');
    input.value='';
  }
  function choose(i){
    const r = results[i];
    if(!r) return;
    close();
    // Each page decides what "go to this person" means for it.
    const v = activeView();
    if(v) v.focusPerson(r.p.id);
  }

  input.addEventListener('input', ()=>{
    results = search(input.value);
    activeIndex = 0;
    renderResults();
  });
  input.addEventListener('keydown', e=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); activeIndex=Math.min(activeIndex+1, results.length-1); renderResults(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeIndex=Math.max(activeIndex-1, 0); renderResults(); }
    else if(e.key==='Enter'){ e.preventDefault(); choose(activeIndex); }
    else if(e.key==='Escape'){ e.preventDefault(); close(); }
  });
  resultsEl.addEventListener('click', e=>{
    const btn = e.target.closest('.search-result');
    if(btn) choose(Number(btn.dataset.idx));
  });
  resultsEl.addEventListener('mousemove', e=>{
    const btn = e.target.closest('.search-result');
    if(btn && Number(btn.dataset.idx)!==activeIndex){
      activeIndex = Number(btn.dataset.idx);
      renderResults();
    }
  });
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });
  document.querySelectorAll('.search-trigger').forEach(btn=>{
    // Hide the icon entirely on pages that have nothing to search.
    if(!activeView()){ btn.style.display = 'none'; return; }
    btn.addEventListener('click', ()=>open(''));
  });

  // ---- Type anywhere to search ----
  // Only capture a keystroke when it plainly isn't intended for something
  // else: no modifiers, not already typing in a field, no modal open, and
  // only for real printable characters.
  window.addEventListener('keydown', e=>{
    if(overlay.classList.contains('show')) return;
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    const tag = el && el.tagName;
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (el && el.isContentEditable)) return;
    if(document.querySelector('.overlay.show')) return; // another modal owns the keyboard

    if(e.key==='/' ){ e.preventDefault(); open(''); return; }
    if(e.key.length===1 && /\S/.test(e.key)){
      e.preventDefault();
      open(e.key);
    }
  });
})();