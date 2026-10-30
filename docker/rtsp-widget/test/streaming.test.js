import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { StreamManager } from '../streams.js';

function decoder(outputsFrame = true) {
  const argsList = [];
  const children = [];
  const manager = new StreamManager({
    getWidget: () => ({ id: '2cd49fae-9722-4d62-81aa-54e6dcf4453f', enabled: true,
      url: 'rtsp://test.invalid/live', width: 640, fps: 24 }),
    spawnProcess: (_cmd, args) => {
      argsList.push(args);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { child.emit('exit', 0); return true; };
      children.push(child);
      if (outputsFrame) setTimeout(() => {
        // Minimal JPEG byte stream, sufficient to test framing / cold start.
        child.stdout.emit('data', Buffer.from([0xff,0xd8,1,2,3]));
        child.stdout.emit('data', Buffer.from([4,5,0xff,0xd9]));
      }, 55).unref();
      return child;
    }
  });
  return { manager, argsList, children };
}

const id = '2cd49fae-9722-4d62-81aa-54e6dcf4453f';
test('snapshot waits for first completed frame rather than returning 503', async () => {
  const { manager, argsList } = decoder();
  try {
    const frame = await manager.snapshotReady(id, 1500);
    assert.deepEqual(frame, Buffer.from([0xff,0xd8,1,2,3,4,5,0xff,0xd9]));
    assert.equal(manager.snapshot(id)?.equals(frame), true);
    assert.equal(argsList.length, 1, 'decoder shared across requests');
    assert.ok(argsList[0].includes('fps=15,scale=640:-2'));
  } finally { manager.close(); }
});
test('snapshot cold-start timeout returns null without creating duplicate decoders', async () => {
  const { manager, argsList } = decoder(false);
  try {
    assert.equal(await manager.snapshotReady(id, 100), null);
    assert.equal(argsList.length, 1);
  } finally { manager.close(); }
});
test('HLS output targets one-second segments at configured FPS', () => {
  const { manager, argsList } = decoder(false);
  try {
    manager.start(id);
    const args = argsList[0];
    assert.equal(args[args.indexOf('-hls_time') + 1], '1');
    assert.equal(args[args.indexOf('-g') + 1], '24');
    assert.equal(args[args.indexOf('-hls_list_size') + 1], '6');
  } finally { manager.close(); }
});
