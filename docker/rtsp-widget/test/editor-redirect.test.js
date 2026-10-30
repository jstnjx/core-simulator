import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'rtsp-redirect-test-'));
const stub = { status: () => ({ state: 'idle' }), stop: () => {}, start: () => {}, close: () => {} };
const { server } = createApp({
  password: 'long-admin-password',
  databasePath: join(dir, 'widgets.json'),
  managerFactory: () => stub,
  editorRedirect: 'http://localhost:8081/configurator'
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
after(async () => {
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('old editor redirects to the stock integrated Configurator without an RTSP login prompt', async () => {
  for (const path of ['/', '/index.html']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:8081/configurator');
  }
});
test('redirect leaves the health check and RTSP API authentication unchanged', async () => {
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/widgets')).status, 401);
});
test('malformed redirect configurations are rejected', () => {
  assert.throws(() => createApp({
    password: 'long-admin-password', databasePath: join(dir, 'other.json'),
    managerFactory: () => stub, editorRedirect: 'javascript:alert(1)'
  }), /RTSP_WIDGET_EDITOR_REDIRECT/);
});
