// Confirmed commands to the state node. A command can be lost (e.g. sent just as rosbridge
// connects), so each one is checked against what WristState reports and resent if needed.
import { Calib, Mode, control, stream, type CalibStep, type SetMode, type WristState } from '../data';

const CONFIRM_MS = 700; // how long to wait for the node to show a command arrived
const TRIES = 3;

/** Resolves with the first state matching `pred`, or null after `ms`. */
export function waitFor(pred: (s: WristState) => boolean, ms: number): Promise<WristState | null> {
  return new Promise((resolve) => {
    let done = false;
    let off = () => {};
    const finish = (s: WristState | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => off());
      resolve(s);
    };
    const timer = setTimeout(() => finish(null), ms);
    off = stream.subscribe((s) => { if (pred(s)) finish(s); });
  });
}

const MODE_CODE = { flexion: Mode.FLEXION, extension: Mode.EXTENSION, none: Mode.NONE } as const;

/** Set the node's mode and wait until it reports it. False if it never confirmed. */
export async function setModeConfirmed(mode: SetMode | 'none'): Promise<boolean> {
  for (let i = 0; i < TRIES; i++) {
    control.setMode(mode);
    if (await waitFor((s) => s.mode === MODE_CODE[mode], CONFIRM_MS)) return true;
  }
  return false;
}

export type StepResult =
  | { ok: true; state: WristState }
  | { ok: false; reason: 'no-response' | 'too-small' | 'timeout' };

const DONE_BIT: Record<Exclude<CalibStep, 'cancel'>, number> = {
  neutral: Calib.NEUTRAL, start: Calib.START, test_move: Calib.DIRECTION,
};
const LIMIT_MS: Record<Exclude<CalibStep, 'cancel'>, number> = {
  neutral: 6000, start: 6000, test_move: 10000,
};

/**
 * Run one calibration step: send it, confirm the node started it (BUSY), then wait until it
 * finishes. A test movement that was too small comes back as { ok: false, reason: 'too-small' }.
 */
export async function runCalibStep(step: Exclude<CalibStep, 'cancel'>): Promise<StepResult> {
  let started: WristState | null = null;
  for (let i = 0; i < TRIES && !started; i++) {
    control.calibrate(step);
    started = await waitFor((s) => (s.calib & Calib.BUSY) !== 0, CONFIRM_MS);
  }
  if (!started) return { ok: false, reason: 'no-response' };
  const end = await waitFor((s) => (s.calib & Calib.BUSY) === 0, LIMIT_MS[step]);
  if (!end) {
    control.calibrate('cancel');
    return { ok: false, reason: 'timeout' };
  }
  if (step === 'test_move' && end.calib & Calib.FAILED) return { ok: false, reason: 'too-small' };
  if (!(end.calib & DONE_BIT[step])) return { ok: false, reason: 'timeout' };
  return { ok: true, state: end };
}
