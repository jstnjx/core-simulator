(() => {
  'use strict';
  // The Core Simulator binary does not support third-party activity-item types.
  // These controls live inside the stock activity editor; their data remains in
  // the RTSP sidecar, keyed by the current Core activity and UI page.
  if (window.__ucVideoStreamWidget) return;
  window.__ucVideoStreamWidget = true;
  document.documentElement.dataset.ucVideoStreamAddon = 'loaded';
  console.info('[Video Stream] Configurator extension loaded');
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
  function findExactText(text, roots = document) {
    const candidates = roots.querySelectorAll('button,[role="button"],[role="tab"],h2,h3,h4,h5,h6,legend,span,p,div');
    return Array.from(candidates).filter(el =>
      visible(el) && !el.closest('#' + ADDON) &&
      label(el).toLowerCase() === text.toLowerCase() &&
      // Match the smallest textual leaf, not a broad enclosing panel.
      !Array.from(el.children).some(c => label(c).toLowerCase() === text.toLowerCase())
    );
  }
  function isEditorOpen() {
    if (!location.pathname.startsWith('/configurator')) return false;
    const modeLabels = [['Move','Bewegen'],['Edit','Bearbeiten'],['Select','Auswählen'],['Test','Testen']];
    const present = modeLabels.filter(names => names.some(name => findExactText(name).length > 0));
    const uiTab = ['User interface','Benutzeroberfläche','User Interface'].some(name => findExactText(name).length > 0);
    const gridButton = ['Grid','Raster'].some(name => findExactText(name).length > 0);
    const resetButton = ['Reset','Zurücksetzen'].some(name => findExactText(name).length > 0);
    const stockWidgets = ['Widgets','Widget','Media widget','Text widget','Medien-Widget','Text-Widget'].some(name => findExactText(name).length > 0);
    // Default editing screen has a four-state Move/Edit/Select/Test switch
    // and Grid/Reset tools even BEFORE opening the stock "Add" menu.
    return (present.length >= 3 && (gridButton || resetButton || uiTab)) ||
      (stockWidgets && (uiTab || gridButton || present.length >= 2));
  }
  // The stock picker is a Vue component bundled in the Core image. Copy an
  // actual built-in widget tile rather than imitating its markup and theme.
  // Cloning preserves Vue-scoped classes, spacing, typography and icons.
  let recentAddControl = 0;
  // Core 2.x uses a transient Add menu. Remember an actual Add click to
  // recognize widget lists whose icon-only entries have no visible labels.
  document.addEventListener('click', event => {
    const source = event.target?.closest?.('button,[role="button"]');
    const name = normalizeWidgetText(source?.textContent || source?.getAttribute('aria-label'));
    if (/^(?:add(?: widgets?| controls?)?|hinzufügen(?: (?:widget|widgets|steuerelemente))?)$/i.test(name) && isEditorOpen()) {
      recentAddControl = Date.now();
      setTimeout(() => {
        if (!document.querySelector('[data-uc-video-stream-native]')) {
          console.info('[Video Stream] Add menu opened, but no native widget match yet. Inspect with ucVideoStreamDiagnostics()');
        }
      }, 1100);
    }
  }, true);
  const typeNames = {
    media: /\b(?:media[\s-]?(?:player|widget|control)|media(?:player)?|medien[\s-]?(?:player|widget|steuerung)|medienwiedergabe)\b/i,
    select: /\b(?:select(?:ion)?(?:\s+widget)?|auswahl(?:-widget)?|dropdown)\b/i,
    button: /\b(?:button(?:s)?(?:\s+widget)?|icon[\s-]?widget|icon[\s-]?button|text[\s-]?widget|text[\s-]?button|taste(?:n-widget)?|symbol[\s-]?widget)\b/i
  };
  // Display text may be split across nested spans or supplied only by title,
  // aria-label, data attributes or a tooltip. Never require one exact label.
  const normalizeWidgetText = value => String(value || '').replace(/[\u00a0\s]+/g, ' ').trim();
  function widgetKind(el) {
    const values = [
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-type'),
      el.getAttribute?.('data-widget-type')
    ].map(normalizeWidgetText).filter(value => value && value.length < 85);
    for (const value of values) {
      if (typeNames.media.test(value)) return 'media';
      if (typeNames.select.test(value)) return 'select';
      if (typeNames.button.test(value)) return 'button';
    }
    return null;
  }
  function nativeWidgetCandidate(node) {
    if (!node) return null;
    const role = 'button,[role="button"],[role="option"],li,[draggable],' +
      '[class*="widget"],[class*="Widget"],[class*="item"],[class*="Item"],' +
      '[class*="card"],[class*="Card"],[class*="cursor-pointer"],[class*="v-card"]';
    return node.closest(role) || node.parentElement;
  }
  function widgetMenuRegion(el) {
    const selector = '[role="dialog"],[role="menu"],[role="listbox"],[role="group"],' +
      '[class*="menu"],[class*="Menu"],[class*="popover"],[class*="Popover"],' +
      '[class*="overlay"],[class*="Overlay"],[class*="dialog"],[class*="Dialog"]';
    return el.closest(selector);
  }
  // Return a native widget tile whose *siblings* represent other types. This
  // avoids relying on the old "Media Player" / "Button" / "Select" translations.
  function findNativeWidgetTemplate() {
    if (!location.pathname.startsWith('/configurator')) return null;
    const list = document.querySelectorAll(
      'button,[role="button"],[role="option"],[draggable],li,span,p,div,' +
      'h3,h4,h5,h6,[title],[aria-label],[data-type],[data-widget-type]');
    const entries = [];
    for (const el of list) {
      if (!visible(el) || el.closest('#' + ADDON) ||
          el.closest('[data-uc-video-stream-native]')) continue;
      const kind = widgetKind(el);
      if (!kind) continue;
      // Prefer the deepest label, not its parent with all the same text.
      if (Array.from(el.children).some(child => visible(child) && widgetKind(child) === kind)) continue;
      const card = nativeWidgetCandidate(el);
      if (card && !entries.some(entry => entry.card === card && entry.kind === kind))
        entries.push({ kind, label: el, card });
    }
    for (const media of entries.filter(e => e.kind === 'media')) {
      let card = media.card;
      for (let depth = 0; card && depth < 6; card = card.parentElement, depth++) {
        if (!visible(card)) continue;
        const box = card.getBoundingClientRect();
        if (box.width < 55 || box.height < 18 || box.width > 950 || box.height > 260) continue;
        const parent = card.parentElement;
        if (!parent || parent.children.length < 2) continue;
        // The real picker is a collection of sibling cards. Accept its
        // built-in Media, Icon/Text, Button or Select choices.
        const siblings = entries.filter(e => e.kind !== 'media' &&
          Array.from(parent.children).some(sibling => sibling !== card && sibling.contains?.(e.label)));
        const menu = widgetMenuRegion(card);
        const widgetHeading = menu && /(?:^|\\s)(?:widgets?|ui widgets?|widget-types?|steuerelemente)(?:$|\\s)/i.test(
          normalizeWidgetText(menu.querySelector?.('h2,h3,h4,h5,legend,[role="heading"]')?.textContent));
        const recentAdd = Date.now() - recentAddControl < 90000;
        const otherTiles = Array.from(parent.children).filter(sibling =>
          sibling !== card && visible(sibling) && sibling.getBoundingClientRect().height >= 18).length;
        // A recognized neighboring type is the strongest signal; a named
        // Widgets menu or a recent Add action also permits icon-only tiles.
        if (!siblings.length && !(menu && (widgetHeading || recentAdd) && otherTiles >= 1)) continue;
        if (!isEditorOpen() && !menu && !recentAdd) continue;
        // Reject a broad unrelated list containing device entities by
        // requiring the card to have a nearby sibling of a widget type.
        return { card, sourceText: normalizeWidgetText(media.label.textContent) ||
          media.label.getAttribute?.('aria-label') || 'Media', parent, siblings: siblings.length };
      }
    }
    return null;
  }
  function cloneFirstPartyWidget(template) {
    const clone = template.card.cloneNode(true);
    clone.setAttribute('data-uc-video-stream-native', '1');
    // IDs and ARIA associations must be unique; Vue's event handlers are not
    // carried over by cloneNode, so no stock media-player action is duplicated.
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      el.removeAttribute('id');
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-describedby');
    }
    clone.setAttribute('role', 'button');
    clone.setAttribute('tabindex', '0');
    clone.setAttribute('aria-label', 'Video Stream');
    clone.setAttribute('title', 'Video Stream');
    clone.setAttribute('draggable', 'true');
    let renamed = false;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = (textNode.textContent || '').trim();
      if (typeNames.media.test(text)) { textNode.textContent = textNode.textContent.replace(text, 'Video Stream'); renamed = true; }
    }
    if (!renamed) {
      const label = clone.querySelector('span,strong,p');
      if (label) label.textContent = 'Video Stream';
    }
    const iconNode = clone.querySelector('svg');
    if (iconNode) {
      // Preserve the native icon sizing and classes.
      iconNode.setAttribute('viewBox', '0 0 24 24');
      iconNode.setAttribute('fill', 'none');
      iconNode.setAttribute('stroke', 'currentColor');
      iconNode.setAttribute('stroke-width', '1.8');
      iconNode.innerHTML = '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>';
    }
    else {
      const fa = clone.querySelector('i[class*="fa-"]');
      if (fa) {
        fa.className = fa.className.replace(/\bfa-[a-z0-9-]+/g, x =>
          /^fa-(?:solid|regular|light|thin|duotone|brands)$/.test(x) ? x : 'fa-video');
      }
    }
    const startNew = event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      if (!slot) return;
      slot._vs.reset();
      slot.style.display = 'block';
      slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      console.info('[Video Stream] Selected native widget entry');
    };
    clone.addEventListener('pointerdown', e => e.stopPropagation(), true);
    clone.addEventListener('click', startNew, true);
    clone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') startNew(e); }, true);
    clone.addEventListener('dragstart', e => {
      if (!slot) return;
      slot._vs.reset();
      slot.style.display = 'block';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-uc-video-stream', '1');
        e.dataTransfer.setData('text/plain', 'uc-video-stream');
      }
      e.stopPropagation();
    }, true);
    return clone;
  }
  // Safe diagnostics: report only the presence and structure of known widget
  // entries. Do not serialize DOM HTML, user input fields, camera URLs or auth.
  window.ucVideoStreamDiagnostics = () => {
    const matches = Array.from(document.querySelectorAll(
      'button,[role="button"],[role="option"],span,div,li,[title],[aria-label]'))
      .filter(el => visible(el) && !el.closest('#' + ADDON))
      .map(el => ({ kind: widgetKind(el), el }))
      .filter(record => record.kind)
      .filter(record => !Array.from(record.el.children).some(c => widgetKind(c) === record.kind))
      .slice(0, 35)
      .map(record => ({
        kind: record.kind,
        tag: record.el.tagName,
        label: normalizeWidgetText(record.el.textContent).slice(0, 45),
        parentTag: record.el.parentElement?.tagName || '',
        parentClass: String(record.el.parentElement?.className || '').slice(0, 100),
        nearbyCards: record.el.parentElement?.parentElement?.children?.length || 0
      }));
    const detected = findNativeWidgetTemplate();
    const result = { script: 'loaded', editorDetected: isEditorOpen(),
      nativePickerFound: !!detected, nativeEntryInserted: !!nativeTile?.isConnected,
      recentAdd: Date.now() - recentAddControl < 90000, candidates: matches };
    console.table(result.candidates);
    return result;
  };
  let nativeTile = null;
  function ensureNativeWidgetPicker() {
    const template = findNativeWidgetTemplate();
    if (!template) {
      if (nativeTile && !nativeTile.isConnected) nativeTile = null;
      return;
    }
    if (nativeTile?.isConnected && nativeTile.previousElementSibling === template.card) return;
    if (nativeTile) nativeTile.remove();
    nativeTile = cloneFirstPartyWidget(template);
    template.card.insertAdjacentElement('afterend', nativeTile);
    // Match the native editor's colors in the settings panel as well.
    const styles = getComputedStyle(template.card);
    const bodyStyles = getComputedStyle(template.card.parentElement);
    if (slot) {
      const color = c => c && !['transparent', 'rgba(0, 0, 0, 0)'].includes(c);
      const fallbackBackground = getComputedStyle(document.body).backgroundColor;
      slot.style.setProperty('--vs-native-background',
        color(bodyStyles.backgroundColor) ? bodyStyles.backgroundColor :
        color(styles.backgroundColor) ? styles.backgroundColor : fallbackBackground);
      slot.style.setProperty('--vs-native-text', styles.color);
      slot.style.setProperty('--vs-native-radius', styles.borderRadius);
      slot.style.setProperty('--vs-native-border', styles.borderColor);
    }
    console.info('[Video Stream] Native widget tile inserted alongside Media Player');
  }

  // Inspector is attached to the persistent editor controls rather than the
  // transient "Add widget" menu, which Vue can destroy on selection.
  function findPalette() {
    if (!isEditorOpen()) return null;
    for (const name of ['Add','Hinzufügen','Grid','Raster','Reset','Zurücksetzen']) {
      const hits = findExactText(name).filter(e =>
        e.matches('button,[role="button"]') || e.closest('button,[role="button"]'));
      const best = hits.find(el => el.getBoundingClientRect().right > innerWidth * .5) || hits[0];
      if (best) return { anchor: best.closest('button,[role="button"]') || best, source: 'editor controls' };
    }
    return null;
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
    h.style.display = 'none';
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
      $('inspector').hidden = false; h.style.display = 'block'; inform(''); render();
    };
    const edit = id => {
      const w = widgets.find(w => w.id === id); if (!w) return;
      selectedId = id; pendingPlacement = null;
      $('inspector').hidden = false;
      h.style.display = 'block';
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
        if (w.id !== '__draft' && w.enabled) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = '/rtsp-addon/media/mjpeg/' + encodeURIComponent(w.id);
          img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
            'object-fit:cover;pointer-events:none;';
          t.append(img);
        }
        const content = document.createElement('span');
        content.textContent = '▣  ' + (w.name || 'Video Stream');
        content.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:5px 3px;' +
          'background:rgba(0,0,0,.65);pointer-events:none;text-align:center;';
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
    $('collapse').addEventListener('click', () => { $('inspector').hidden = true; h.style.display = 'none'; inform(''); render(); });
    $('activity').addEventListener('change', async () => {
      activityId = $('activity').value; pageId = ''; selectedId = '';
      await fetchPages(); render();
    });
    $('page').addEventListener('change', () => { pageId = $('page').value; selectedId = ''; $('inspector').hidden = true; h.style.display = 'none'; render(); });
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
    const template = findNativeWidgetTemplate();
    if (!found && !template) {
      if (slot) { slot.remove(); slot = null; }
      if (nativeTile) { nativeTile.remove(); nativeTile = null; }
      attachGrid(null);
      return;
    }
    if (!slot) {
      slot = createUI();
      initialize();
      console.info('[Video Stream] Video Stream inspector ready');
    }
    if (found && (found.anchor !== palette || !slot.isConnected)) {
      palette = found.anchor;
      palette.insertAdjacentElement('afterend', slot);
      slot.style.position = '';
      slot.style.width = '';
      console.info('[Video Stream] Inspector mounted in', found.source);
    } else if (!found && !slot.isConnected && template) {
      // The picker may be an overlay that temporarily hides the Add toolbar.
      // Keep a usable first-party-style inspector when the menu closes.
      document.body.append(slot);
      Object.assign(slot.style, {
        position: 'fixed', top: '90px', right: '24px',
        width: 'min(360px,calc(100vw - 40px))',
        zIndex: '2147483000', maxHeight: 'calc(100vh - 115px)', overflowY: 'auto'
      });
    }
    ensureNativeWidgetPicker();
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
