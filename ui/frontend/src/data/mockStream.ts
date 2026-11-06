// Fake 100 Hz WristState that looks like a real session: rest, flexion rep, rest, extension rep.
// EMG bursts start ~120 ms before movement (the onset lead the project measures).
import { Phase, type ConnectionState, type ExoStream, type WristState } from './types';

const DT = 0.01; // 100 Hz
const EMG_BASE = 300; // resting envelope, ADC counts
const EMG_SIGMA = 15;
const K = 5; // threshold = base + K * sigma
const EMG_LEAD = 0.12; // s, EMG onset before movement

interface Segment {
  phase: Phase;
  dur: number; // s
  to: number; // angle at end of segment, deg
  muscle: 'flex' | 'ext' | null; // which muscle is active
  level: number; // envelope above baseline at full activation
}

// One cycle: 2 s rest, flex rep, rest, ext rep. ONSET is short: EMG active, no motion yet.
const CYCLE: Segment[] = [
  { phase: Phase.REST, dur: 2.0, to: 0, muscle: null, level: 0 },
  { phase: Phase.ONSET, dur: EMG_LEAD, to: 0, muscle: 'flex', level: 250 },
  { phase: Phase.FLEX, dur: 1.0, to: 45, muscle: 'flex', level: 600 },
  { phase: Phase.HOLD, dur: 1.5, to: 45, muscle: 'flex', level: 450 },
  { phase: Phase.RETURN, dur: 1.0, to: 0, muscle: 'flex', level: 200 },
  { phase: Phase.REST, dur: 2.0, to: 0, muscle: null, level: 0 },
  { phase: Phase.ONSET, dur: EMG_LEAD, to: 0, muscle: 'ext', level: 250 },
  { phase: Phase.EXT, dur: 1.0, to: -35, muscle: 'ext', level: 550 },
  { phase: Phase.HOLD, dur: 1.5, to: -35, muscle: 'ext', level: 400 },
  { phase: Phase.RETURN, dur: 1.0, to: 0, muscle: 'ext', level: 180 },
];
const CYCLE_LEN = CYCLE.reduce((s, x) => s + x.dur, 0);

function gauss(): number {
  // Box-Muller, good enough for display noise.
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Smooth 0->1 ramp (cosine), so angle and velocity have no corners. */
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

export class MockStream implements ExoStream {
  private subs = new Set<(s: WristState) => void>();
  private connSubs = new Set<(c: ConnectionState) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting: ReturnType<typeof setTimeout> | null = null; // pending connect delay
  private simT = 0; // simulated time since start, s
  private t0 = Date.now() / 1000; // stamp of simT = 0
  private lastAngle = 0;
  private envFlex = EMG_BASE;
  private envExt = EMG_BASE;
  connection: ConnectionState = 'disconnected';

  subscribe(cb: (s: WristState) => void): () => void {
    this.subs.add(cb);
    this.ensureRunning();
    return () => {
      this.subs.delete(cb);
      if (this.subs.size === 0) this.halt();
    };
  }

  onConnection(cb: (c: ConnectionState) => void): () => void {
    this.connSubs.add(cb);
    cb(this.connection);
    return () => this.connSubs.delete(cb);
  }

  private setConn(c: ConnectionState) {
    this.connection = c;
    this.connSubs.forEach((cb) => cb(c));
  }

  private ensureRunning() {
    if (this.timer || this.starting) return;
    this.setConn('connecting');
    // Fake a short connect delay so the UI's "connecting" state can be designed too.
    this.starting = setTimeout(() => {
      this.starting = null;
      if (this.subs.size === 0) return;
      this.t0 = Date.now() / 1000 - this.simT;
      this.setConn('connected');
      // Browsers fire setInterval(10) a little late; emit as many samples as wall time requires.
      let wall = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now();
        while (wall + DT * 1000 <= now) {
          wall += DT * 1000;
          this.emit(this.step());
        }
      }, 10);
    }, 400);
  }

  private halt() {
    if (this.timer) clearInterval(this.timer);
    if (this.starting) clearTimeout(this.starting);
    this.timer = null;
    this.starting = null;
    this.setConn('disconnected');
  }

  private emit(s: WristState) {
    this.subs.forEach((cb) => cb(s));
  }

  private step(): WristState {
    this.simT += DT;
    // Locate the current segment within the repeating cycle.
    let tc = this.simT % CYCLE_LEN;
    let i = 0;
    while (tc >= CYCLE[i].dur) {
      tc -= CYCLE[i].dur;
      i++;
    }
    const seg = CYCLE[i];
    const prevTo = i === 0 ? CYCLE[CYCLE.length - 1].to : CYCLE[i - 1].to;
    const frac = tc / seg.dur;

    // Differentiate the clean angle, then add noise at the real gyro's level (1.5 deg/s at rest).
    const clean = prevTo + (seg.to - prevTo) * ease(frac);
    const velocity = (clean - this.lastAngle) / DT + 1.5 * gauss();
    this.lastAngle = clean;
    const angle = clean + 0.2 * gauss();

    // EMG target for each channel, then a first-order lag (like the MyoWare envelope).
    const act = seg.level * (seg.phase === Phase.RETURN ? 1 - frac : 1);
    const targetFlex = EMG_BASE + (seg.muscle === 'flex' ? act : 0) + EMG_SIGMA * gauss();
    const targetExt = EMG_BASE + (seg.muscle === 'ext' ? act : 0) + EMG_SIGMA * gauss();
    const a = 0.2;
    this.envFlex += a * (targetFlex - this.envFlex);
    this.envExt += a * (targetExt - this.envExt);

    return {
      t: this.t0 + this.simT, // evenly spaced, like real sensor stamps
      angle_deg: angle,
      velocity_dps: velocity,
      emg_flex: this.envFlex,
      emg_ext: this.envExt,
      emg_flex_thresh: EMG_BASE + K * EMG_SIGMA,
      emg_ext_thresh: EMG_BASE + K * EMG_SIGMA,
      phase: seg.phase,
      status: 0,
    };
  }
}
