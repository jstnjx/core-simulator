import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';

const start = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
};
let upstreamAuthorization;
const core = http.createServer((req, res) => {
  if (req.url.startsWith('/api/activities')) {
    res.writeHead(req.headers.cookie === 'session=valid' ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end('[]');
  } else if (req.url.startsWith('/configurator')) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 65 });
    res.end('<!DOCTYPE html><html><head></head><body>Hello there</body></html>');
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"core":true}');
  }
});
const sidecar = http.createServer((req, res) => {
  upstreamAuthorization = req.headers.authorization;
  const body = req.method === 'POST' ? '{"id":"created"}' : '[]';
  res.writeHead(req.headers.authorization === 'Basic ' + Buffer.from('admin:server-only-secret').toString('base64') ? 200 : 401,
    { 'Content-Type': 'application/json' });
  res.end(body);
});
const coreBase = await start(core);
const sidecarBase = await start(sidecar);
const proxy = createServer({ coreUrl: coreBase, rtspUrl: sidecarBase, rtspPassword: 'server-only-secret' });
const url = await start(proxy);
after(async () => { await Promise.all([core, sidecar, proxy].map(s => new Promise(resolve => s.close(resolve)))); });

test('stock Configurator HTML gets an injected extension script', async () => {
  const response = await fetch(url + '/configurator');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\/rtsp-addon\/editor\.js/);
  assert.doesNotMatch(html, /rel="stylesheet" href="\/rtsp-addon\/editor\.css/);
  assert.match(html, /Hello there/);
});
test('unmodified Core APIs and static injected UI are served', async () => {
  assert.deepEqual(await (await fetch(url + '/api/whatever')).json(), { core: true });
  const js = await fetch(url + '/rtsp-addon/editor.js');
  assert.equal(js.status, 200);
  const script = await js.text();
  assert.match(script, /Video Stream/);
  assert.doesNotMatch(script, /RTSP Camera Widgets|id="rtsp-launch"|id="rtsp-shade"/);
  assert.match(script, /findPalette/);
  assert.match(script, /findGrid/);
  assert.match(script, /application\/x-uc-video-stream/);
  assert.doesNotThrow(() => new Function(script));
  const css = await fetch(url + '/rtsp-addon/editor.css');
  assert.equal(css.status, 200);
  assert.match(await css.text(), /video-stream-panel/);
});
test('sidecar APIs reject users not logged into Core', async () => {
  const resp = await fetch(url + '/rtsp-addon/api/widgets');
  assert.equal(resp.status, 401);
  assert.equal(upstreamAuthorization, undefined);
});
test('authenticated browser can list and edit without receiving admin secret', async () => {
  const response = await fetch(url + '/rtsp-addon/api/widgets', { headers: { Cookie: 'session=valid' } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '[]');
  assert.equal(upstreamAuthorization, 'Basic ' + Buffer.from('admin:server-only-secret').toString('base64'));
  const made = await fetch(url + '/rtsp-addon/api/widgets', {
    method: 'POST', headers: { Cookie: 'session=valid', 'Content-Type': 'application/json',
      Origin: url, 'X-RTSP-Configurator': '1' }, body: '{}' });
  assert.equal(made.status, 200);
  assert.deepEqual(await made.json(), { id: 'created' });
});
test('cross-site, missing CSRF header and arbitrary sidecar paths are blocked', async () => {
  const base = { Cookie: 'session=valid', 'Content-Type': 'application/json', 'X-RTSP-Configurator': '1' };
  assert.equal((await fetch(url + '/rtsp-addon/api/widgets', { method: 'POST', headers: { ...base, Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/rtsp-addon/api/widgets', { method: 'POST', headers: { Cookie: 'session=valid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/rtsp-addon/api/core/activities', { method: 'POST', headers: base, body: '{}' })).status, 405);
  assert.equal((await fetch(url + '/rtsp-addon/api/health', { headers: { Cookie: 'session=valid' } })).status, 404);
  assert.equal((await fetch(url + '/rtsp-addon/api/widgets?unexpected=1', { headers: { Cookie: 'session=valid' } })).status, 400);
});

test('the Video Stream extension never modifies the Core activity API payload', async () => {
  const response = await fetch(url + '/api/activities?limit=1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});
