const $ = id => document.getElementById(id);
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function playWidget(config) {
  const container = $('player');
  if (!container) return;
  const url = (config.mode === 'mjpeg' ? '/mjpeg/' : '/hls/') + config.id + (config.mode === 'mjpeg' ? '' : '/index.m3u8');
  if (config.mode === 'mjpeg') {
    const image = document.createElement('img'); image.src = url; image.alt = config.name;
    container.append(image); return;
  }
  const video = document.createElement('video');
  video.autoplay = true; video.muted = true; video.playsInline = true; video.controls = false;
  container.append(video);
  let hls = null;
  let attempts = 0;
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.5 });
    hls.loadSource(url); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { attempts = 0; video.play().catch(()=>{}); });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      hls.stopLoad();
      const wait = Math.min(15000, 1500 * Math.pow(2, Math.min(attempts++, 4)));
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          hls.loadSource(url);
          hls.startLoad();
        }
      }, wait);
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; video.play().catch(()=>{});
  } else {
    const warning = document.createElement('div'); warning.className = 'error';
    warning.textContent = 'HLS playback is not supported in this browser';
    container.append(warning);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { video.pause(); if (hls) hls.stopLoad(); }
    else { if (hls) hls.startLoad(); video.play().catch(()=>{}); }
  });
  window.addEventListener('pagehide', () => { if (hls) hls.destroy(); video.removeAttribute('src'); video.load(); });
}

if (window.WIDGET) playWidget(window.WIDGET);
else if ($('editor')) {
  let records = [];
  function formData() {
    const d = {
      name: $('name').value, activity_id: $('activity').value, page_id: $('page').value,
      location: { x: Number($('x').value), y: Number($('y').value) },
      size: { width: Number($('w').value), height: Number($('h').value) },
      grid: { width: Number($('gw').value), height: Number($('gh').value) },
      width: Number($('pixels').value), fps: Number($('fps').value),
      mode: $('mode').value, enabled: $('enabled').checked
    };
    if ($('url').value.trim()) d.url = $('url').value.trim();
    return d;
  }
  async function request(path, options={}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    if (!res.ok) {
      const data = await res.json().catch(()=>({}));
      throw Error(data.error || 'HTTP ' + res.status);
    }
    return res.status === 204 ? null : res.json();
  }
  function gridPreview() {
    const item = formData();
    const grid = $('grid-preview');
    grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, item.grid.width) + ',1fr)';
    grid.style.gridTemplateRows = 'repeat(' + Math.max(1, item.grid.height) + ',42px)';
    grid.replaceChildren();
    const box = document.createElement('div'); box.className = 'placement';
    box.style.gridColumn = (item.location.x + 1) + '/span ' + item.size.width;
    box.style.gridRow = (item.location.y + 1) + '/span ' + item.size.height;
    box.textContent = item.name || 'RTSP stream'; grid.append(box);
  }
  function reset() {
    $('editor').reset(); $('widget-id').value = ''; $('editor-title').textContent = 'New camera widget';
    $('url').required = true; $('message').textContent = ''; gridPreview();
  }
  function edit(id) {
    const data = records.find(x => x.id === id); if (!data) return;
    const map = { name:'name', activity_id:'activity', page_id:'page', width:'pixels', fps:'fps', mode:'mode' };
    for(const [field, elementId] of Object.entries(map)) $(elementId).value = data[field];
    $('x').value=data.location.x; $('y').value=data.location.y;
    $('w').value=data.size.width; $('h').value=data.size.height;
    $('gw').value=data.grid.width; $('gh').value=data.grid.height;
    $('widget-id').value=data.id; $('enabled').checked=data.enabled;
    $('url').value=''; $('url').required=false;
    $('editor-title').textContent='Edit ' + data.name;
    gridPreview(); window.scrollTo({top:0,behavior:'smooth'});
  }
  async function refresh() {
    records = await request('/api/widgets');
    const box = $('widgets'); box.replaceChildren();
    if (!records.length) box.textContent = 'No RTSP widgets configured yet.';
    for (const w of records) {
      const card = document.createElement('article'); card.className = 'widget';
      card.innerHTML = '<h3>' + escapeHtml(w.name) + '</h3>' +
        '<div class="meta">' + escapeHtml(w.source) + ' · ' + escapeHtml(w.status.state) +
        '<br>' + escapeHtml(w.activity_id) + ' / ' + escapeHtml(w.page_id) +
        '<br>(' + w.location.x + ',' + w.location.y + '), ' + w.size.width + '×' + w.size.height + ', ' + w.fps + ' fps</div>' +
        '<iframe loading="lazy" title="' + escapeHtml(w.name) + '" src="/embed/' + w.id + '"></iframe>' +
        '<div class="actions"><button data-action="edit">Edit</button><button data-action="restart" class="secondary">Restart</button><button data-action="stop" class="secondary">Stop</button><button data-action="delete" class="secondary">Delete</button></div>' +
        '<a target="_blank" rel="noopener" href="/embed/' + w.id + '">Open player</a>';
      card.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'edit') { edit(w.id); return; }
        if (action === 'delete' && !confirm('Delete ' + w.name + '?')) return;
        try {
          const suffix = ['stop','restart'].includes(action) ? '/' + action : '';
          await request('/api/widgets/' + w.id + suffix, { method: action==='delete' ? 'DELETE' : 'POST' });
          await refresh();
        } catch(e) { alert(e.message); }
      }));
      box.append(card);
    }
  }
  $('editor').addEventListener('input', gridPreview);
  $('editor').addEventListener('submit', async ev => {
    ev.preventDefault(); const id=$('widget-id').value;
    try {
      await request('/api/widgets' + (id ? '/' + id : ''), {
        method: id ? 'PUT':'POST', body: JSON.stringify(formData())
      });
      reset(); await refresh(); $('message').textContent='Saved';
    } catch(e) { $('message').textContent=e.message; }
  });
  $('clear').addEventListener('click',reset);
  $('refresh').addEventListener('click',()=>refresh().catch(e=>$('message').textContent=e.message));
  reset(); refresh().catch(e=>$('message').textContent=e.message);
}
