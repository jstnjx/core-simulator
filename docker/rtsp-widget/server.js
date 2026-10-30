import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamManager } from './streams.js';

const here = dirname(fileURLToPath(import.meta.url));
const int = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(label + ' must be between ' + min + ' and ' + max);
  return v;
};
const requiredText = (v, label, limit = 120) => {
  if (typeof v !== 'string' || !v.trim() || v.length > limit) throw new Error('Invalid ' + label);
  return v.trim();
};
const validStreamUrl = value => {
  const source = requiredText(value, 'RTSP URL', 2048);
  let u;
  try { u = new URL(source); } catch { throw new Error('Invalid RTSP URL'); }
  if (!['rtsp:', 'rtsps:'].includes(u.protocol) || !u.hostname || u.hash) {
    throw new Error('Only rtsp:// and rtsps:// URLs are supported');
  }
  return source;
};
const visible = widget => {
  const { url, ...rest } = widget;
  const parsed = new URL(url);
  return { ...rest, source: parsed.protocol + '//' + parsed.host };
};

export function createApp({ password, databasePath = '/data/widgets.json', idleMs = 90000, managerFactory } = {}) {
  if (!password || password.length < 12) throw new Error('RTSP_WIDGET_PASSWORD must be at least 12 characters');
  mkdirSync(dirname(databasePath), { recursive: true });
  let widgets = [];
  if (existsSync(databasePath)) {
    const data = JSON.parse(readFileSync(databasePath, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Invalid widgets.json format');
    widgets = data;
  }
  const byId = id => widgets.find(w => w.id === id);
  const manager = managerFactory ? managerFactory(byId) : new StreamManager({ getWidget: byId, idleMs });
  const persist = () => {
    const temp = databasePath + '.' + process.pid + '.tmp';
    writeFileSync(temp, JSON.stringify(widgets, null, 2), { mode: 0o600 });
    renameSync(temp, databasePath);
  };
  const tokenValid = req => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    let pair;
    try { pair = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
    const sep = pair.indexOf(':');
    if (sep < 0 || pair.slice(0, sep) !== 'admin') return false;
    const supplied = Buffer.from(pair.slice(sep + 1));
    const expected = Buffer.from(password);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const json = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const readJson = async req => {
    let total = 0;
    const pieces = [];
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 16384) throw new Error('Request body too large');
      pieces.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(pieces).toString('utf8')); }
    catch { throw new Error('Invalid JSON'); }
  };
  const validate = (raw, old) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected object');
    const name = requiredText(raw.name ?? old?.name, 'name');
    const source = raw.url ? validStreamUrl(raw.url) : old?.url;
    if (!source) throw new Error('RTSP URL required');
    const activityId = requiredText(raw.activity_id ?? old?.activity_id, 'activity_id');
    const pageId = requiredText(raw.page_id ?? old?.page_id, 'page_id');
    const location = raw.location ?? old?.location ?? { x: 0, y: 0 };
    const size = raw.size ?? old?.size ?? { width: 4, height: 2 };
    if (!location || !size) throw new Error('location and size required');
    const x = int(location.x, 0, 15, 'location.x');
    const y = int(location.y, 0, 15, 'location.y');
    const w = int(size.width, 1, 16, 'size.width');
    const h = int(size.height, 1, 16, 'size.height');
    const grid = raw.grid ?? old?.grid ?? { width: 4, height: 6 };
    const gw = int(grid.width, 1, 16, 'grid.width');
    const gh = int(grid.height, 1, 16, 'grid.height');
    if (x + w > gw || y + h > gh) throw new Error('Widget exceeds activity grid');
    const mode = raw.mode ?? old?.mode ?? 'hls';
    if (!['hls', 'mjpeg'].includes(mode)) throw new Error('mode must be hls or mjpeg');
    return {
      id: old?.id ?? randomUUID(), name, url: source,
      activity_id: activityId, page_id: pageId,
      location: { x, y }, size: { width: w, height: h }, grid: { width: gw, height: gh },
      width: int(raw.width ?? old?.width ?? 640, 160, 1280, 'width'),
      fps: int(raw.fps ?? old?.fps ?? 12, 1, 30, 'fps'),
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : old?.enabled ?? true,
      mode,
      created_at: old?.created_at ?? new Date().toISOString()
    };
  };
  const sendFile = (res, filename, contentType) => {
    if (!existsSync(filename)) { json(res, 404, { error: 'Not found' }); return; }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  };
  const serve = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { json(res, 400, { error: 'Invalid URL' }); return; }
    if (url.pathname === '/health') { json(res, 200, { ok: true }); return; }
    if (!tokenValid(req)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="UC RTSP Widgets"');
      json(res, 401, { error: 'Authentication required' });
      return;
    }
    const path = url.pathname;
    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html'))
        return sendFile(res, join(here, 'public/index.html'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && path === '/app.js')
        return sendFile(res, join(here, 'public/app.js'), 'application/javascript; charset=utf-8');
      if (req.method === 'GET' && path === '/style.css')
        return sendFile(res, join(here, 'public/style.css'), 'text/css; charset=utf-8');
      if (req.method === 'GET' && path === '/hls.min.js')
        return sendFile(res, join(here, 'node_modules/hls.js/dist/hls.min.js'), 'application/javascript; charset=utf-8');
      if (req.method === 'GET' && path === '/api/widgets')
        return json(res, 200, widgets.map(w => ({ ...visible(w), status: manager.status(w.id) })));

      const scoped = path.match(/^\/api\/activities\/([^/]+)\/pages\/([^/]+)\/widgets$/);
      if (req.method === 'GET' && scoped) {
        const activity = decodeURIComponent(scoped[1]);
        const page = decodeURIComponent(scoped[2]);
        return json(res, 200, widgets.filter(w => w.activity_id === activity && w.page_id === page).map(visible));
      }
      if (req.method === 'POST' && path === '/api/widgets') {
        if (widgets.length >= 32) return json(res, 409, { error: 'Maximum of 32 configured streams' });
        const record = validate(await readJson(req));
        widgets.push(record);
        persist();
        return json(res, 201, visible(record));
      }
      const idMatch = path.match(/^\/api\/widgets\/([a-z0-9-]+)(?:\/(restart|stop))?$/);
      if (idMatch) {
        const [ , id, action ] = idMatch;
        const old = byId(id);
        if (!old) return json(res, 404, { error: 'Widget not found' });
        if (req.method === 'GET' && !action)
          return json(res, 200, { ...visible(old), status: manager.status(id) });
        if (req.method === 'PUT' && !action) {
          const update = validate(await readJson(req), old);
          manager.stop(id);
          widgets = widgets.map(w => w.id === id ? update : w);
          persist();
          return json(res, 200, visible(update));
        }
        if (req.method === 'DELETE' && !action) {
          manager.stop(id);
          widgets = widgets.filter(w => w.id !== id);
          persist();
          res.writeHead(204); res.end(); return;
        }
        if (req.method === 'POST' && action) {
          manager.stop(id);
          if (action === 'restart') manager.start(id);
          return json(res, 200, manager.status(id));
        }
      }
      const embed = path.match(/^\/embed\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && embed) {
        const widget = byId(embed[1]);
        if (!widget) return json(res, 404, { error: 'Widget not found' });
        const config = JSON.stringify({ id: widget.id, mode: widget.mode, name: widget.name }).replaceAll('<', '\\u003c');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><script src="/hls.min.js"></script></head><body class="embed"><div id="player"></div><script>window.WIDGET=' + config + '</script><script src="/app.js"></script></body></html>');
        return;
      }
      const hls = path.match(/^\/hls\/([a-z0-9-]+)\/(index\.m3u8|segment-[0-9]+\.ts)$/);
      if (req.method === 'GET' && hls) {
        const [ , id, filename ] = hls;
        if (!byId(id)) return json(res, 404, { error: 'Widget not found' });
        const file = filename === 'index.m3u8' ? await manager.playlist(id) : manager.segment(id, filename);
        if (!file) return json(res, filename === 'index.m3u8' ? 503 : 404, { error: 'Stream not ready' });
        return sendFile(res, file, filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
      }
      const mjpeg = path.match(/^\/mjpeg\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && mjpeg) {
        if (!byId(mjpeg[1])) return json(res, 404, { error: 'Widget not found' });
        if (manager.mjpeg(mjpeg[1], res)) return;
        return json(res, 503, { error: 'Stream unavailable' });
      }
      json(res, 404, { error: 'Not found' });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  };
  const server = http.createServer((req, res) => {
    serve(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
      else res.destroy();
    });
  });
  return { server, manager };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server, manager } = createApp({
    password: process.env.RTSP_WIDGET_PASSWORD,
    databasePath: process.env.RTSP_WIDGET_DB || '/data/widgets.json',
    idleMs: Number(process.env.RTSP_WIDGET_IDLE_MS || 90000)
  });
  const port = Number(process.env.RTSP_WIDGET_PORT || 8091);
  server.listen(port, '0.0.0.0', () => console.log('RTSP widget service listening on :' + port));
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => {
    manager.close(); server.close(() => process.exit(0));
  });
}
