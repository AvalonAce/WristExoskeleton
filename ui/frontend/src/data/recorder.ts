// Rosbag recording through the storage server (ui/backend/server.py). Demo mode: does nothing.
import type { Recorder } from './types';

export class ServerRecorder implements Recorder {
  readonly available = true;

  async start(name: string) {
    const r = await fetch('/api/bag/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `bag start failed (${r.status})`);
    return (j.name as string) ?? name;
  }

  async stop() {
    await fetch('/api/bag/stop', { method: 'POST' }).catch(() => undefined);
  }
}

export class NoRecorder implements Recorder {
  readonly available = false;
  async start() { return null; }
  async stop() {}
}
