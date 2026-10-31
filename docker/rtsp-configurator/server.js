import http from 'node:http';
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const nativeRoot = resolve(here, 'native-dist');
const nativeExists = existsSync(join(nativeRoot, 'index.html'));
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'], ['.ttf', 'font/ttf'], ['.ico', 'image/x-icon']
]);
function sendNativeFile(req, res, pathname) {
  if (!nativeExists || !['GET','HEAD'].includes(req.method)) return false;
  let name;
  try { name = decodeURIComponent(pathname); } catch { return false; }
  if (name.startsWith('/configurator')) name = name.slice('/configurator'.length);
  else if (!/^(?:\/images\/|\/fonts\/|\/assets\/)/.test(name)) return false;
  if (!name || name === '/') name = '/index.html';
  const file = resolve(nativeRoot, '.' + name);
  if (file !== nativeRoot && !file.startsWith(nativeRoot + sep)) return false;
  let selected = file;
  try {
    if (!statSync(selected).isFile()) return false;
  } catch {
    if (!pathname.startsWith('/configurator') || extname(file)) return false;
    selected = join(nativeRoot, 'index.html');
  }
  const info = statSync(selected);
  res.writeHead(200, {
    'Content-Type': contentTypes.get(extname(selected)) || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': selected.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(selected).pipe(res);
  return true;
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
};
const sameOrigin = req => {
  const origin = req.headers.origin;
  if (!origin) return true; // Browsers usually omit Origin on same-origin GET.
  try {
    const o = new URL(origin);
    return o.host === req.headers.host && (o.protocol === 'http:' || o.protocol === 'https:');
  } catch { return false; }
};

const parseTarget = value => {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !u.hostname) throw new Error('Upstream must be an HTTP URL');
  return u;
};

export function createServer({ coreUrl = 'http://core-simulator:8080', rtspUrl = 'http://rtsp-widget:8091',
  rtspPassword, cookieCheck = '/api/activities?limit=1&page=1', fetchImpl = fetch } = {}) {
  if (!rtspPassword) throw new Error('RTSP_WIDGET_PASSWORD is required');
  const core = parseTarget(coreUrl), rtsp = parseTarget(rtspUrl);
  const secret = 'Basic ' + Buffer.from('admin:' + rtspPassword).toString('base64');

  const authenticated = async req => {
    // Validate the *caller's* existing Core session, not the server's API key.
    // Never issue a Core admin credential to the injected web script.
    const response = await fetchImpl(new URL(cookieCheck, core), {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6500),
      headers: {
        Cookie: req.headers.cookie || '',
        Authorization: req.headers.authorization || '',
        Accept: 'application/json'
      }
    });
    return response.status === 200;
  };

  const requestUpstream = (req, res, base, relativePath, { admin = false, inject = false, maxBody = 65536 } = {}) => {
    const target = new URL(relativePath, base);
    const headers = { ...req.headers, host: admin ? target.host : (req.headers.host || target.host), 'accept-encoding': 'identity' };
    delete headers['transfer-encoding'];
    if (admin) {
      headers.authorization = secret;
      delete headers.cookie;
      delete headers.origin;
      delete headers.referer;
      delete headers['sec-fetch-site'];
      delete headers['sec-fetch-mode'];
      delete headers['sec-fetch-dest'];
    }
    const upstream = http.request(target, { method: req.method, headers, timeout: 20000 }, upstreamResponse => {
      const contentType = upstreamResponse.headers['content-type'] || '';
      const shouldInject = inject && req.method === 'GET' && /text\/html/i.test(contentType);
      if (!shouldInject) {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
        return;
      }
      const chunks = []; let count = 0;
      upstreamResponse.on('data', chunk => {
        count += chunk.length;
        if (count > 4 * 1024 * 1024) { upstreamResponse.destroy(); return; }
        chunks.push(chunk);
      });
      upstreamResponse.on('end', () => {
        let content = Buffer.concat(chunks);
        const encoding = String(upstreamResponse.headers['content-encoding'] || '').toLowerCase();
        try {
          if (encoding === 'gzip') content = gunzipSync(content);
          else if (encoding === 'deflate') content = inflateSync(content);
          else if (encoding === 'br') content = brotliDecompressSync(content);
          else if (encoding && encoding !== 'identity') throw Error('Unsupported encoding');
        } catch {
          json(res, 502, { error: 'Cannot decode Configurator HTML' });
          return;
        }
        let html = content.toString('utf8');
        const assets = '<script defer src="/rtsp-addon/editor.js"></script>'; // CSS loads only inside Shadow DOM
        if (html.match(/<\/head\s*>/i)) html = html.replace(/<\/head\s*>/i, assets + '</head>');
        else if (html.match(/<body(?:\s|>)/i)) html = html.replace(/<body(?:\s|>)/i, assets + '$&');
        else { json(res, 502, { error: 'Cannot inject Configurator resources into HTML' }); return; }
        const responseHeaders = { ...upstreamResponse.headers, 'cache-control': 'no-store' };
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        delete responseHeaders.etag;
        // All injected assets are served from the same origin and avoid inline code.
        res.writeHead(upstreamResponse.statusCode || 200, responseHeaders);
        res.end(html);
      });
      upstreamResponse.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Configurator upstream failure' }); else res.destroy(); });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Upstream unavailable' }); else res.destroy(); });
    req.pipe(upstream);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (nativeExists && path === '/configurator') {
      res.writeHead(302, { Location: '/configurator/' }); res.end(); return;
    }
    if (sendNativeFile(req, res, path)) return;
    // Only the host's Web Configurator HTML gets the extension. REST, WS,
    // images, icons, authentication endpoints etc. are forwarded unchanged.
    if (path === '/rtsp-addon/editor.js' || path === '/rtsp-addon/editor.css') {
      const name = path.endsWith('.js') ? 'editor.js' : 'editor.css';
      const file = join(here, 'public', name);
      const info = statSync(file);
      res.writeHead(200, {
        'Content-Type': name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
      });
      createReadStream(file).pipe(res);
      return;
    }
    if (path === '/rtsp-addon/health') { json(res, 200, { ok: true }); return; }
    const isApi = path.startsWith('/rtsp-addon/api/') || path.startsWith('/rtsp-addon/media/');
    if (isApi) {
      const isMedia = path.startsWith('/rtsp-addon/media/');
      const targetPath = isMedia ? path.slice('/rtsp-addon/media'.length) : path.slice('/rtsp-addon'.length);
      // Prevent access to the standalone admin UI or arbitrary sidecar endpoints.
      const allow = isMedia
        ? req.method === 'GET' && /^\/mjpeg\/[a-f0-9-]{36}$/.test(targetPath)
        : /^\/api\/(?:core\/activities(?:\/[\w.:-]+\/pages)?|widgets(?:\/[a-f0-9-]{36}(?:\/(?:stop|restart))?)?|activities\/[\w.:-]+\/pages\/[\w.:-]+\/widgets)$/.test(targetPath);
      if (!allow) { json(res, 404, { error: 'Endpoint not available' }); return; }
      if (!isMedia && !['GET','POST','PUT','DELETE'].includes(req.method)) { json(res, 405, { error: 'Method not allowed' }); return; }
      if (!isMedia && req.method !== 'GET') {
        const canCreate = req.method === 'POST' && targetPath === '/api/widgets';
        const canUpdate = ['PUT','DELETE'].includes(req.method) && /^\/api\/widgets\/[a-f0-9-]{36}$/.test(targetPath);
        const canAction = req.method === 'POST' && /^\/api\/widgets\/[a-f0-9-]{36}\/(?:restart|stop)$/.test(targetPath);
        if (!canCreate && !canUpdate && !canAction) { json(res, 405, { error: 'Method not allowed' }); return; }
      }
      if (req.method !== 'GET' && (!sameOrigin(req) || req.headers['x-rtsp-configurator'] !== '1' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) {
        json(res, 403, { error: 'Same-origin JSON request required' }); return;
      }
      // Query-less API endpoint aliases. Avoid arbitrary query passthrough.
      if (url.search) { json(res, 400, { error: 'Unexpected query string' }); return; }
      let ok = false;
      try { ok = await authenticated(req); }
      catch { json(res, 502, { error: 'Core login session could not be verified' }); return; }
      if (!ok) { json(res, 401, { error: 'Sign in to the Web Configurator first' }); return; }
      requestUpstream(req, res, rtsp, targetPath, { admin: true });
      return;
    }
    if (path.startsWith('/rtsp-addon/')) { json(res, 404, { error: 'Not found' }); return; }
    requestUpstream(req, res, core, url.pathname + url.search, { inject: path.startsWith('/configurator') });
  });

  // WebSockets are used by the stock Configurator and by clients that connect
  // to this same-origin front end. Pass them through untouched to Core.
  server.on('upgrade', (req, client, head) => {
    if (!req.url.startsWith('/ws')) { client.destroy(); return; }
    const upstream = net.connect(Number(core.port || 80), core.hostname, () => {
      const headers = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        if (key.toLowerCase() === 'host') headers.push(key + ': ' + (req.headers.host || core.host));
        else headers.push(key + ': ' + req.rawHeaders[i + 1]);
      }
      upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + headers.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer({
    coreUrl: process.env.CONFIGURATOR_CORE_URL || 'http://core-simulator:8080',
    rtspUrl: process.env.CONFIGURATOR_RTSP_URL || 'http://rtsp-widget:8091',
    rtspPassword: process.env.RTSP_WIDGET_PASSWORD
  }).listen(Number(process.env.RTSP_CONFIGURATOR_PORT || 8081), '0.0.0.0', () => {
    console.log('Integrated Web Configurator available on port ' + (process.env.RTSP_CONFIGURATOR_PORT || 8081));
  });
}
