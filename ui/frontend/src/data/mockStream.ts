// Fake 100 Hz WristState that behaves like the exo + wrist_state node.
// No mode set: a two-direction demo loop (rest, flexion rep, rest, extension rep).
// Mode set (one-direction exo): the fake patient follows the calibration steps (neutral, start
// pose, test movement), then repeats reps from the start pose in the working direction.
// EMG bursts start ~120 ms before movement (the onset lead the project measures).
import {
  Calib, Mode, Phase, modeDir, type CalibStep, type ConnectionState, type ExoControl,
  type ExoStream, type SetMode, type WristState,
} from './types';

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

// One-direction sets: relaxed start pose and how far a rep goes past it.
const START_POSE: Record<SetMode, number> = { flexion: -30, extension: 30 };
const REP_RANGE = 62; // deg from the start pose
const HOLD_S = 2.0; // calibration holds, like the node
const REP: { phase: 'rest' | 'onset' | 'move' | 'hold' | 'return'; dur: number }[] = [
  { phase: 'rest', dur: 2.5 }, { phase: 'onset', dur: EMG_LEAD }, { phase: 'move', dur: 1.2 },
  { phase: 'hold', dur: 1.5 }, { phase: 'return', dur: 1.1 },
];
const REP_LEN = REP.reduce((s, x) => s + x.dur, 0);

interface Frame {
  clean: number; // noise-free angle
  phase: Phase;
  muscle: 'flex' | 'ext' | null;
  act: number; // EMG above baseline
}

/** Smooth 0->1 ramp (cosine), so angle and velocity have no corners. */
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

export class MockStream implements ExoStream, ExoControl {
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

  // one-direction set state (mirrors the node's SetCalibration)
  private mode: SetMode | null = null;
  private cal = 0; // Calib bits
  private job: { step: CalibStep; t0: number; from: number } | null = null;
  private pose = 0; // where the fake wrist rests when idle
  private repT0 = 0; // simT when reps began

  setMode(mode: SetMode | 'none') {
    const m = mode === 'none' ? null : mode;
    if (m === this.mode) return;
    this.mode = m;
    this.cal = 0;
    this.job = null;
  }

  calibrate(step: CalibStep) {
    if (step === 'cancel') { this.job = null; return; }
    if (!this.mode && step !== 'neutral') return; // the node allows neutral without a set direction
    if (step === 'test_move' && !(this.cal & Calib.START)) return;
    this.cal &= ~Calib.FAILED;
    this.job = { step, t0: this.simT, from: this.lastAngle };
  }

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

  /** Two-direction demo loop (no mode set). */
  private legacyFrame(): Frame {
    let tc = this.simT % CYCLE_LEN;
    let i = 0;
    while (tc >= CYCLE[i].dur) {
      tc -= CYCLE[i].dur;
      i++;
    }
    const seg = CYCLE[i];
    const prevTo = i === 0 ? CYCLE[CYCLE.length - 1].to : CYCLE[i - 1].to;
    const frac = tc / seg.dur;
    return {
      clean: prevTo + (seg.to - prevTo) * ease(frac),
      phase: seg.phase,
      muscle: seg.muscle,
      act: seg.level * (seg.phase === Phase.RETURN ? 1 - frac : 1),
    };
  }

