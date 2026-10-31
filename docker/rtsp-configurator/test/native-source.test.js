import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = file => readFileSync(join(root, file), 'utf8');

test('Video Stream is compiled into the native Vue add/edit/grid pipeline', () => {
  const patch = source('native/patch-web-configurator.mjs');
  assert.match(patch, /src\/composables\/components\.ts/);
  assert.match(patch, /src\/components\/elements\/widget\/AddWidget\.vue/);
  assert.match(patch, /src\/components\/ui\/GridItemEdit\.vue/);
  assert.match(patch, /src\/components\/activity\/ActivityRemote\.vue/);
  assert.match(patch, /src\/types\/activity\.ts/);
  assert.match(patch, /video_stream/);
  assert.match(patch, /persistVideoStreams/);
});
test('stream metadata is saved in RTSP sidecar, not serialized to Core', () => {
  const adapter = source('native/videoStreams.ts');
  assert.match(adapter, /item\.type !== "video_stream"/);
  assert.match(adapter, /"\/widgets"/);
  assert.match(adapter, /withVideoStreams/);
  assert.match(adapter, /Cannot copy Video Stream credentials/);
});
test('native preview uses the authenticated same-origin media API', () => {
  const component = source('native/ComponentButtonVideo.vue');
  assert.match(component, /rtsp-addon\/media\/mjpeg/);
  assert.match(component, /getComponentClasses/);
  assert.doesNotMatch(component, /view_token=|RTSP_WIDGET_PASSWORD/);
});
test('Docker builds the GPL frontend from the published 2.3.3 Vue sources', () => {
  const dockerfile = source('Dockerfile');
  assert.match(dockerfile, /WEB_CONFIGURATOR_SOURCE_URL/);
  assert.match(dockerfile, /patch-web-configurator\.mjs/);
  assert.match(dockerfile, /npm run type-check/);
  assert.match(dockerfile, /npm run build-only/);
  assert.doesNotMatch(dockerfile, /COPY public\//);
});
