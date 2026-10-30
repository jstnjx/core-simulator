import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeId = id => /^[a-f0-9-]{36}$/.test(id);

export class StreamManager {
  constructor({ getWidget, spawnProcess = spawn, idleMs = 90000, ffmpeg = 'ffmpeg' }) {
    this.getWidget = getWidget;
    this.spawnProcess = spawnProcess;
    this.idleMs = idleMs;
    this.ffmpeg = ffmpeg;
    this.sessions = new Map();
    this.activeMjpeg = new Set();
    this.snapshots = new Map();
    this.sweeper = setInterval(() => this.reap(), 15000);
    this.sweeper.unref?.();
  }

  start(id) {
    if (!safeId(id)) return null;
    const config = this.getWidget(id);
    if (!config || !config.enabled) return null;
    const old = this.sessions.get(id);
    if (old && old.process && !old.process.killed && !old.exited) {
      old.lastSeen = Date.now();
      return old;
    }
    if (old) this.stop(id);
    const directory = mkdtempSync(join(tmpdir(), 'uc-rtsp-'));
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-rtsp_transport', 'tcp', '-timeout', '5000000',
      '-i', config.url, '-map', '0:v:0', '-an',
      '-vf', 'fps=' + config.fps + ',scale=' + config.width + ':-2:flags=fast_bilinear',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p', '-g', String(config.fps * 2), '-sc_threshold', '0',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '5',
      '-hls_start_number_source', 'epoch',
      '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
      '-hls_segment_filename', join(directory, 'segment-%d.ts'),
      join(directory, 'index.m3u8')
    ];
    const child = this.spawnProcess(this.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const session = { directory, process: child, lastSeen: Date.now(), started: Date.now(), exited: false, error: '' };
    this.sessions.set(id, session);
    child.stderr.on('data', chunk => {
      // Never return camera URLs or credentials from FFmpeg stderr.
      session.error = /unauthorized|401/i.test(chunk.toString()) ? 'Camera authorization failed' : 'Stream unavailable or incompatible';
    });
    child.on('error', () => { session.error = 'FFmpeg could not start'; session.exited = true; });
    child.on('exit', () => { session.exited = true; });
    return session;
  }

  async playlist(id, timeout = 12000) {
    const session = this.start(id);
    if (!session) return null;
    const filename = join(session.directory, 'index.m3u8');
    const deadline = Date.now() + timeout;
    while (!existsSync(filename) && Date.now() < deadline) {
      if (session.exited) break;
      await sleep(150);
    }
    return existsSync(filename) ? filename : null;
  }

  segment(id, filename) {
    const session = this.sessions.get(id);
    if (!session || !/^segment-[0-9]+\.ts$/.test(filename)) return null;
    session.lastSeen = Date.now();
    const path = join(session.directory, filename);
    return existsSync(path) ? path : null;
  }

  status(id) {
    const s = this.sessions.get(id);
    return !s ? { state: 'idle' } : {
      state: s.exited ? 'offline' : 'running',
      started: new Date(s.started).toISOString(),
      error: s.error || null
    };
  }

  mjpeg(id, res) {
    const config = this.getWidget(id);
    if (!config || !config.enabled || !safeId(id) || this.activeMjpeg.size >= 4) return false;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-rtsp_transport', 'tcp', '-timeout', '5000000', '-i', config.url,
      '-map', '0:v:0', '-an',
      '-vf', 'fps=' + Math.min(10, config.fps) + ',scale=' + config.width + ':-2',
      '-q:v', '7', '-f', 'mpjpeg', '-boundary_tag', 'ucframe', 'pipe:1'
    ];
    const child = this.spawnProcess(this.ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    this.activeMjpeg.add(child);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=ucframe', 'Cache-Control': 'no-store' });
    child.stdout.pipe(res);
    const end = () => { this.activeMjpeg.delete(child); child.kill('SIGTERM'); child.stdout.unpipe(res); };
    res.once('close', end);
    child.once('error', () => { this.activeMjpeg.delete(child); res.end(); });
    child.once('exit', () => { this.activeMjpeg.delete(child); res.end(); });
    return true;
  }

  // Shared, low-framerate JPEG decoder for desktop Qt builds where QtMultimedia HLS
  // is unavailable. A single FFmpeg process serves all viewers of one camera.
  snapshot(id) {
    if (!safeId(id)) return null;
    const cfg = this.getWidget(id);
    if (!cfg || !cfg.enabled) return null;
    let session = this.snapshots.get(id);
    if (session?.exited) { this.stopSnapshot(id); session = null; }
    if (!session) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-rtsp_transport', 'tcp', '-timeout', '5000000', '-i', cfg.url,
        '-map', '0:v:0', '-an',
        '-vf', 'fps=' + Math.min(cfg.fps, 6) + ',scale=' + cfg.width + ':-2',
        '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '7', 'pipe:1'
      ];
      const process = this.spawnProcess(this.ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      session = { process, frame: null, pending: Buffer.alloc(0), lastSeen: Date.now(), exited: false };
      this.snapshots.set(id, session);
      const current = session;
      process.stdout.on('data', chunk => {
        current.pending = Buffer.concat([current.pending, chunk]);
        // FFmpeg emits individual JPEGs with SOI FFD8 and EOI FFD9 markers.
        // Bound the buffer to avoid unchecked memory growth on corrupt input.
        while (current.pending.length > 3) {
          const start = current.pending.indexOf(Buffer.from([0xff, 0xd8]));
          if (start < 0) { current.pending = Buffer.alloc(0); break; }
          if (start) current.pending = current.pending.subarray(start);
          const end = current.pending.indexOf(Buffer.from([0xff, 0xd9]), 2);
          if (end < 0) break;
          current.frame = Buffer.from(current.pending.subarray(0, end + 2));
          current.pending = current.pending.subarray(end + 2);
        }
        if (current.pending.length > 2 * 1024 * 1024) current.pending = Buffer.alloc(0);
      });
      process.on('exit', () => { current.exited = true; });
      process.on('error', () => { current.exited = true; });
    }
    session.lastSeen = Date.now();
    return session.frame;
  }

  stopSnapshot(id) {
    const session = this.snapshots.get(id);
    if (!session) return;
    this.snapshots.delete(id);
    session.process.kill('SIGTERM');
  }

  stop(id) {
    const session = this.sessions.get(id);
    this.stopSnapshot(id);
    if (!session) return;
    this.sessions.delete(id);
    session.process.kill('SIGTERM');
    const cleanup = setTimeout(() => rmSync(session.directory, { recursive: true, force: true }), 2000);
    cleanup.unref?.();
  }

  reap() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.exited || now - s.lastSeen > this.idleMs) this.stop(id);
    }
    for (const [id, s] of this.snapshots) {
      if (s.exited || now - s.lastSeen > this.idleMs) this.stopSnapshot(id);
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const id of this.sessions.keys()) this.stop(id);
    for (const id of this.snapshots.keys()) this.stopSnapshot(id);
    for (const child of this.activeMjpeg) child.kill('SIGTERM');
    this.activeMjpeg.clear();
  }
}
