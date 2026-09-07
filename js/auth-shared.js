// auth-shared.js — sign-in pill, login modal, and status polling shared by
// index.html (tree) and forum.html. Also owns which "family" is currently
// being viewed (?family=slug in the URL, defaulting to "main" — your
// original tree), so every API call this site makes goes through the same
// place and always hits the right family's data.

const Auth = (function(){
  let authed = false;
  let canAdmin = false;      // may perform admin-only actions right now
  let isAdmin = false;       // signed in with the admin password specifically
  let adminConfigured = false;
  let listeners = [];

  const FAMILY = (function(){
    const raw = new URLSearchParams(location.search).get('family') || 'main';
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9\-]/g,'').slice(0,40);
    return cleaned || 'main';
  })();

  function apiUrl(path){
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}family=${encodeURIComponent(FAMILY)}`;
  }

  const pill = document.getElementById('authPill');
  const signBtn = document.getElementById('signBtn');
  const loginOverlay = document.getElementById('loginOverlay');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');
  const loginCancel = document.getElementById('loginCancel');

  function onChange(fn){ listeners.push(fn); }
  function notify(){ listeners.forEach(fn=>fn(authed)); }

  function updatePill(){
    if(!pill || !signBtn) return;
    pill.classList.toggle('on', authed);
    pill.classList.toggle('admin', authed && isAdmin);
    pill.querySelector('.label').textContent = authed ? (isAdmin ? 'Admin' : 'Editing unlocked') : 'View only';
    signBtn.textContent = authed ? 'Sign out' : 'Sign in';
  }

  async function checkStatus(){
    try{
      const res = await fetch(apiUrl('api/auth.php?action=status'), {credentials:'include'});
      const data = await res.json();
      authed = !!data.authed;
      canAdmin = !!data.canAdmin;
      isAdmin = !!data.admin;
      adminConfigured = !!data.adminConfigured;
    }catch(e){ authed = false; canAdmin = false; isAdmin = false; }
    updatePill();
    notify();
    return authed;
  }

  function openLogin(){
    loginError.classList.remove('show');
    loginPassword.value = '';
    loginOverlay.classList.add('show');
    setTimeout(()=>loginPassword.focus(), 50);
  }
  function closeLogin(){ loginOverlay.classList.remove('show'); }

  async function doLogin(){
    const password = loginPassword.value;
    if(!password) return;
    loginSubmit.disabled = true;
    try{
      const res = await fetch(apiUrl('api/auth.php?action=login'), {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({password})
      });
      const data = await res.json();
      if(res.ok && data.authed){
        authed = true; canAdmin = !!data.canAdmin; isAdmin = !!data.admin;
        updatePill(); notify(); closeLogin();
      } else {
        loginError.textContent = data.error || 'Incorrect password.';
        loginError.classList.add('show');
      }
    }catch(e){
      loginError.textContent = 'Could not reach the server.';
      loginError.classList.add('show');
    }
    loginSubmit.disabled = false;
  }

  async function doLogout(){
    await fetch(apiUrl('api/auth.php?action=logout'), {credentials:'include'});
    authed = false; canAdmin = false; isAdmin = false; updatePill(); notify();
  }

  if(signBtn) signBtn.addEventListener('click', ()=>{
    if(authed) doLogout(); else openLogin();
  });
  if(loginCancel) loginCancel.addEventListener('click', closeLogin);
  if(loginSubmit) loginSubmit.addEventListener('click', doLogin);
  if(loginPassword) loginPassword.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  if(loginOverlay) loginOverlay.addEventListener('click', e=>{ if(e.target===loginOverlay) closeLogin(); });

  return {
    isAuthed: ()=>authed,
    canAdmin: ()=>canAdmin,
    isAdmin: ()=>isAdmin,
    adminConfigured: ()=>adminConfigured,
    checkStatus,
    onChange,
    openLogin,
    closeLogin,
    family: FAMILY,
    apiUrl,
  };
})();

// ---- Theme (light/dark), shared across all pages ----
(function(){
  const KEY = 'familytree-theme';
  function systemPrefersDark(){
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function current(){
    try{ return localStorage.getItem(KEY) || (systemPrefersDark() ? 'dark' : 'light'); }
    catch(e){ return systemPrefersDark() ? 'dark' : 'light'; }
  }
  function apply(theme){
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-toggle').forEach(btn=>{
      btn.setAttribute('title', theme==='dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.innerHTML = theme==='dark'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/></svg>';
    });
  }
  apply(current());
  document.addEventListener('click', e=>{
    const btn = e.target.closest('.theme-toggle');
    if(!btn) return;
    const next = document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark';
    try{ localStorage.setItem(KEY, next); }catch(e){}
    apply(next);
  });
})();

// ---- Family switcher (shared topnav widget) ----
// Lists families from api/families.php and lets the person jump between
// them; also keeps the Tree/Forum nav links pointed at whichever family
// you're currently looking at, instead of silently dropping you back to
// the default one when you switch pages.
(function(){
  function currentPage(){
    const file = location.pathname.replace(/^.*\//,'');
    return (file==='forum.html' || file==='timeline.html' || file==='map.html') ? file : 'index.html';
  }
  function urlFor(slug){
    return slug==='main' ? currentPage() : `${currentPage()}?family=${encodeURIComponent(slug)}`;
  }

  document.querySelectorAll('.navlinks a[href="index.html"], .navlinks a[href="forum.html"], .navlinks a[href="timeline.html"], .navlinks a[href="map.html"]').forEach(a=>{
    if(Auth.family!=='main'){
      const target = a.getAttribute('href');
      a.href = `${target}?family=${encodeURIComponent(Auth.family)}`;
    }
  });

  const btn = document.getElementById('familyPillBtn');
  const menu = document.getElementById('familyMenu');
  const label = document.getElementById('familyPillLabel');
  if(!btn || !menu || !label) return;

  fetch('api/families.php').then(r=>r.json()).then(data=>{
    const families = data.families || [];
    const mine = families.find(f=>f.slug===Auth.family);
    label.textContent = mine ? mine.name : 'Family Tree';
    if(families.length<2){ btn.classList.add('single'); return; } // nothing to switch to — no need for a menu
    menu.innerHTML = families.map(f=>{
      const safeName = String(f.name||f.slug).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      return `<a href="${urlFor(f.slug)}" class="${f.slug===Auth.family?'active':''}">${safeName}</a>`;
    }).join('');
  }).catch(()=>{ label.textContent = 'Family Tree'; });

  btn.addEventListener('click', e=>{
    e.stopPropagation();
    if(btn.classList.contains('single')) return;
    menu.classList.toggle('show');
  });
  document.addEventListener('click', ()=>menu.classList.remove('show'));
})();