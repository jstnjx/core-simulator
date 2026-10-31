import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const nativeDirectory = mkdtempSync(join(tmpdir(), 'uc-native-rtsp-test-'));
mkdirSync(join(nativeDirectory, 'assets', 'js'), { recursive: true });
writeFileSync(join(nativeDirectory, 'index.html'), '<!doctype html><html><body><div id="app">Native Video Stream</div></body></html>');
writeFileSync(join(nativeDirectory, 'assets', 'js', 'test.js'), 'console.log("native widget loaded");');
const proxy = createServer({ coreUrl: coreBase, rtspUrl: sidecarBase,
  rtspPassword: 'server-only-secret', nativeDirectory });
const url = await start(proxy);
after(async () => {
  await Promise.all([core, sidecar, proxy].map(s => new Promise(resolve => s.close(resolve))));
  rmSync(nativeDirectory, { recursive: true, force: true });
});

test('the actual native Vue app is served on the integrated Configurator path', async () => {
  const redirect = await fetch(url + '/configurator', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/configurator/');
  const response = await fetch(url + '/configurator/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Native Video Stream/);
  assert.doesNotMatch(html, /rtsp-addon\/editor\.js/);
  const asset = await fetch(url + '/configurator/assets/js/test.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /native widget loaded/);
});

test('legacy injected JS and CSS are gone and Core API remains intact', async () => {
  assert.deepEqual(await (await fetch(url + '/api/whatever')).json(), { core: true });
  assert.equal((await fetch(url + '/rtsp-addon/editor.js')).status, 404);
  assert.equal((await fetch(url + '/rtsp-addon/editor.css')).status, 404);
  assert.equal((await fetch(url + '/configurator/assets/js/not-found.js')).status, 404);
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

test('live Video Stream grid previews require a Core session and use the restricted media proxy', async () => {
  const camera = '00000000-0000-4000-8000-000000000001';
  const path = '/rtsp-addon/media/mjpeg/' + camera;
  assert.equal((await fetch(url + path)).status, 401);
  const ok = await fetch(url + path, { headers: { Cookie: 'session=valid' } });
  assert.equal(ok.status, 200);
  assert.equal(upstreamAuthorization, 'Basic ' + Buffer.from('admin:server-only-secret').toString('base64'));
  assert.equal((await fetch(url + '/rtsp-addon/media/mjpeg/invalid',
    { headers: { Cookie: 'session=valid' } })).status, 404);
});
