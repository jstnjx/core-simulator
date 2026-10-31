(() => {
  'use strict';
  // The Core Simulator binary does not support third-party activity-item types.
  // These controls live inside the stock activity editor; their data remains in
  // the RTSP sidecar, keyed by the current Core activity and UI page.
  if (window.__ucVideoStreamWidget) return;
  window.__ucVideoStreamWidget = true;
  const API = '/rtsp-addon/api';
  const ADDON = 'uc-video-stream-addon';
  const cell = (v, fallback) => Number.isInteger(+v) ? +v : fallback;
  const visible = el => !!(el && el.isConnected && el.getBoundingClientRect().width &&
    el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden');
  const label = el => (el && (el.textContent || '').trim() || '').replace(/\s+/g, ' ');
  let activityRows = [], pageRows = [], widgets = [], activityId = '', pageId = '';
  let selectedId = '', loading = false, busy = false, loadSerial = 0;
  let palette = null, grid = null, slot = null, tileLayer = null, lastRoute = '';
  let pendingPlacement = null, message = '';
  let dragItemId = '';
  const icon = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="6" width="14" height="12" rx="2"></rect><path d="m16.5 10 5-3v10l-5-3"></path></svg>';

  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-RTSP-Configurator': '1', ...(options.headers || {}) }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || ('HTTP ' + res.status));
    }
    return res.status === 204 ? null : res.json();
  }
  function identityFromUrl(rows) {
    return rows.find(p => location.href.includes(encodeURIComponent(p.id)) || location.href.includes(p.id));
  }
  function findHeading() {
    // The official Vue Configurator has used several heading/tab components;
    // match the visible text instead of version-specific generated class names.
    const nodes = document.querySelectorAll('h2,h3,h4,h5,h6,legend,button,span,div,p');
    for (const el of nodes) {
      if (el.id === ADDON || el.closest('#' + ADDON)) continue;
      if (!visible(el)) continue;
      if (!/^widgets?$/i.test(label(el))) continue;
      if (el.children.length && Array.from(el.children).some(c => /^widgets?$/i.test(label(c)))) continue;
      if (el.getBoundingClientRect().width > 550) continue;
      return el;
    }
    return null;
  }
  function findPalette() {
    const heading = findHeading();
    if (!heading) return null;
    const parent = heading.parentElement;
    if (!parent) return null;
    // Avoid injecting into the actual tab-bar's inline flex row.
    const hasPagesTab = Array.from(parent.children).some(e => e !== heading && /^pages$/i.test(label(e)));
    const anchor = hasPagesTab || getComputedStyle(parent).display.includes('flex') ? parent : heading;
    return { heading, anchor };
  }
  function findGrid() {
    const nodes = document.querySelectorAll(
      '[class*="grid"],[class*="Grid"],[class*="screen"],[class*="Screen"],[class*="preview"],[class*="Preview"],[id*="grid"],[id*="Grid"],[id*="screen"],[id*="Screen"]');
    let best = null, score = -1;
    for (const el of nodes) {
      if (!visible(el) || el.closest('#' + ADDON) || el.closest('#uc-video-stream-overlay')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 210 || r.width > 1000 || r.height > 1150) continue;
      if (r.right < 0 || r.left > innerWidth) continue;
      const styles = getComputedStyle(el);
      const name = String(el.className || '') + ' ' + el.id;
      const isGrid = styles.display === 'grid' || /(?:ui|activity|screen|remote|widget).*(?:grid|screen|preview)|grid.*(?:screen|activity)/i.test(name);
      if (!isGrid) continue;
      const ratio = r.width / r.height;
      if (ratio < .38 || ratio > 1.3) continue;
      const s = (styles.display === 'grid' ? 6 : 0) +
        (/activity|screen|remote|ui/i.test(name) ? 4 : 0) +
        (ratio >= .45 && ratio <= .8 ? 4 : 0) +
        (r.left > innerWidth * .19 && r.left < innerWidth * .83 ? 2 : 0);
      if (s > score) { score = s; best = el; }
    }
    return score >= 8 ? best : null;
  }

  function createUI() {
    const h = document.createElement('div');
    h.id = ADDON;
    const shadow = h.attachShadow({ mode: 'open' });
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/rtsp-addon/editor.css'; shadow.append(css);
    const view = document.createElement('div');
    view.innerHTML = [
      '<div class="video-stream-panel">',
        '<button type="button" id="vs-widget" class="widget" draggable="true" title="Drag Video Stream onto the activity grid">',
          '<span class="icon">' + icon + '</span><span><strong>Video Stream</strong><small>Live RTSP camera</small></span>',
          '<span class="plus">+</span>',
        '</button>',
        '<section id="vs-inspector" hidden>',
          '<div class="heading"><strong id="vs-title">Video Stream</strong><button id="vs-collapse" type="button" aria-label="Collapse settings">×</button></div>',
          '<p class="note">Settings are saved for the simulator activity page.</p>',
          '<div class="fields"><label>Activity<select id="vs-activity"></select></label><label>Page<select id="vs-page"></select></label></div>',
          '<label>Name<input id="vs-name" maxlength="120" placeholder="Entrance camera"></label>',
          '<label>RTSP URL<input id="vs-url" type="text" autocomplete="off" spellcheck="false" placeholder="rtsp://user:pass@camera/stream"></label>',
          '<div class="fields four">',
            '<label>X<input id="vs-x" type="number" min="0" max="15" value="0"></label>',
            '<label>Y<input id="vs-y" type="number" min="0" max="15" value="0"></label>',
            '<label>W<input id="vs-w" type="number" min="1" max="16" value="4"></label>',
            '<label>H<input id="vs-h" type="number" min="1" max="16" value="2"></label>',
          '</div>',
          '<div class="fields"><label>Output width (px)<input id="vs-width" type="number" min="160" max="1280" value="640"></label>',
          '<label>FPS<input id="vs-fps" type="number" min="1" max="30" value="24"></label></div>',
          '<label class="enabled"><input id="vs-enabled" type="checkbox" checked>Enabled</label>',
          '<div class="buttons"><button id="vs-save" type="button" class="primary">Save Video Stream</button><button id="vs-delete" type="button" class="danger" hidden>Delete</button></div>',
          '<div id="vs-notice" role="status" aria-live="polite"></div>',
        '</section>',
        '<div id="vs-existing" class="existing"></div>',
      '</div>'
    ].join('');
    shadow.append(view);
    const $ = id => shadow.getElementById('vs-' + id);
    const inform = value => { message = value; $('notice').textContent = value; };
    const updateSelect = (el, rows, fallback) => {
      el.replaceChildren(new Option(fallback, ''));
      rows.forEach(r => el.add(new Option(r.name, r.id)));
    };
    const pageGrid = () => pageRows.find(p => p.id === pageId)?.grid || { width: 4, height: 6 };
    const reset = () => {
      selectedId = '';
      pendingPlacement = null;
      $('title').textContent = 'New Video Stream';
      $('delete').hidden = true;
      $('name').value = ''; $('url').value = ''; $('url').placeholder = 'rtsp://user:pass@camera/stream';
      $('x').value = '0'; $('y').value = '0';
      $('w').value = String(Math.min(4, pageGrid().width));
      $('h').value = String(Math.min(2, pageGrid().height));
      $('width').value = '640'; $('fps').value = '24'; $('enabled').checked = true;
      $('inspector').hidden = false; inform(''); render();
    };
    const edit = id => {
      const w = widgets.find(w => w.id === id); if (!w) return;
      selectedId = id; pendingPlacement = null;
      $('inspector').hidden = false;
      $('title').textContent = 'Video Stream: ' + w.name;
      $('name').value = w.name; $('url').value = ''; $('url').placeholder = 'Leave empty to keep saved RTSP URL';
      $('x').value = String(w.location.x); $('y').value = String(w.location.y);
      $('w').value = String(w.size.width); $('h').value = String(w.size.height);
      $('width').value = String(w.width); $('fps').value = String(w.fps);
      $('enabled').checked = !!w.enabled; $('delete').hidden = false;
      inform(''); render();
    };
    function data() {
      const old = widgets.find(w => w.id === selectedId);
      const d = {
        name: $('name').value.trim(),
        activity_id: activityId, page_id: pageId, grid: pageGrid(),
        location: { x: cell($('x').value, 0), y: cell($('y').value, 0) },
        size: { width: cell($('w').value, 4), height: cell($('h').value, 2) },
        width: cell($('width').value, 640), fps: cell($('fps').value, 24),
        mode: old?.mode || 'hls', enabled: $('enabled').checked
      };
      if ($('url').value.trim()) d.url = $('url').value.trim();
      return d;
    }
    function renderList() {
      const box = $('existing');
      const entries = widgets.filter(w => w.activity_id === activityId && w.page_id === pageId);
      box.replaceChildren();
      if (!entries.length) return;
      const heading = document.createElement('div'); heading.className = 'group-title';
      heading.textContent = 'Video Streams on this page'; box.append(heading);
      for (const w of entries) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'existing-widget' + (selectedId === w.id ? ' active' : '');
        btn.innerHTML = icon;
        const name = document.createElement('span'); name.textContent = w.name; btn.append(name);
        btn.addEventListener('click', () => edit(w.id));
        box.append(btn);
      }
    }
    function renderOverlay() {
      if (!tileLayer || !grid || !tileLayer.isConnected) return;
      const gridSize = pageGrid();
      tileLayer.replaceChildren();
      const entries = widgets.filter(w => w.enabled && w.activity_id === activityId && w.page_id === pageId).map(w => selectedId === w.id ? { ...w, ...data() } : w);
      if ($('inspector').hidden === false && !selectedId && $('name').value.trim()) {
        entries.push({ ...data(), id: '__draft' });
      }
      entries.forEach(w => {
        const t = document.createElement('div');
        t.className = 'uc-video-stream-tile' + (w.id === selectedId ? ' selected' : '');
        t.style.cssText =
          'position:absolute;z-index:3;pointer-events:auto;cursor:move;' +
          'display:flex;align-items:center;justify-content:center;' +
          'background:rgba(14,35,58,.92);color:#e7f1ff;text-align:center;' +
          'font:600 12px/1.3 system-ui,sans-serif;border:2px solid ' +
          (w.id === selectedId ? '#f2bf6b' : '#74a8ff') + ';' +
          'box-sizing:border-box;border-radius:5px;overflow:hidden;' +
          'left:' + (100 * w.location.x / gridSize.width) + '%;' +
          'top:' + (100 * w.location.y / gridSize.height) + '%;' +
          'width:' + (100 * w.size.width / gridSize.width) + '%;' +
          'height:' + (100 * w.size.height / gridSize.height) + '%;';
        const content = document.createElement('span');
        content.textContent = '▣  ' + (w.name || 'Video Stream');
        t.append(content);
        t.title = 'Video Stream · ' + w.name + ' · Click to edit or drag to reposition';
        t.addEventListener('click', e => { e.stopPropagation(); if (w.id !== '__draft') edit(w.id); });
        t.addEventListener('pointerdown', e => {
          if (e.button !== 0 || w.id === '__draft') return;
          e.preventDefault(); e.stopPropagation();
          dragItemId = w.id;
          t.setPointerCapture(e.pointerId);
        });
        t.addEventListener('pointerup', e => {
          if (dragItemId !== w.id) return;
          dragItemId = '';
          if (!grid) return;
          const rect = grid.getBoundingClientRect();
          const x = Math.max(0, Math.min(gridSize.width - w.size.width,
            Math.floor((e.clientX - rect.left) * gridSize.width / rect.width)));
          const y = Math.max(0, Math.min(gridSize.height - w.size.height,
            Math.floor((e.clientY - rect.top) * gridSize.height / rect.height)));
          edit(w.id); $('x').value = x; $('y').value = y;
          inform('Position changed. Select Save Video Stream to apply.');
          render();
        });
        tileLayer.append(t);
      });
    }
    const render = () => { renderList(); renderOverlay(); };
    function placeAt(clientX, clientY) {
      if (!grid) return;
      const rect = grid.getBoundingClientRect(), g = pageGrid();
      const w = +$('w').value || 4, h = +$('h').value || 2;
      $('x').value = Math.max(0, Math.min(g.width - w, Math.floor((clientX - rect.left) / rect.width * g.width)));
      $('y').value = Math.max(0, Math.min(g.height - h, Math.floor((clientY - rect.top) / rect.height * g.height)));
      $('inspector').hidden = false; render();
      inform('Video Stream positioned. Enter its RTSP URL and save.');
    }
    function add() { reset(); $('name').focus(); }
    $('widget').addEventListener('click', add);
    $('widget').addEventListener('dragstart', e => {
      reset();
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-uc-video-stream', '1'); e.dataTransfer.setData('text/plain', 'uc-video-stream'); }
    });
    $('collapse').addEventListener('click', () => { $('inspector').hidden = true; inform(''); render(); });
    $('activity').addEventListener('change', async () => {
      activityId = $('activity').value; pageId = ''; selectedId = '';
      await fetchPages(); render();
    });
    $('page').addEventListener('change', () => { pageId = $('page').value; selectedId = ''; $('inspector').hidden = true; render(); });
    ['name','x','y','w','h','width','fps'].forEach(key => $(key).addEventListener('input', renderOverlay));
    $('save').addEventListener('click', async () => {
      if (busy) return;
      const v = data(), g = v.grid;
      if (!activityId || !pageId) return inform('Select an activity and page.');
      if (!v.name || (!selectedId && !v.url)) return inform('Provide a name and RTSP source URL.');
      if (v.location.x < 0 || v.location.y < 0 || v.size.width < 1 || v.size.height < 1 ||
          v.location.x + v.size.width > g.width || v.location.y + v.size.height > g.height) {
        return inform('Video Stream must fit within the activity grid.');
      }
      busy = true; $('save').disabled = true;
      try {
        const created = await api(selectedId ? '/widgets/' + selectedId : '/widgets', {
          method: selectedId ? 'PUT' : 'POST', body: JSON.stringify(v)
        });
        widgets = await api('/widgets');
        edit(created.id);
        inform('Video Stream saved for this activity page.');
      } catch (e) { inform('Save failed: ' + e.message); }
      finally { busy = false; $('save').disabled = false; }
    });
    $('delete').addEventListener('click', async () => {
      if (!selectedId || busy || !confirm('Delete this Video Stream widget?')) return;
      busy = true;
      try {
        await api('/widgets/' + selectedId, { method: 'DELETE' });
        widgets = await api('/widgets');
        selectedId = ''; $('inspector').hidden = true;
        inform('Video Stream removed.'); render();
      } catch (e) { inform('Delete failed: ' + e.message); }
      finally { busy = false; }
    });
    h._vs = { $, render, edit, reset, placeAt, updateSelect, inform };
    return h;
  }
  function attachGrid(next) {
    if (next === grid && tileLayer?.isConnected) return;
    if (tileLayer) tileLayer.remove();
    if (grid && grid._vsDragHandlers) {
      grid.removeEventListener('dragover', grid._vsDragHandlers[0], true);
      grid.removeEventListener('drop', grid._vsDragHandlers[1], true);
      delete grid._vsDragHandlers;
    }
    grid = next; tileLayer = null;
    if (!grid || !slot) return;
    if (getComputedStyle(grid).position === 'static') grid.style.position = 'relative';
    tileLayer = document.createElement('div'); tileLayer.id = 'uc-video-stream-overlay';
    tileLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20;overflow:hidden;';
    grid.append(tileLayer);
    const over = e => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('application/x-uc-video-stream')) { e.preventDefault(); e.stopImmediatePropagation(); e.dataTransfer.dropEffect = 'copy'; }
    };
    const drop = e => {
      if (e.dataTransfer?.getData('application/x-uc-video-stream') !== '1') return;
      e.preventDefault(); e.stopImmediatePropagation(); slot._vs.placeAt(e.clientX, e.clientY);
    };
    grid.addEventListener('dragover', over, true);
    grid.addEventListener('drop', drop, true);
    grid._vsDragHandlers = [over, drop];
    slot._vs.render();
  }
  async function fetchPages() {
    const serial = ++loadSerial, current = activityId;
    if (!current || !slot) { pageRows = []; pageId = ''; return; }
    try {
      const rows = await api('/core/activities/' + encodeURIComponent(current) + '/pages');
      if (serial !== loadSerial) return;
      pageRows = rows;
      slot._vs.updateSelect(slot._vs.$('page'), rows, 'Select page');
      const fromUrl = identityFromUrl(rows);
      const old = rows.some(r => r.id === pageId) ? pageId : null;
      pageId = old || fromUrl?.id || (rows.length === 1 ? rows[0].id : '') || '';
      slot._vs.$('page').value = pageId;
      if (!pageId) slot._vs.inform('Select the activity page to edit.');
      slot._vs.render();
    } catch (e) { if (serial === loadSerial) slot._vs.inform('Cannot load activity pages: ' + e.message); }
  }
  function syncSelectedPage() {
    if (!slot || !pageRows.length) return;
    const fromUrl = identityFromUrl(pageRows);
    let next = fromUrl?.id || '';
    if (!next) {
      const controls = document.querySelectorAll('button,[role="tab"],[aria-selected],li');
      for (const p of pageRows) {
        for (const el of controls) {
          if (!visible(el) || el.closest('#' + ADDON) || label(el) !== p.name) continue;
          const selected = el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('aria-current') === 'page' ||
            /(^|\s)(active|selected|current)(\s|$)/i.test(String(el.className || '')) ||
            /(^|\s)(active|selected|current)(\s|$)/i.test(String(el.parentElement?.className || ''));
          if (selected) { next = p.id; break; }
        }
        if (next) break;
      }
    }
    if (next && next !== pageId) {
      pageId = next; selectedId = '';
      slot._vs.$('page').value = pageId;
      slot._vs.render();
    }
  }

  async function initialize() {
    if (loading || !slot) return;
    loading = true;
    try {
      const values = await Promise.all([api('/core/activities'), api('/widgets')]);
      activityRows = values[0]; widgets = values[1];
      slot._vs.updateSelect(slot._vs.$('activity'), activityRows, 'Select activity');
      const fromUrl = identityFromUrl(activityRows);
      activityId = fromUrl?.id || (activityRows.length === 1 ? activityRows[0].id : '') || activityId;
      if (!activityRows.some(r => r.id === activityId)) activityId = '';
      slot._vs.$('activity').value = activityId;
      await fetchPages();
      slot._vs.render();
    } catch (e) { slot._vs.inform('Video Stream configuration unavailable: ' + e.message); }
    finally { loading = false; }
  }
  function mount() {
    if (!document.body || !location.pathname.startsWith('/configurator')) return;
    const found = findPalette();
    if (!found) {
      if (slot) { slot.remove(); slot = null; }
      attachGrid(null);
      return;
    }
    if (!slot) { slot = createUI(); initialize(); }
    if (found.anchor !== palette || !slot.isConnected) {
      palette = found.anchor;
      palette.insertAdjacentElement('afterend', slot);
    }
    const screen = findGrid();
    if (screen) attachGrid(screen);
    else attachGrid(null);
    if (location.pathname + location.hash !== lastRoute) {
      lastRoute = location.pathname + location.hash;
      // Routing to another activity must update selected IDs, while preserving
      // the sidebar placement and the native Configurator controls.
      if (activityRows.length) {
        const current = identityFromUrl(activityRows);
        if (current && current.id !== activityId) {
          activityId = current.id; pageId = ''; selectedId = '';
          slot._vs.$('activity').value = activityId;
          fetchPages();
        } else if (pageRows.length) {
          const pg = identityFromUrl(pageRows);
          if (pg && pg.id !== pageId) { pageId = pg.id; slot._vs.$('page').value = pageId; slot._vs.render(); }
        }
      }
    }
    syncSelectedPage();
  }
  // The stock Configurator is an SPA; mutation events and route changes may
  // recreate the entire widget palette or page grid.
  let scheduled = false;
  const queueMount = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mount(); }, 180);
  };
  const boot = () => {
    mount();
    new MutationObserver(queueMount).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', queueMount);
    window.addEventListener('hashchange', queueMount);
    document.addEventListener('click', queueMount, true);
    setInterval(() => { if (location.pathname + location.hash !== lastRoute || (slot && !slot.isConnected)) mount(); }, 1600);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