  /** One-direction set: follow the calibration job, then do reps from the start pose. */
  private setFrame(mode: SetMode): Frame {
    const dir = modeDir(mode);
    const start = START_POSE[mode];
    const muscle = dir > 0 ? 'flex' as const : 'ext' as const;
    const rest = (clean: number): Frame => ({ clean, phase: Phase.REST, muscle: null, act: 0 });
    const job = this.job;
    if (job) {
      const u = this.simT - job.t0;
      if (job.step === 'neutral' || job.step === 'start') {
        const target = job.step === 'neutral' ? 0 : start;
        const clean = job.from + (target - job.from) * ease(u / 0.8);
        if (u >= 0.8 + HOLD_S) {
          this.cal |= job.step === 'neutral' ? Calib.NEUTRAL : Calib.START;
          if (job.step === 'neutral') this.cal &= ~(Calib.START | Calib.DIRECTION);
          else this.cal &= ~Calib.DIRECTION;
          this.pose = target;
          this.job = null;
        }
        return rest(clean);
      }
      // test movement: 25 deg in the working direction and back
      const out = ease(u / 1.0) - ease((u - 1.6) / 1.0);
      if (u >= 0.6 && !(this.cal & Calib.DIRECTION)) this.cal |= Calib.DIRECTION; // passed 12 deg
      if (u >= 2.8) { this.job = null; this.repT0 = this.simT + 1.0; }
      return { clean: job.from + dir * 25 * out, phase: u < 1 ? (dir > 0 ? Phase.FLEX : Phase.EXT) : Phase.RETURN,
        muscle, act: 350 * out };
    }
    const ready = (this.cal & (Calib.NEUTRAL | Calib.START | Calib.DIRECTION))
      === (Calib.NEUTRAL | Calib.START | Calib.DIRECTION);
    if (!ready || this.simT < this.repT0) return rest(this.pose);
    // reps
    let tc = (this.simT - this.repT0) % REP_LEN;
    let i = 0;
    while (tc >= REP[i].dur) { tc -= REP[i].dur; i++; }
    const seg = REP[i];
    const f = tc / seg.dur;
    const far = start + dir * REP_RANGE;
    switch (seg.phase) {
      case 'rest': return rest(start);
      case 'onset': return { clean: start, phase: Phase.ONSET, muscle, act: 250 };
      case 'move': return { clean: start + (far - start) * ease(f), phase: dir > 0 ? Phase.FLEX : Phase.EXT, muscle, act: 650 };
      case 'hold': return { clean: far, phase: Phase.HOLD, muscle, act: 480 };
      default: return { clean: far + (start - far) * ease(f), phase: Phase.RETURN, muscle, act: 220 * (1 - f) };
    }
  }

  private step(): WristState {
    this.simT += DT;
    if (!this.mode && this.job && this.simT - this.job.t0 >= 0.8 + HOLD_S) { // neutral, no set
      this.cal |= Calib.NEUTRAL;
      this.job = null;
    }
    const fr = this.mode ? this.setFrame(this.mode) : this.legacyFrame();

    // Differentiate the clean angle, then add noise at the real gyro's level (1.5 deg/s at rest).
    const velocity = (fr.clean - this.lastAngle) / DT + 1.5 * gauss();
    this.lastAngle = fr.clean;
    const angle = fr.clean + 0.2 * gauss();

    // EMG target for each channel, then a first-order lag (like the MyoWare envelope).
    const targetFlex = EMG_BASE + (fr.muscle === 'flex' ? fr.act : 0) + EMG_SIGMA * gauss();
    const targetExt = EMG_BASE + (fr.muscle === 'ext' ? fr.act : 0) + EMG_SIGMA * gauss();
    const a = 0.2;
    this.envFlex += a * (targetFlex - this.envFlex);
    this.envExt += a * (targetExt - this.envExt);

    const mode = this.mode;
    const startOk = mode && (this.cal & Calib.START);
    const startDeg = startOk ? START_POSE[mode] : 0;
    return {
      t: this.t0 + this.simT, // evenly spaced, like real sensor stamps
      angle_deg: angle,
      velocity_dps: velocity,
      emg_flex: this.envFlex,
      emg_ext: this.envExt,
      emg_flex_thresh: EMG_BASE + K * EMG_SIGMA,
      emg_ext_thresh: EMG_BASE + K * EMG_SIGMA,
      phase: fr.phase,
      status: 0,
      mode: mode === 'flexion' ? Mode.FLEXION : mode === 'extension' ? Mode.EXTENSION : Mode.NONE,
      // like the node: the test step is done (not busy) once the movement passed 12 degrees
      calib: this.cal | (this.job && !(this.job.step === 'test_move' && this.cal & Calib.DIRECTION) ? Calib.BUSY : 0),
      start_deg: startDeg,
      excursion_deg: mode && startOk ? Math.max(0, modeDir(mode) * (angle - startDeg)) : 0,
    };
  }
}
