// 0-90 deg dial for the capture screen: degrees the wrist has moved from its rest pose
// (the exo's slack position), whichever way it moved. `mode` only names and colours it.
import type { SetMode } from '../data';
import './AngleDial.css';

const MAX = 90;
const CX = 200;
const CY = 200;
const R = 160;

/** deg (0..MAX) -> point on the half circle, 0 at the left end, MAX at the right end. */
function pt(deg: number, r = R): [number, number] {
  const d = Math.max(0, Math.min(MAX, deg));
  const th = Math.PI * (1 - d / MAX);
  return [CX + r * Math.cos(th), CY - r * Math.sin(th)];
}
function arc(a: number, b: number, r = R) {
  const [x1, y1] = pt(a, r);
  const [x2, y2] = pt(b, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

interface Props {
  mode: SetMode;
  moved: number; // deg from the rest pose, >= 0 (NaN = no reading)
  peak?: number | null; // e.g. this recording's furthest
}

export default function AngleDial({ mode, moved, peak }: Props) {
  const has = Number.isFinite(moved);
  const v = has ? Math.max(0, moved) : NaN;
  const shown = has ? Math.min(MAX, v) : 0;
  const side = mode === 'flexion' ? 'flex' : 'ext';
  const [kx, ky] = pt(shown);

  const ticks = [];
  for (let d = 0; d <= MAX; d += 10) {
    const major = d % 30 === 0;
    const [x1, y1] = pt(d, R + 14);
    const [x2, y2] = pt(d, R + (major ? 26 : 20));
    ticks.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'ad-tick ad-tick--major' : 'ad-tick'} />);
    if (major) {
      const [lx, ly] = pt(d, R + 42);
      ticks.push(<text key={`l${d}`} x={lx} y={ly} className="ad-label" textAnchor="middle" dominantBaseline="middle">{d}°</text>);
    }
  }
  const pk = peak != null && peak > 1 ? Math.min(MAX, peak) : null;
  const [p1x, p1y] = pk != null ? pt(pk, R - 14) : [0, 0];
  const [p2x, p2y] = pk != null ? pt(pk, R + 14) : [0, 0];

  return (
    <figure className="ad" aria-label={has ? `${v.toFixed(0)} degrees from rest, ${mode}` : 'No angle reading'}>
      <svg viewBox="0 0 400 250" role="img">
        <path d={arc(0, MAX)} className="ad-track" />
        <g>{ticks}</g>
        {shown >= 0.5 && <path d={arc(0, shown)} className={`ad-fill ad-fill--${side}`} />}
        {pk != null && <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} className={`ad-peak ad-peak--${side}`} />}
        {has && <circle cx={kx} cy={ky} r={12} className={`ad-knob ad-knob--${side}`} />}
        <text x={CX} y={CY - 46} textAnchor="middle" className={`ad-num ${has ? '' : 'ad-num--none'}`}>
          {has ? `${v.toFixed(0)}°` : '—'}
        </text>
        <text x={CX} y={CY - 12} textAnchor="middle" className={`ad-dir ad-dir--${side}`}>
          {!has ? 'no reading' : v > MAX ? `${mode}, past 90°` : mode}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" className="ad-other">from rest</text>
        {pk != null && <text x={CX} y={CY + 40} textAnchor="middle" className="ad-other">peak {pk.toFixed(0)}°</text>}
      </svg>
    </figure>
  );
}
