// Fake raw sensor topics derived from the mock WristState stream, so the sensor test page can
// be designed without hardware. Hand gyro x carries the wrist velocity; accel tilts with angle.
import type { ExoStream, ImuName, ImuSample, RawFeed, EmgBatchSample, ConnectionState } from './types';

const G = 9.81;
const n = (sd: number) => sd * (Math.random() + Math.random() + Math.random() - 1.5) * 1.41;

export class MockRawFeed implements RawFeed {
  readonly label = 'Demo data';
  constructor(private stream: ExoStream) {}

  get connection(): ConnectionState {
    return this.stream.connection;
  }

  onConnection(cb: (c: ConnectionState) => void) {
    return this.stream.onConnection(cb);
  }

  onImu(which: ImuName, cb: (s: ImuSample) => void) {
    return this.stream.subscribe((w) => {
      const a = which === 'hand' && Number.isFinite(w.angle_deg) ? (w.angle_deg * Math.PI) / 180 : 0;
      const gx = which === 'hand' ? (w.velocity_dps * Math.PI) / 180 : 0;
      cb({
        t: w.t,
        ax: n(0.05), ay: G * Math.sin(a) + n(0.05), az: G * Math.cos(a) + n(0.05),
        gx: gx + n(0.02), gy: n(0.02), gz: n(0.02),
      });
    });
  }

  onEmg(cb: (s: EmgBatchSample) => void) {
    return this.stream.subscribe((w) => {
      const batch = (env: number) => Array.from({ length: 10 }, () => Math.round(env + n(env * 0.08)));
      cb({ t: w.t, rate: 1000, flexor: batch(w.emg_flex), extensor: batch(w.emg_ext) });
    });
  }
}
