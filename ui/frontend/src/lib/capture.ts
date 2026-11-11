// Free recording on the Capture screen: running numbers, a 20 Hz trace, and CSV export.
import type { Patient, Recording, WristState } from '../data';

const REP_OUT = 15; // deg past neutral to count as a rep
const REP_BACK = 5; // deg back toward neutral to finish it
const TRACE_DT = 0.05; // s (20 Hz)
const TRACE_MAX = 20 * 60 * 15; // 15 min of trace; the rosbag keeps everything

export type CaptureNumbers = Pick<Recording,
  'maxFlexDeg' | 'maxExtDeg' | 'peakDps' | 'flexReps' | 'extReps' |
  'emgFlexPeak' | 'emgExtPeak' | 'emgFlexMean' | 'emgExtMean'> & { durationS: number };

export class Capture {
  private t0: number | null = null;
  private lastT = -Infinity;
  private side: 'flex' | 'ext' | null = null; // rep in progress
  private sumF = 0;
  private sumE = 0;
  private n = 0;
  nums: CaptureNumbers = {
    durationS: 0, maxFlexDeg: 0, maxExtDeg: 0, peakDps: 0, flexReps: 0, extReps: 0,
    emgFlexPeak: 0, emgExtPeak: 0, emgFlexMean: 0, emgExtMean: 0,
  };
  trace: Recording['trace'] = { t: [], angle: [], vel: [], flex: [], ext: [] };

  constructor(private sign: 1 | -1) {}

  push(s: WristState) {
    if (this.t0 == null) this.t0 = s.t;
    const a = this.sign * s.angle_deg;
    const v = Math.abs(s.velocity_dps);
    const x = this.nums;
    x.durationS = s.t - this.t0;
    if (Number.isFinite(a)) {
      if (a > x.maxFlexDeg) x.maxFlexDeg = a;
      if (-a > x.maxExtDeg) x.maxExtDeg = -a;
      if (this.side == null && a > REP_OUT) this.side = 'flex';
      else if (this.side == null && -a > REP_OUT) this.side = 'ext';
      else if (this.side === 'flex' && a < REP_BACK) { x.flexReps += 1; this.side = null; }
      else if (this.side === 'ext' && -a < REP_BACK) { x.extReps += 1; this.side = null; }
    }
    if (Number.isFinite(v) && v > x.peakDps) x.peakDps = v;
    if (Number.isFinite(s.emg_flex) && Number.isFinite(s.emg_ext)) {
      x.emgFlexPeak = Math.max(x.emgFlexPeak, s.emg_flex);
      x.emgExtPeak = Math.max(x.emgExtPeak, s.emg_ext);
      this.sumF += s.emg_flex;
      this.sumE += s.emg_ext;
      this.n += 1;
      x.emgFlexMean = this.sumF / this.n;
      x.emgExtMean = this.sumE / this.n;
    }
    if (s.t - this.lastT >= TRACE_DT && this.trace.t.length < TRACE_MAX) {
      this.lastT = s.t;
      const r = (v: number, d = 10) => (Number.isFinite(v) ? Math.round(v * d) / d : NaN);
      this.trace.t.push(r(x.durationS, 100));
      this.trace.angle.push(r(a));
      this.trace.vel.push(r(this.sign * s.velocity_dps));
      this.trace.flex.push(r(s.emg_flex));
      this.trace.ext.push(r(s.emg_ext));
    }
  }
}

// ---- CSV ----------------------------------------------------------------------

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '');

