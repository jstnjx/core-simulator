(() => {
  'use strict';
  if (window.__ucRtspAddon) return;
  window.__ucRtspAddon = true;
  const base = '/rtsp-addon/api';
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m23 7-7 5 7 5V7ZM1 7h15v10H1z"/></svg>';
  const host = document.createElement('div');
  host.id = 'uc-rtsp-configurator-addon';
  (document.body || document.documentElement).append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = '/rtsp-addon/editor.css';
  shadow.append(style);
  const root = document.createElement('div');
  shadow.append(root);
  root.innerHTML = `
    <button id="rtsp-launch" type="button" aria-label="RTSP Cameras">${icon} RTSP Cameras</button>
    <div id="rtsp-shade" hidden>
      <section id="rtsp-dialog" role="dialog" aria-modal="true" aria-labelledby="rtsp-title">
        <header><div><h2 id="rtsp-title">RTSP Camera Widgets</h2><p>Add live camera feeds directly to your activity pages.</p></div><button type="button" class="icon" id="rtsp-close" aria-label="Close">×</button></header>
        <div id="rtsp-main">
          <div class="panel">
            <div class="top-row"><h3>Activity and page</h3><button type="button" id="rtsp-refresh">Refresh</button></div>
            <div class="fields two">
              <label class="field">Activity<select id="rtsp-activity"><option value="">Choose activity</option></select></label>
              <label class="field">Activity page<select id="rtsp-page" disabled><option value="">Choose page</option></select></label>
            </div>
            <div class="sep"></div>
            <div class="top-row"><h3>Camera widgets</h3><button type="button" class="primary" id="rtsp-new">+ Add camera</button></div>
            <div id="rtsp-items"></div>
            <div class="sep"></div>
            <form id="rtsp-form">
              <h3 id="rtsp-form-title">New camera</h3>
              <div class="fields two" style="margin-top:12px">
                <label class="field">Name<input required maxlength="120" id="rtsp-name" placeholder="Entrance camera"></label>
                <label class="field">Camera RTSP URL<input id="rtsp-url" placeholder="rtsp://user:pass@camera/stream" autocomplete="off" spellcheck="false"></label>
              </div>
              <p class="hint">RTSP credentials remain on the server. Leave the URL blank when editing an existing camera.</p>
              <div class="fields" style="margin-top:12px">
                <label class="field">X<input type="number" min="0" max="15" id="rtsp-x" value="0" required></label>
                <label class="field">Y<input type="number" min="0" max="15" id="rtsp-y" value="0" required></label>
                <label class="field">Width (cells)<input type="number" min="1" max="16" id="rtsp-w" value="4" required></label>
                <label class="field">Height (cells)<input type="number" min="1" max="16" id="rtsp-h" value="2" required></label>
              </div>
              <div class="fields two" style="margin-top:12px">
                <label class="field">Output width (px)<input type="number" min="160" max="1280" id="rtsp-pixels" value="640" required></label>
                <label class="field">Frame rate<input type="number" min="1" max="30" id="rtsp-fps" value="24" required></label>
              </div>
              <label class="field check" style="margin:14px 0"><input type="checkbox" id="rtsp-enabled" checked> Enabled</label>
              <div class="actions"><button class="primary" type="submit" id="rtsp-save">Save camera</button><button type="button" id="rtsp-delete" class="danger" hidden>Delete</button></div>
            </form>
            <div id="rtsp-message" role="status" aria-live="polite"></div>
          </div>
          <div class="panel">
            <h3>Activity grid placement</h3>
            <p class="hint">Select any grid cell to position the selected camera. Camera tiles overlay normal activity controls in the simulator.</p>
            <div id="rtsp-preview" aria-label="Camera placement preview"></div>
            <p class="hint">Live camera preview (only while this editor is open)</p>
            <img alt="Selected camera live preview" id="rtsp-video">
          </div>
        </div>
        <footer><span>Core Simulator · RTSP cameras</span><span class="pill">Native Remote UI playback</span></footer>
      </section>
    </div>`;
  const $ = key => shadow.getElementById('rtsp-' + key);
  let activities = [], pages = [], widgets = [], selected = null, loadSeq = 0, currentPageSeq = 0;
  const state = msg => { $('message').textContent = msg; };
  async function api(path, options = {}) {
    const res = await fetch(base + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-RTSP-Configurator': '1' },
      ...options
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }
  function optionsFor(control, items, prompt) {
    control.replaceChildren(new Option(prompt, ''));
    items.forEach(item => control.add(new Option(item.name, item.id)));
  }
  function clearForm() {
    selected = null;
    $('form').reset();
    $('url').required = true;
    $('form-title').textContent = 'New camera';
    $('delete').hidden = true;
    $('pixels').value = '640'; $('fps').value = '24';
    $('w').value = Math.min(4, pageGrid().width); $('h').value = Math.min(2, pageGrid().height);
    $('x').value = 0; $('y').value = 0;
    updateGrid();
    livePreview();
  }
  function pageGrid() {
    const p = pages.find(p => p.id === $('page').value);
    return p?.grid || { width: 4, height: 6 };
  }
  function cameraData() {
    const grid = pageGrid();
    const entry = {
      name: $('name').value.trim(), activity_id: $('activity').value, page_id: $('page').value,
      grid, location: { x: +$('x').value, y: +$('y').value },
      size: { width: +$('w').value, height: +$('h').value },
      width: +$('pixels').value, fps: +$('fps').value,
      mode: (selected ? widgets.find(w => w.id === selected)?.mode : null) || 'hls', enabled: $('enabled').checked
    };
    if ($('url').value.trim()) entry.url = $('url').value.trim();
    return entry;
  }
  function renderList() {
    const current = widgets.filter(w => w.activity_id === $('activity').value && w.page_id === $('page').value);
    const list = $('items'); list.replaceChildren();
    if (!current.length) {
      const empty = document.createElement('p'); empty.className = 'hint';
      empty.textContent = 'No camera widgets on this page yet.'; list.append(empty); return;
    }
    current.forEach(w => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'rtsp-entry' + (selected === w.id ? ' selected' : '');
      const left = document.createElement('span'); left.textContent = w.name;
      const info = document.createElement('small');
      info.textContent = `${w.location.x}, ${w.location.y} · ${w.size.width}×${w.size.height} · ${w.fps} fps`;
      left.append(info); b.append(left);
      const dot = document.createElement('span'); dot.textContent = w.enabled ? '●' : '○';
      dot.style.color = w.enabled ? '#6ed89f' : '#aaa'; b.append(dot);
      b.addEventListener('click', () => edit(w.id)); list.append(b);
    });
  }
  function renderGrid() {
    const grid = $('preview'); grid.replaceChildren();
    const { width, height } = pageGrid();
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, width)},1fr)`;
    grid.style.gridTemplateRows = `repeat(${Math.max(1, height)},1fr)`;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = document.createElement('div'); cell.className = 'cell';
      cell.style.gridColumn = `${x+1}`; cell.style.gridRow = `${y+1}`;
      cell.title = `Place at ${x}, ${y}`;
      cell.addEventListener('click', () => {
        $('x').value = Math.min(x, width - +$('w').value);
        $('y').value = Math.min(y, height - +$('h').value);
        renderGrid();
      });
      grid.append(cell);
    }
    const entries = widgets.filter(w => w.activity_id === $('activity').value && w.page_id === $('page').value);
    if ($('name').value.trim() && !selected) entries.push({ ...cameraData(), id: '_draft' });
    for (const w of entries) {
      const data = selected === w.id ? cameraData() : w;
      const tile = document.createElement('div'); tile.className = 'camera' + (selected === w.id ? ' selected' : '');
      tile.style.gridColumn = `${data.location.x+1} / span ${data.size.width}`;
      tile.style.gridRow = `${data.location.y+1} / span ${data.size.height}`;
      tile.innerHTML = `<span class="camera-icon">▣</span>`;
      tile.append(document.createTextNode(data.name || 'RTSP Camera'));
      grid.append(tile);
    }
  }
  function updateGrid() { renderList(); renderGrid(); }
  function livePreview() {
    const img = $('video');
    img.removeAttribute('src'); img.classList.remove('visible');
    if (selected) {
      img.src = `/rtsp-addon/media/mjpeg/${encodeURIComponent(selected)}`;
      img.classList.add('visible');
    }
  }
  function edit(id) {
    const w = widgets.find(w => w.id === id); if (!w) return;
    selected = id;
    $('form-title').textContent = `Edit ${w.name}`;
    $('name').value = w.name; $('url').value = ''; $('url').required = false;
    $('x').value = w.location.x; $('y').value = w.location.y;
    $('w').value = w.size.width; $('h').value = w.size.height;
    $('pixels').value = w.width; $('fps').value = w.fps;
    $('enabled').checked = w.enabled; $('delete').hidden = false;
    state(''); updateGrid(); livePreview();
  }
  async function loadWidgets() {
    widgets = await api('/widgets');
    if (selected && !widgets.some(w => w.id === selected)) selected = null;
    updateGrid();
  }
  async function loadPages(preferred = '') {
    const seq = ++currentPageSeq;
    pages = []; optionsFor($('page'), [], 'Loading pages…'); $('page').disabled = true;
    const id = $('activity').value;
    if (!id) { optionsFor($('page'), [], 'Choose activity first'); updateGrid(); return; }
    try {
      const data = await api('/core/activities/' + encodeURIComponent(id) + '/pages');
      if (seq !== currentPageSeq) return;
      pages = data; optionsFor($('page'), pages, 'Choose page'); $('page').disabled = false;
      const match = pages.find(p => window.location.href.includes(p.id));
      $('page').value = pages.some(p => p.id === preferred) ? preferred : (match?.id || pages[0]?.id || '');
      clearForm(); updateGrid();
    } catch (e) { if (seq === currentPageSeq) state('Could not load activity pages: ' + e.message); }
  }
  async function loadActivities() {
    const seq = ++loadSeq;
    const oldActivity = $('activity').value;
    const oldPage = $('page').value;
    const result = await Promise.all([api('/core/activities'), api('/widgets')]);
    if (seq !== loadSeq) return;
    activities = result[0]; widgets = result[1];
    optionsFor($('activity'), activities, 'Choose activity');
    const activityFromUrl = activities.find(a => window.location.href.includes(a.id) || window.location.href.includes(encodeURIComponent(a.id)));
    $('activity').value = activities.some(a => a.id === oldActivity) ? oldActivity : (activityFromUrl?.id || (activities.length === 1 ? activities[0].id : ''));
    await loadPages(oldPage); renderList();
  }
  function open() {
    $('shade').hidden = false;
    $('launch').hidden = true;
    loadActivities().then(() => state('')).catch(e => state(e.message));
  }
  function close() {
    $('shade').hidden = true; $('launch').hidden = false;
    $('video').removeAttribute('src'); $('video').classList.remove('visible');
  }
  $('launch').addEventListener('click', open);
  $('close').addEventListener('click', close);
  $('shade').addEventListener('click', e => { if (e.target === $('shade')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('shade').hidden) close(); });
  $('refresh').addEventListener('click', () => loadActivities().then(() => state('Refreshed')).catch(e => state(e.message)));
  $('activity').addEventListener('change', () => loadPages().catch(e => state(e.message)));
  $('page').addEventListener('change', () => { clearForm(); updateGrid(); });
  $('new').addEventListener('click', () => { clearForm(); state(''); });
  ['x','y','w','h','name'].forEach(id => $(id).addEventListener('input', renderGrid));
  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = cameraData();
    const g = data.grid;
    if (!data.activity_id || !data.page_id) { state('Choose an activity and its page first.'); return; }
    if (data.location.x < 0 || data.location.y < 0 || data.location.x + data.size.width > g.width || data.location.y + data.size.height > g.height) {
      state('Camera extends beyond the selected activity grid.'); return;
    }
    if (!selected && !data.url) { state('Enter a valid RTSP source for the new camera.'); return; }
    $('save').disabled = true;
    try {
      const result = await api(selected ? '/widgets/' + selected : '/widgets', {
        method: selected ? 'PUT' : 'POST', body: JSON.stringify(data)
      });
      widgets = await api('/widgets');
      selected = result.id;
      edit(result.id);
      state('Camera saved. It will appear in the native Remote UI on this activity page.');
    } catch (err) { state('Could not save: ' + err.message); }
    finally { $('save').disabled = false; }
  });
  $('delete').addEventListener('click', async () => {
    if (!selected) return;
    if (!confirm('Delete this RTSP camera widget?')) return;
    try {
      await api('/widgets/' + selected, { method: 'DELETE' });
      selected = null; clearForm(); await loadWidgets();
      state('Camera removed.');
    } catch (e) { state('Delete failed: ' + e.message); }
  });
  // As an additional entry point, place a small RTSP action beside the stock
  // activity editor's Widgets heading if one can be found. DOM structure is
  // version-dependent: the persistent floating button remains the fallback.
  let paletteUpdateScheduled = false;
  function ensureEditorEntry() {
    paletteUpdateScheduled = false;
    const headings = document.querySelectorAll('h2,h3,h4,h5,legend');
    for (const heading of headings) {
      if (!/^widgets?$/i.test((heading.textContent || '').trim())) continue;
      if (heading.closest('#uc-rtsp-configurator-addon')) continue;
      if (!heading.parentElement || heading.parentElement.querySelector('[data-uc-rtsp-entry]')) continue;
      const entry = document.createElement('button');
      entry.type = 'button'; entry.textContent = '+ RTSP Camera';
      entry.setAttribute('data-uc-rtsp-entry', 'true');
      entry.setAttribute('aria-label', 'Add RTSP camera to activity');
      Object.assign(entry.style, {
        margin: '8px 0', padding: '8px 12px', border: '1px solid #647997',
        borderRadius: '7px', backgroundColor: '#324153', color: '#fff',
        fontSize: '12px', cursor: 'pointer', fontWeight: '600'
      });
      entry.addEventListener('click', open);
      heading.insertAdjacentElement('afterend', entry);
    }
  }
  const observer = new MutationObserver(() => {
    if (!paletteUpdateScheduled) {
      paletteUpdateScheduled = true;
      window.requestAnimationFrame(ensureEditorEntry);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureEditorEntry();
  // We do not replace or rewrite the Vue app's JS bundles or Core data. The
  // stock activity editor stays in charge of its normal widget types.
})();
