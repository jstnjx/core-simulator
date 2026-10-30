import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'rtsp-viewer-test-'));
const viewToken = 'read-only-long-view-token';
const manager = { status: () => ({ state: 'idle' }), stop: () => {}, start: () => {}, close: () => {},
  snapshot: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mjpeg: () => false };
const { server } = createApp({ password: 'simulator-admin-secret', viewToken,
  databasePath: join(dir, 'db.json'), managerFactory: () => manager });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const viewer = { Authorization: 'Bearer ' + viewToken };
const admin = { Authorization: 'Basic ' + Buffer.from('admin:simulator-admin-secret').toString('base64'),
  'Content-Type': 'application/json' };
after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
let id;
test('viewer token cannot manage cameras or access administrator API', async () => {
  assert.equal((await fetch(base + '/api/widgets', { headers: viewer })).status, 401);
  assert.equal((await fetch(base + '/', { headers: viewer })).status, 401);
  assert.equal((await fetch(base + '/api/core/activities', { headers: viewer })).status, 401);
});
test('admin can save widget and viewer can list only scoped placements', async () => {
  const res = await fetch(base + '/api/widgets', { method: 'POST', headers: admin,
    body: JSON.stringify({ name: 'Front door', url: 'rtsp://user:pass@camera.local/live',
      activity_id: 'uc.main.activity.tv', page_id: 'page-1' }) });
  assert.equal(res.status, 201);
  id = (await res.json()).id;
  const rows = await fetch(base + '/api/activities/uc.main.activity.tv/pages/page-1/widgets', { headers: viewer });
  assert.equal(rows.status, 200);
  const contents = await rows.text();
  assert.equal(contents.includes('rtsp://user:pass'), false);
  assert.equal(JSON.parse(contents).length, 1);
  assert.equal((await fetch(base + '/api/activities/uc.main.activity.tv/pages/else/widgets', { headers: viewer })).status, 200);
});
test('snapshot URI requires viewer token and serves shared JPEG frame', async () => {
  assert.equal((await fetch(base + '/snapshot/' + id + '.jpg')).status, 401);
  const res = await fetch(base + '/snapshot/' + id + '.jpg?view_token=' + viewToken);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal((await res.arrayBuffer()).byteLength, 4);
});
test('incorrect tokens do not access streams', async () => {
  assert.equal((await fetch(base + '/snapshot/' + id + '.jpg?view_token=wrong')).status, 401);
  assert.equal((await fetch(base + '/api/widgets/' + id, { headers: viewer })).status, 401);
});

test('native simulator can authenticate MJPEG with Authorization header instead of a URL token', async () => {
  const allowed = await fetch(base + '/mjpeg/' + id, { headers: viewer });
  assert.equal(allowed.status, 503);
  assert.equal((await fetch(base + '/mjpeg/' + id)).status, 401);
  assert.equal((await fetch(base + '/mjpeg/' + id, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
});
