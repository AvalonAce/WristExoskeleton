// Health Check measurements, computed in the browser from the 100 Hz WristState stream.
// Rep detection uses excursion_deg (movement from the set's start pose), not the phase
// classifier, so it works before the classifier exists.
import type { HcBlock, HcEmg, HcRep, HealthCheck, Patient, SetMode, WristState } from '../data';

// ---- rep detection ----------------------------------------------------------

export const REP = {
  onsetDeg: 3,  // excursion above this = moving (start of the outbound half)
  countDeg: 10, // a rep only counts if it goes at least this far from the start pose
  backDeg: 5,   // excursion back under this after the peak = rep over
};

interface Sample { t: number; angle: number; exc: number; speed: number; ag: number; an: number }

/**
 * Feed it every WristState of one test; it returns a finished rep each time one ends.
 * Also accumulates EMG during reps (agonist = the working muscle) for co-contraction.
 */
export class RepTracker {
  private cur: Sample[] | null = null;
  private peakI = 0;
  // Must be seen near the start pose before a rep can begin: a test that starts mid-movement
  // (e.g. the tail of the calibration test move) does not count it as rep 1.
  private armed = false;
  emgAg = 0;
  emgAn = 0;
  emgN = 0;
  excursion = 0; // latest, for the UI
  moving = false;

  constructor(private mode: SetMode) {}

  push(s: WristState): HcRep | null {
    const exc = Number.isFinite(s.excursion_deg) ? s.excursion_deg : 0;
    this.excursion = exc;
    const flex = this.mode === 'flexion';
    // EMG above each channel's resting threshold (0 at rest), so baseline noise isn't counted as activity.
    const act = (env: number, th: number) => (th > 0 ? Math.max(0, env - th) : env);
    const ag = flex ? act(s.emg_flex, s.emg_flex_thresh) : act(s.emg_ext, s.emg_ext_thresh);
    const an = flex ? act(s.emg_ext, s.emg_ext_thresh) : act(s.emg_flex, s.emg_flex_thresh);
    if (!this.cur) {
      if (exc < REP.onsetDeg) this.armed = true;
      if (this.armed && exc >= REP.onsetDeg) { this.cur = []; this.peakI = 0; this.armed = false; }
    }
    if (!this.cur) { this.moving = false; return null; }
    this.moving = true;
    const angle = flex ? s.angle_deg : -s.angle_deg;
    this.cur.push({ t: s.t, angle, exc, speed: Math.abs(s.velocity_dps), ag, an });
    if (Number.isFinite(ag) && Number.isFinite(an)) { this.emgAg += ag; this.emgAn += an; this.emgN += 1; }
    if (exc > this.cur[this.peakI].exc) this.peakI = this.cur.length - 1;
    const peak = this.cur[this.peakI];
    const tooLong = s.t - this.cur[0].t > 20; // abandoned mid-rep
    if ((exc < REP.backDeg && peak.exc >= REP.countDeg) || exc < REP.onsetDeg || tooLong) {
      const done = this.cur;
      this.cur = null;
      this.moving = false;
      if (peak.exc < REP.countDeg || tooLong) return null; // a twitch, not a rep
      return measure(done, this.peakI);
    }
    return null;
  }

  emg(): HcEmg | null {
    if (this.emgN < 10) return null;
    const agonist = this.emgAg / this.emgN;
    const antagonist = this.emgAn / this.emgN;
    return { agonist, antagonist, ratio: agonist > 0 ? antagonist / agonist : NaN };
  }
}

function measure(rep: Sample[], peakI: number): HcRep {
  // Outbound half ends where the wrist first gets within 1 deg of its furthest point, not at the
  // exact maximum (which wanders through the hold at end range on sensor noise).
  const endI = Math.max(1, rep.findIndex((x) => x.exc >= rep[peakI].exc - 1));
  const out = rep.slice(0, endI + 1);
  const peak = rep[endI];
  const dt = out.length > 1 ? (out[out.length - 1].t - out[0].t) / (out.length - 1) : 0.01;
  return {
    peakDeg: Math.max(...rep.map((x) => x.angle)),
    excursionDeg: peak.exc,
    peakDps: Math.max(...out.map((x) => x.speed)),
    outS: peak.t - rep[0].t,
    sparc: sparc(out.map((x) => x.speed), dt > 0 ? 1 / dt : 100),
  };
}

// ---- SPARC (spectral arc length), Balasubramanian et al. ---------------------
// Arc length of the normalized magnitude spectrum of the speed profile, up to the last
// frequency above amp_th (cut at fc). Typical values: about -1.4 for one smooth
// bell-shaped movement, more negative for jerky or multi-peaked movements.

