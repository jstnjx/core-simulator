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
else if (window.ACTIVITY && $('activity-view')) {
  const { activity, page } = window.ACTIVITY;
  fetch('/api/activities/' + encodeURIComponent(activity) + '/pages/' + encodeURIComponent(page) + '/widgets')
    .then(response => { if (!response.ok) throw Error('Failed to load widgets'); return response.json(); })
    .then(widgets => {
      const grid = $('activity-view');
      const layout = widgets.length ? widgets[0].grid : { width: 4, height: 6 };
      grid.style.gridTemplateColumns = 'repeat(' + layout.width + ',1fr)';
      grid.style.gridTemplateRows = 'repeat(' + layout.height + ',1fr)';
      for (const w of widgets) {
        const tile = document.createElement('iframe');
        tile.title = w.name;
        tile.src = '/embed/' + w.id;
        tile.style.gridColumn = (w.location.x + 1) + '/span ' + w.size.width;
        tile.style.gridRow = (w.location.y + 1) + '/span ' + w.size.height;
        tile.setAttribute('allow', 'autoplay');
        grid.append(tile);
      }
      if (!widgets.length) grid.textContent = 'No RTSP widgets assigned to this activity page.';
    }).catch(error => { $('activity-view').textContent = error.message; });
}
else if ($('editor')) {
  let records = [];
  let activityRows = [];
  let pageRows = [];
  let pageGeneration = 0;
  const status = text => { $('core-status').textContent = text; };
  const fillSelect = (id, rows, prompt) => {
    const control = $(id);
    control.replaceChildren(new Option(prompt, ''));
    for (const row of rows) control.add(new Option(row.name, row.id));
  };
  const useManual = (enabled, activityId = '', pageId = '') => {
    $('manual-ids').checked = enabled;
    $('manual-controls').hidden = !enabled;
    for (const id of ['activity','page']) {
      $(id).disabled = enabled || (id === 'page' && !$('activity').value);
      $(id).required = !enabled;
    }
    for (const id of ['manual-activity','manual-page']) $(id).required = enabled;
    if (enabled) {
      $('manual-activity').value = activityId || $('activity').value;
      $('manual-page').value = pageId || $('page').value;
    }
  };
  const applyPageGrid = () => {
    const row = pageRows.find(p => p.id === $('page').value);
    if (row?.grid) {
      $('gw').value = row.grid.width;
      $('gh').value = row.grid.height;
    }
    gridPreview();
  };
  async function loadPages(activityId, preferredPage = '') {
    const currentGeneration = ++pageGeneration;
    pageRows = [];
    fillSelect('page', [], activityId ? 'Loading pages…' : 'Select an activity');
    $('page').disabled = true;
    if (!activityId || $('manual-ids').checked) return;
    try {
      const pages = await request('/api/core/activities/' + encodeURIComponent(activityId) + '/pages');
      if (currentGeneration !== pageGeneration || $('manual-ids').checked) return;
      pageRows = pages;
      fillSelect('page', pages, 'Select a page');
      $('page').disabled = false;
      if (preferredPage && pages.some(p => p.id === preferredPage)) $('page').value = preferredPage;
      else if (pages.length === 1 && !preferredPage) $('page').value = pages[0].id;
      else if (preferredPage) {
        useManual(true, activityId, preferredPage);
        status('Saved page not found in Core; using manual IDs.');
        return;
      }
      status(pages.length ? 'Activity pages loaded from Core.' : 'No pages found for this activity.');
      applyPageGrid();
    } catch(e) {
      if (currentGeneration !== pageGeneration) return;
      useManual(true, activityId, preferredPage);
      status('Cannot load pages: ' + e.message + '. Enter IDs manually.');
    }
  }
  async function loadActivities(preferredActivity = '', preferredPage = '') {
    fillSelect('activity', [], 'Loading activities…');
    if (!$('manual-ids').checked) $('activity').disabled = true;
    try {
      activityRows = await request('/api/core/activities');
      fillSelect('activity', activityRows, 'Select an activity');
      if (preferredActivity && activityRows.some(a => a.id === preferredActivity)) $('activity').value = preferredActivity;
      else if (activityRows.length === 1 && !preferredActivity) $('activity').value = activityRows[0].id;
      else if (preferredActivity) {
        useManual(true, preferredActivity, preferredPage);
        status('Saved activity not found in Core; using manual IDs.');
        return;
      }
      $('activity').disabled = $('manual-ids').checked;
      status(activityRows.length ? 'Choose an activity and its page.' : 'Core has no activities. Create an activity or enter IDs manually.');
      if ($('activity').value) await loadPages($('activity').value, preferredPage);
      else { pageRows = []; fillSelect('page', [], 'Select an activity'); }
    } catch(e) {
      useManual(true, preferredActivity, preferredPage);
      status('Cannot connect to Core: ' + e.message + '. Enter IDs manually, or check CORE_API_PASSWORD.');
    }
  }
  function formData() {
    const d = {
      name: $('name').value, activity_id: $('manual-ids').checked ? $('manual-activity').value : $('activity').value, page_id: $('manual-ids').checked ? $('manual-page').value : $('page').value,
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
    $('url').required = true; $('message').textContent = '';
    useManual(false);
    if (activityRows.length === 1) { $('activity').value = activityRows[0].id; loadPages($('activity').value); }
    else { fillSelect('page', [], 'Select an activity'); $('page').disabled = true; }
    gridPreview();
  }
  async function edit(id) {
    const data = records.find(x => x.id === id); if (!data) return;
    const map = { name:'name', width:'pixels', fps:'fps', mode:'mode' };
    for(const [field, elementId] of Object.entries(map)) $(elementId).value = data[field];
    $('x').value=data.location.x; $('y').value=data.location.y;
    $('w').value=data.size.width; $('h').value=data.size.height;
    $('gw').value=data.grid.width; $('gh').value=data.grid.height;
    $('widget-id').value=data.id; $('enabled').checked=data.enabled;
    $('url').value=''; $('url').required=false;
    $('editor-title').textContent='Edit ' + data.name;
    useManual(false);
    await loadActivities(data.activity_id, data.page_id);
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
        '<a target="_blank" rel="noopener" href="/embed/' + w.id + '">Open player</a> · ' +
        '<a target="_blank" rel="noopener" href="/view/' + encodeURIComponent(w.activity_id) + '/' + encodeURIComponent(w.page_id) + '">Preview activity grid</a>';
      card.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'edit') { edit(w.id).catch(e => $('message').textContent=e.message); return; }
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
  $('activity').addEventListener('change', () => loadPages($('activity').value));
  $('page').addEventListener('change', applyPageGrid);
  $('manual-ids').addEventListener('change', () => {
    const enabled = $('manual-ids').checked;
    useManual(enabled);
    if (!enabled) loadActivities($('manual-activity').value, $('manual-page').value);
    gridPreview();
  });
  $('reload-activities').addEventListener('click', () => {
    useManual(false);
    loadActivities($('activity').value, $('page').value);
  });
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
  reset();
  loadActivities();
  refresh().catch(e=>$('message').textContent=e.message);
}