export function summaryCsv(recs: Recording[], patients: Patient[]): string {
  const byId = new Map(patients.map((p) => [p.id, p]));
  const head = ['participant', 'label', 'wrist', 'direction', 'started', 'duration_s', 'note', 'max_flex_deg', 'max_ext_deg',
    'peak_speed_dps', 'flex_reps', 'ext_reps', 'emg_flex_peak', 'emg_ext_peak', 'emg_flex_mean', 'emg_ext_mean',
    'neutral_set', 'angle_sign', 'bag'];
  const rows = recs.map((r) => {
    const p = byId.get(r.patientId);
    return [p?.code ?? '', q(p?.displayName ?? ''), p?.side ?? '', r.direction ?? '', r.startedAt, f1(r.durationS), q(r.note),
      f1(r.maxFlexDeg), f1(r.maxExtDeg), f1(r.peakDps), r.flexReps, r.extReps, f1(r.emgFlexPeak), f1(r.emgExtPeak),
      f1(r.emgFlexMean), f1(r.emgExtMean), r.neutralSet ? 1 : 0, r.angleSign, r.bag ?? ''].join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function traceCsv(r: Recording): string {
  const { t, angle, vel, flex, ext } = r.trace;
  const lines = ['t_s,angle_deg,velocity_dps,emg_flex,emg_ext'];
  for (let i = 0; i < t.length; i++) lines.push([t[i], angle[i], vel[i], flex[i], ext[i]].map((v) => (Number.isFinite(v) ? v : '')).join(','));
  return lines.join('\n') + '\n';
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Local time as YYYYMMDD_HHMMSS, for file and bag names. */
export function fileStamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---- rep detection on a saved trace (viewer) -------------------------------------
// Works on movement from the rest pose (the first 0.5 s of the recording), either way.
// A rep = rises at least REP_MIN deg above the last low point, then falls back by at least
// half of that rise (and at least REP_MIN). Start/end are the low points around it.

export const REP_MIN = 15;

export interface TraceRep {
  n: number;
  i0: number; iPeak: number; i1: number; // sample indices
  t0: number; tPeak: number; t1: number; // s from recording start
  peakDeg: number; // movement from rest at the peak
  peakDps: number; // fastest speed during the rep
}

export function restOf(tr: Recording['trace']): number {
  const xs = tr.angle.filter((v, i) => tr.t[i] <= tr.t[0] + 0.5 && Number.isFinite(v)).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
}

export function movedOf(tr: Recording['trace']): number[] {
  const r = restOf(tr);
  return tr.angle.map((a) => (Number.isFinite(a) ? Math.abs(a - r) : NaN));
}

export function findReps(tr: Recording['trace']): TraceRep[] {
  const m = movedOf(tr);
  const reps: TraceRep[] = [];
  let lowI = 0; // lowest point since the last rep ended
  let peakI = -1; // -1 = not in a rep
  let startI = 0;
  for (let i = 0; i < m.length; i++) {
    const v = m[i];
    if (!Number.isFinite(v)) continue;
    if (peakI < 0) {
      if (v < m[lowI] || !Number.isFinite(m[lowI])) lowI = i;
      if (v >= m[lowI] + REP_MIN) {
        peakI = i;
        // start = where it left the low point (within 2 deg), not the low point itself
        startI = i;
        while (startI > lowI && m[startI - 1] > m[lowI] + 2) startI--;
        startI = Math.max(lowI, startI - 1);
      }
    } else {
      if (v > m[peakI]) peakI = i;
      const rise = m[peakI] - m[lowI];
      if (m[peakI] - v >= Math.max(REP_MIN, rise / 2)) {
        // walk on to the bottom of the return
        let end = i;
        while (end + 1 < m.length && Number.isFinite(m[end + 1]) && m[end + 1] <= m[end]) end++;
        let spd = 0;
        for (let k = startI; k <= end; k++) if (Number.isFinite(tr.vel[k])) spd = Math.max(spd, Math.abs(tr.vel[k]));
        reps.push({
          n: reps.length + 1, i0: startI, iPeak: peakI, i1: end,
          t0: tr.t[startI], tPeak: tr.t[peakI], t1: tr.t[end], peakDeg: m[peakI], peakDps: spd,
        });
        peakI = -1;
        lowI = end;
        i = end;
      }
    }
  }
  return reps;
}