export function sparc(speed: number[], fs: number, padLevel = 4, fc = 10, ampTh = 0.05): number | null {
  const n = speed.length;
  if (n < 8 || !(fs > 0)) return null;
  const nfft = 2 ** (Math.ceil(Math.log2(n)) + padLevel);
  const kMax = Math.floor((fc * nfft) / fs);
  const mag: number[] = [];
  for (let k = 0; k <= kMax; k++) { // DFT only over the bins we need (0..fc)
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / nfft;
    for (let i = 0; i < n; i++) { re += speed[i] * Math.cos(w * i); im += speed[i] * Math.sin(w * i); }
    mag.push(Math.hypot(re, im));
  }
  const m0 = Math.max(...mag);
  if (!(m0 > 0)) return null;
  const m = mag.map((v) => v / m0);
  let first = -1, last = -1;
  m.forEach((v, i) => { if (v >= ampTh) { if (first < 0) first = i; last = i; } });
  if (first < 0 || last <= first) return 0;
  const span = (last - first) * (fs / nfft);
  let len = 0;
  for (let i = first + 1; i <= last; i++) {
    const df = (fs / nfft) / span;
    len += Math.hypot(df, m[i] - m[i - 1]);
  }
  return -len;
}

// ---- results ------------------------------------------------------------------

export const BAND = { matchPct: 90, functionalDeg: 40 } as const; // team-chosen cut-offs, see usage guide

export type Band = 'matches' | 'functional' | 'below' | 'reference';
export const BAND_TEXT: Record<Band, string> = {
  matches: 'Matches reference',
  functional: 'Functional',
  below: 'Below functional',
  reference: 'Reference',
};

const best = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
};
const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export interface ResultRow {
  block: HcBlock;
  imuDeg: number | null;     // best of the range reps
  gonioDeg: number | null;   // best goniometer reading
  diffDeg: number | null;    // mean (IMU - goniometer) over reps that have both
  pctOfRef: number | null;   // treated only
  band: Band | null;
  peakDps: number | null;    // best of the pace reps
  sparc: number | null;      // mean of the pace reps
  loadedReps: number | null;
  ccRatio: number | null;
  pain: number | null;
}

export function resultRows(hc: HealthCheck): ResultRow[] {
  const refBlock = (m: SetMode) => hc.blocks.find((b) => b.role === 'reference' && b.mode === m && b.complete);
  return hc.blocks.map((b) => {
    const imuDeg = best(b.range.map((r) => r.peakDeg));
    const gonioDeg = best(b.range.map((r) => r.gonioDeg));
    const diffDeg = mean(b.range.map((r) => (r.gonioDeg != null && Number.isFinite(r.gonioDeg) ? r.peakDeg - r.gonioDeg : null)));
    let pctOfRef: number | null = null;
    let band: Band | null = null;
    if (imuDeg != null) {
      if (b.role === 'reference') band = 'reference';
      else {
        const ref = refBlock(b.mode);
        const refDeg = ref ? best(ref.range.map((r) => r.peakDeg)) : null;
        if (refDeg && refDeg > 0) pctOfRef = (100 * imuDeg) / refDeg;
        band = pctOfRef != null && pctOfRef >= BAND.matchPct ? 'matches'
          : imuDeg >= BAND.functionalDeg ? 'functional' : 'below';
      }
    }
    return {
      block: b, imuDeg, gonioDeg, diffDeg, pctOfRef, band,
      peakDps: best(b.pace.map((r) => r.peakDps)),
      sparc: mean(b.pace.map((r) => r.sparc)),
      loadedReps: b.loaded?.reps ?? null,
      ccRatio: b.emg && Number.isFinite(b.emg.ratio) ? b.emg.ratio : null,
      pain: b.pain,
    };
  });
}

/** Overall label: healthy only if every finished treated block matches its reference. */
export function profileLabel(rows: ResultRow[]): 'healthy' | 'recovering' | 'incomplete' {
  const treated = rows.filter((r) => r.block.role === 'treated');
  if (!treated.length || treated.some((r) => !r.block.complete || r.band == null)) return 'incomplete';
  return treated.every((r) => r.band === 'matches') ? 'healthy' : 'recovering';
}

const fmt = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));

export function toCsv(hc: HealthCheck, p: Patient): string {
  const head = ['participant', 'date', 'wrist', 'role', 'direction', 'complete', 'imu_range_deg', 'gonio_range_deg',
    'imu_minus_gonio_deg', 'pct_of_reference', 'band', 'peak_speed_dps', 'sparc', 'loaded_reps_30s',
    'cocontraction_ratio', 'pain_0_10', 'prwe_total', 'spring_setting', 'bags'];
  const lines = [head.join(',')];
  for (const r of resultRows(hc)) {
    const b = r.block;
    lines.push([p.code, hc.startedAt.slice(0, 10), b.side, b.role, b.mode, b.complete ? 1 : 0, fmt(r.imuDeg),
      fmt(r.gonioDeg), fmt(r.diffDeg), fmt(r.pctOfRef, 0), r.band ?? '', fmt(r.peakDps, 0), fmt(r.sparc, 2),
      r.loadedReps ?? '', fmt(r.ccRatio, 2), r.pain ?? '', hc.prwe ?? '', b.springSetting, b.bags.join(' ')].join(','));
  }
  return lines.join('\n') + '\n';
}
