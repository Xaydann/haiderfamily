// map.js — plots every place recorded against anyone in the family.
//
// Coordinates are resolved once, when a place is added on the Tree page,
// and stored in the person's record. This page therefore never geocodes
// anything: it just reads coordinates and draws them, which keeps it fast
// and avoids hammering a free geocoding service on every page view.

(function(){
  const KINDS = {
    lived:  {label:'Lived',   color:'#2f4a3c'},
    married:{label:'Married', color:'#8c6a4f'},
    worked: {label:'Worked',  color:'#5a6e8c'},
    school: {label:'School',  color:'#7a5a7c'},
    buried: {label:'Buried',  color:'#6b6f66'},
    event:  {label:'Event',   color:'#b3826a'},
  };
  const emptyEl = document.getElementById('mapEmpty');
  let map, markerLayer;
  let allPins = [];
  let loadedPeople = [];
  const activeKinds = new Set(Object.keys(KINDS));

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function isDark(){ return document.documentElement.getAttribute('data-theme')==='dark'; }
  let tileLayer = null;
  function tileUrl(){
    return isDark()
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  }
  function setTiles(){
    if(tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(tileUrl(), {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map);
  }

  function markerFor(pin){
    const color = (KINDS[pin.kind]||KINDS.lived).color;
    const icon = L.divIcon({
      className: 'map-pin-wrap',
      html: `<span class="map-pin" style="background:${color}"></span>`,
      iconSize: [16,16], iconAnchor:[8,8],
    });
    const kindLabel = (KINDS[pin.kind]||KINDS.lived).label;
    const popup = `
      <div class="map-popup">
        <div class="mp-kind" style="color:${color}">${kindLabel}${pin.year?` · ${escapeHtml(pin.year)}`:''}</div>
        <div class="mp-place">${escapeHtml(pin.name)}</div>
        <div class="mp-person">${escapeHtml(pin.personName)}</div>
        ${pin.note?`<div class="mp-note">${escapeHtml(pin.note)}</div>`:''}
      </div>`;
    return L.marker([pin.lat, pin.lng], {icon}).bindPopup(popup);
  }

  function draw(){
    markerLayer.clearLayers();
    const shown = allPins.filter(p=>activeKinds.has(p.kind));
    shown.forEach(pin=>markerLayer.addLayer(markerFor(pin)));
    if(shown.length){
      const bounds = L.latLngBounds(shown.map(p=>[p.lat,p.lng]));
      if(bounds.isValid()) map.fitBounds(bounds, {padding:[60,60], maxZoom:9});
    }
  }

  async function load(){
    map = L.map('map', {zoomControl:true, worldCopyJump:true}).setView([25,10], 2);
    setTiles();
    markerLayer = L.layerGroup().addTo(map);

    // Re-tile when the theme changes so the map matches the site.
    new MutationObserver(()=>setTiles()).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

    try{
      const res = await fetch(Auth.apiUrl('api/tree.php'));
      const data = await res.json();
      loadedPeople = data.people || [];
      allPins = [];
      loadedPeople.forEach(p=>{
        (p.places||[]).forEach(pl=>{
          if(pl.lat==null || pl.lng==null) return; // unpinned places are records only
          allPins.push({...pl, personId:p.id, personName:p.name});
        });
      });
      // Life events that carry a location get pinned too, so the map shows
      // both where people were rooted and where things happened to them.
      const byId = new Map(loadedPeople.map(p=>[p.id,p]));
      (data.events||[]).forEach(ev=>{
        if(ev.lat==null || ev.lng==null) return;
        const names = (ev.people||[]).map(id=>(byId.get(id)||{}).name).filter(Boolean);
        allPins.push({
          kind:'event', name: ev.place || ev.title, year: (ev.date||'').slice(0,4),
          note: ev.title + (ev.description ? ' — '+ev.description : ''),
          lat: ev.lat, lng: ev.lng,
          personId: (ev.people||[])[0], personName: names.join(', ') || 'Family',
          eventPeople: ev.people || [],
        });
      });
      if(!allPins.length){ emptyEl.style.display='flex'; return; }
      emptyEl.style.display='none';
      draw();
    }catch(e){
      emptyEl.style.display='flex';
      emptyEl.innerHTML = '<h2>Could not load the map</h2><p>Try refreshing the page.</p>';
    }
  }

  document.getElementById('mapFilters').addEventListener('change', e=>{
    const cb = e.target.closest('input[data-kind]');
    if(!cb) return;
    if(cb.checked) activeKinds.add(cb.dataset.kind); else activeKinds.delete(cb.dataset.kind);
    draw();
  });

  // ---------- Public API for the shared search module ----------
  window.MapView = {
    listPeople: ()=>loadedPeople.map(p=>({id:p.id,name:p.name,nickname:p.nickname,photo:p.photo,dob:p.dob,dod:p.dod})),
    focusPerson(id){
      const pid = Number(id);
      const theirs = allPins.filter(p=>
        activeKinds.has(p.kind) &&
        (p.personId===pid || (p.eventPeople||[]).includes(pid)));
      if(!theirs.length){
        alert('No mapped places recorded for that person yet.');
        return false;
      }
      const bounds = L.latLngBounds(theirs.map(p=>[p.lat,p.lng]));
      map.fitBounds(bounds, {padding:[80,80], maxZoom:8});
      // Briefly show only their pins so they stand out, then restore.
      markerLayer.clearLayers();
      theirs.forEach(pin=>markerLayer.addLayer(markerFor(pin).openPopup()));
      clearTimeout(window.__mapRestore);
      window.__mapRestore = setTimeout(draw, 5000);
      return true;
    },
  };

  load();
})();