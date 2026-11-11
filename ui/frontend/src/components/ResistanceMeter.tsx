// Estimated spring resistance right now vs the most this spring setting gives.
// Computed in the UI from the spring model (src/lib/spring.ts), not measured.
// One-direction set: the spring is stretched by the movement past the start pose, so the
// input is the excursion and the color is the set's direction. No set: angle from neutral.
import { maxTorque, REFERENCE_DEG, torqueAt } from '../lib/spring';
import './ResistanceMeter.css';

interface Props {
  angle: number;
  setting: number;
  peak: number; // highest estimated torque this set, N·m
  set?: { mode: 'flexion' | 'extension'; excursion: number } | null;
}

export default function ResistanceMeter({ angle, setting, peak, set = null }: Props) {
  const max = maxTorque(setting);
  const stretch = set ? set.excursion : angle;
  const tau = torqueAt(stretch, setting);
  const has = Number.isFinite(tau);
  const scale = max * 1.25; // headroom so going past 60 degrees stays visible
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const dir = !has || Math.abs(stretch) < 2 ? 'none'
    : set ? (set.mode === 'flexion' ? 'flex' : 'ext') : angle > 0 ? 'flex' : 'ext';

  return (
    <div className="rm">
      <div className="rm-head">
        <h2 className="rm-title">Resistance</h2>
        <span className="rm-tag">Estimated</span>
      </div>
      <p className={`rm-value rm-value--${dir}`}>
        {has ? tau.toFixed(2) : '—'}<span className="rm-unit"> N·m</span>
      </p>
      <div className="rm-bar" role="meter" aria-valuemin={0} aria-valuemax={scale}
        aria-valuenow={has ? tau : 0} aria-label="Estimated resistance">
        <div className={`rm-fill rm-fill--${dir}`} style={{ width: has ? pct(tau) : 0 }} />
        <div className="rm-peak" style={{ left: pct(peak) }} title="Peak this session" />
        <div className="rm-max" style={{ left: pct(max) }} />
      </div>
      <div className="rm-scale">
        <span>0</span>
        <span className="rm-max-label" style={{ left: pct(max) }}>
          {max.toFixed(2)} at {REFERENCE_DEG}°{set ? ' past start' : ''}
        </span>
      </div>
      <p className="rm-foot">
        Spring setting {setting}. Peak {set ? 'this set' : 'so far'} {peak.toFixed(2)} N·m.
      </p>
    </div>
  );
}
