import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'rtsp-picker-test-'));
const pin = 'local-test-pin';
const auth = { Authorization: 'Basic ' + Buffer.from('admin:a-long-test-secret').toString('base64') };
const core = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('web-configurator:' + pin).toString('base64')) {
    res.writeHead(401); res.end(); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.startsWith('/api/activities?')) {
    res.setHeader('Pagination-Count', '2');
    res.end(JSON.stringify([
      { entity_id: 'uc.main.activity.tv', name: { en: 'Watch TV', de: 'Fernsehen' } },
      { entity_id: 'uc.main.activity.music', name: { de: 'Musik' } }
    ]));
  } else if (req.url === '/api/activities/uc.main.activity.tv/ui/pages') {
    res.end(JSON.stringify([
      { page_id: 'page-one', name: 'Media', grid: { width: 4, height: 6 }, items: [] },
      { page_id: 'page-two', grid: { width: 3, height: 4 }, items: [] }
    ]));
  } else { res.writeHead(404); res.end('{}'); }
});
await new Promise(resolve => core.listen(0, '127.0.0.1', resolve));
const coreUrl = 'http://127.0.0.1:' + core.address().port;
const stub = { status: () => ({ state: 'idle' }), stop: () => {}, start: () => {}, close: () => {} };
const { server } = createApp({ password: 'a-long-test-secret', databasePath: join(dir, 'db.json'),
  managerFactory: () => stub, coreApiUrl: coreUrl, corePassword: pin });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => core.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('Core discovery endpoints are protected by RTSP widget authentication', async () => {
  assert.equal((await fetch(url + '/api/core/activities')).status, 401);
  assert.equal((await fetch(url + '/api/core/activities/uc.main.activity.tv/pages')).status, 401);
});
test('activity picker lists names without exposing Core credentials', async () => {
  const response = await fetch(url + '/api/core/activities', { headers: auth });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), [
    { id: 'uc.main.activity.tv', name: 'Watch TV' },
    { id: 'uc.main.activity.music', name: 'Musik' }
  ]);
  assert.equal(body.includes(pin), false);
});
test('page picker supplies actual IDs and grid dimensions', async () => {
  const response = await fetch(url + '/api/core/activities/uc.main.activity.tv/pages', { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { id: 'page-one', name: 'Media', grid: { width: 4, height: 6 } },
    { id: 'page-two', name: 'Page 2', grid: { width: 3, height: 4 } }
  ]);
});
test('rejects invalid activity ID and avoids passing arbitrary route through to Core', async () => {
  const response = await fetch(url + '/api/core/activities/%2e%2e%2fprivate/pages', { headers: auth });
  assert.equal(response.status, 400);
});
test('Core connection failure does not affect manual widget creation', async () => {
  const response = await fetch(url + '/api/widgets', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Manual camera', url: 'rtsp://camera.local/live', activity_id: 'manual', page_id: 'page' }) });
  assert.equal(response.status, 201);
});
