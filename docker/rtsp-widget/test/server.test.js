import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'rtsp-server-test-'));
const stub = { status: () => ({ state: 'idle' }), stop: () => {}, start: () => {}, close: () => {} };
const { server } = createApp({ password: 'a-long-test-secret', databasePath: join(dir, 'db.json'), managerFactory: () => stub });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const auth = { Authorization: 'Basic ' + Buffer.from('admin:a-long-test-secret').toString('base64'), 'Content-Type': 'application/json' };
const request = (path, { method = 'GET', data, headers = auth } = {}) =>
  fetch(base + path, { method, headers, body: data && JSON.stringify(data) });
after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });

const widget = {
  name: 'Porch', url: 'rtsp://user:supersecret@192.168.1.5:554/live',
  activity_id: 'uc.main.activity.tv', page_id: 'abc',
  grid: { width: 4, height: 6 }, location: { x: 0, y: 1 }, size: { width: 4, height: 2 },
  fps: 12, width: 640, mode: 'hls'
};
let id;
test('health endpoint is public but widget endpoints require authentication', async () => {
  assert.equal((await request('/health', { headers: {} })).status, 200);
  assert.equal((await request('/api/widgets', { headers: {} })).status, 401);
  assert.equal((await request('/api/widgets', { headers: { Authorization: 'Basic YWRtaW46d3Jvbmc=' } })).status, 401);
});
test('create widget without exposing RTSP credentials', async () => {
  const res = await request('/api/widgets', { method: 'POST', data: widget });
  assert.equal(res.status, 201);
  const item = await res.json(); id = item.id;
  assert.match(item.id, /^[a-f0-9-]{36}$/);
  assert.equal(item.source, 'rtsp://192.168.1.5:554');
  assert.equal(JSON.stringify(item).includes('supersecret'), false);
  assert.equal(JSON.stringify(await (await request('/api/widgets')).json()).includes('supersecret'), false);
});
test('grid validation rejects widgets outside activity page', async () => {
  const res = await request('/api/widgets', { method: 'POST', data: { ...widget, location: { x: 3, y: 0 } } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /exceeds activity grid/);
});
test('invalid source schemes are rejected', async () => {
  assert.equal((await request('/api/widgets', { method: 'POST', data: { ...widget, url: 'file:///etc/passwd' } })).status, 400);
});
test('edit preserves source credentials, and activity scoped lookup works', async () => {
  const update = { ...widget, name: 'Front door', url: undefined, location: { x: 2, y: 0 }, size: { width: 2, height: 2 } };
  const res = await request('/api/widgets/' + id, { method: 'PUT', data: update });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'Front door');
  const rows = await (await request('/api/activities/uc.main.activity.tv/pages/abc/widgets')).json();
  assert.equal(rows.length, 1); assert.equal(rows[0].location.x, 2);
});
test('embedded player contains no camera secret; delete works', async () => {
  const response = await request('/embed/' + id);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('supersecret'), false);
  assert.equal((await request('/api/widgets/' + id, { method: 'DELETE' })).status, 204);
  assert.equal((await request('/api/widgets/' + id)).status, 404);
});
