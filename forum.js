(function(){
  const forumLocked = document.getElementById('forumLocked');
  const listView = document.getElementById('listView');
  const postView = document.getElementById('postView');
  const postList = document.getElementById('postList');
  const emptyForum = document.getElementById('emptyForum');
  const postFull = document.getElementById('postFull');
  const postOverlay = document.getElementById('postOverlay');
  const postError = document.getElementById('postError');

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatDateTime(iso){
    try{ return new Date(iso).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
    catch(e){ return iso; }
  }
  function preview(text, n=180){
    text = text.trim();
    return text.length>n ? text.slice(0,n).trim()+'…' : text;
  }

  function showLocked(){
    forumLocked.style.display='block'; listView.style.display='none'; postView.style.display='none';
  }
  function showList(){
    forumLocked.style.display='none'; listView.style.display='block'; postView.style.display='none';
    loadList();
  }
  function showPost(id){
    forumLocked.style.display='none'; listView.style.display='none'; postView.style.display='block';
    loadPost(id);
  }

  async function loadList(){
    postList.innerHTML = '<div class="empty-forum">Loading…</div>';
    try{
      const res = await fetch('api/forum.php', {credentials:'include'});
      if(res.status===401){ showLocked(); return; }
      const data = await res.json();
      const posts = data.posts || [];
      emptyForum.style.display = posts.length ? 'none' : 'block';
      postList.innerHTML = posts.map(p=>`
        <div class="post-card" data-id="${p.id}">
          <h3>${escapeHtml(p.title)}</h3>
          <div class="post-meta">${escapeHtml(p.author)} · ${formatDateTime(p.date)} · ${p.comments.length} comment${p.comments.length===1?'':'s'}</div>
          <div class="post-preview">${escapeHtml(preview(p.body))}</div>
        </div>`).join('');
    }catch(e){
      postList.innerHTML = '<div class="empty-forum">Could not load posts.</div>';
    }
  }

  async function loadPost(id){
    postFull.innerHTML = '<p>Loading…</p>';
    try{
      const res = await fetch('api/forum.php?action=get&id='+id, {credentials:'include'});
      if(res.status===401){ showLocked(); return; }
      const p = await res.json();
      if(!p || p.error){ postFull.innerHTML = '<p>Post not found.</p>'; return; }
      postFull.innerHTML = `
        <h2>${escapeHtml(p.title)}</h2>
        <div class="post-meta">${escapeHtml(p.author)} · ${formatDateTime(p.date)}</div>
        <div class="body">${escapeHtml(p.body)}</div>
        <div class="comments">
          <div class="bio-section-title">Comments (${p.comments.length})</div>
          <div id="commentList">${p.comments.map(c=>`
            <div class="comment">
              <div class="cmeta">${escapeHtml(c.author)} · ${formatDateTime(c.date)}</div>
              <div class="cbody">${escapeHtml(c.body)}</div>
            </div>`).join('') || '<p class="hint">No comments yet.</p>'}</div>
          <div class="field" style="margin-top:16px;">
            <label>Your name</label>
            <input type="text" id="commentAuthor" placeholder="e.g. Uncle Joe">
          </div>
          <div class="field">
            <label>Add a comment</label>
            <textarea id="commentBody" style="min-height:70px;" placeholder="Write a reply..."></textarea>
          </div>
          <button class="btn-primary" id="commentSubmit">Post comment</button>
        </div>`;
      document.getElementById('commentSubmit').onclick = async ()=>{
        const author = document.getElementById('commentAuthor').value.trim();
        const body = document.getElementById('commentBody').value.trim();
        if(!body) return;
        const r = await fetch('api/forum.php?action=create_comment', {
          method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({postId:id, author, body})
        });
        if(r.status===401){ showLocked(); return; }
        if(r.ok) loadPost(id);
      };
    }catch(e){
      postFull.innerHTML = '<p>Could not load this post.</p>';
    }
  }

  postList.addEventListener('click', e=>{
    const card = e.target.closest('.post-card'); if(!card) return;
    showPost(Number(card.dataset.id));
  });
  document.getElementById('backToList').onclick = showList;

  document.getElementById('newPostBtn').onclick = ()=>{
    postError.classList.remove('show');
    document.getElementById('postAuthor').value='';
    document.getElementById('postTitle').value='';
    document.getElementById('postBody').value='';
    postOverlay.classList.add('show');
  };
  document.getElementById('postCancel').onclick = ()=>postOverlay.classList.remove('show');
  postOverlay.addEventListener('click', e=>{ if(e.target===postOverlay) postOverlay.classList.remove('show'); });
  document.getElementById('postSubmit').onclick = async ()=>{
    const author = document.getElementById('postAuthor').value.trim();
    const title = document.getElementById('postTitle').value.trim();
    const body = document.getElementById('postBody').value.trim();
    if(!title || !body){
      postError.textContent = 'Please add a title and a message.';
      postError.classList.add('show');
      return;
    }
    try{
      const res = await fetch('api/forum.php?action=create_post', {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({author, title, body})
      });
      if(res.status===401){ postOverlay.classList.remove('show'); showLocked(); return; }
      const data = await res.json();
      if(!res.ok){ postError.textContent = data.error||'Could not publish.'; postError.classList.add('show'); return; }
      postOverlay.classList.remove('show');
      showList();
    }catch(e){
      postError.textContent = 'Could not reach the server.';
      postError.classList.add('show');
    }
  };

  document.getElementById('lockedSignIn').onclick = ()=>Auth.openLogin();

  Auth.onChange(authed=>{
    if(authed) showList(); else showLocked();
  });

  Auth.checkStatus();
})();
