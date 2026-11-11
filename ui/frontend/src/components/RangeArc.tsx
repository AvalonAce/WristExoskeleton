// Goniometer-style dial: extension on the left (magenta), flexion on the right (cyan).
// Shows the live angle as a filled sweep from neutral plus a knob, goal markers, and
// session maxima. `intro` plays the one-time draw-in used on the loading screen.
import './RangeArc.css';

const LIMIT = 80; // deg shown each side of neutral
const CX = 200;
const CY = 205;
const R = 165;

/** Wrist angle (deg, + = flexion) -> point on the arc. -LIMIT is far left, +LIMIT far right. */
function pt(angle: number, r = R): [number, number] {
  const a = Math.max(-LIMIT, Math.min(LIMIT, angle));
  const theta = Math.PI * (1 - (a + LIMIT) / (2 * LIMIT));
  return [CX + r * Math.cos(theta), CY - r * Math.sin(theta)];
}

function arcPath(a1: number, a2: number, r = R): string {
  const [x1, y1] = pt(a1, r);
  const [x2, y2] = pt(a2, r);
  // The whole dial is 180 degrees of circle, so no segment ever needs the large-arc flag.
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

export interface RangeArcProps {
  angle: number; // deg, + = flexion; NaN shows the dial without a reading
  goalFlex?: number;
  goalExt?: number; // positive number, drawn on the extension side
  maxFlex?: number;
  maxExt?: number; // positive number
  caption?: string; // shown under the readout (e.g. the phase)
  intro?: boolean;
  hideReadout?: boolean; // dial only, no number (sign-in screen)
  size?: number; // px width
  /** One-direction set: only the working side is active, measured from the start pose. */
  set?: { mode: 'flexion' | 'extension'; startDeg: number } | null;
}

export default function RangeArc({
  angle, goalFlex, goalExt, maxFlex, maxExt, caption, intro = false, hideReadout = false, size = 420, set = null,
}: RangeArcProps) {
  const has = Number.isFinite(angle);
  const a = has ? Math.max(-LIMIT, Math.min(LIMIT, angle)) : 0;
  const dir = !has || Math.abs(a) < 2 ? 'neutral' : a > 0 ? 'flexion' : 'extension';
  const [kx, ky] = pt(a);

  const ticks = [];
  for (let d = -LIMIT; d <= LIMIT; d += 10) {
    const major = d % 30 === 0;
    const [x1, y1] = pt(d, R + 14);
    const [x2, y2] = pt(d, R + (major ? 24 : 19));
    ticks.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'ra-tick ra-tick--major' : 'ra-tick'} />);
    if (major) {
      const [lx, ly] = pt(d, R + 40);
      ticks.push(
        <text key={`l${d}`} x={lx} y={ly} className="ra-label num" textAnchor="middle" dominantBaseline="middle">
          {Math.abs(d)}
        </text>,
      );
    }
  }

  const marker = (deg: number, cls: string, key: string) => {
    const [x1, y1] = pt(deg, R - 13);
    const [x2, y2] = pt(deg, R + 13);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className={cls} />;
  };

  // One-direction set: working side runs from the start pose to the end of the dial.
  const sd = set ? Math.max(-LIMIT, Math.min(LIMIT, set.startDeg)) : 0;
  const wdir = set ? (set.mode === 'flexion' ? 1 : -1) : 0;
  const side = set?.mode === 'flexion' ? 'flex' : 'ext';
  const moved = set && has ? Math.max(0, wdir * (a - sd)) : 0;
  const fillPath = set
    ? (moved >= 0.5 ? (wdir > 0 ? arcPath(sd, a) : arcPath(a, sd)) : null)
    : (has && Math.abs(a) >= 0.5 ? (a > 0 ? arcPath(0, a) : arcPath(a, 0)) : null);
  const [sx, sy] = pt(sd, R - 28); // inside the track, clear of the tick labels

  return (
    <figure className={`ra ${intro ? 'ra--intro' : ''}`} style={{ width: size }} aria-label={
      has ? `Wrist at ${Math.abs(a).toFixed(0)} degrees ${dir}${set ? `, ${moved.toFixed(0)} degrees from the start pose` : ''}`
        : 'Wrist angle not available'}>
      <svg viewBox="0 0 400 236" role="img">
        <path d={arcPath(-LIMIT, LIMIT)} className={`ra-track ${set ? 'ra-track--idle' : ''}`} pathLength={1} />
        {set && <path d={wdir > 0 ? arcPath(sd, LIMIT) : arcPath(-LIMIT, sd)} className="ra-track ra-track--work" />}
        <g className="ra-ticks">{ticks}</g>
        {fillPath && (
          <path d={fillPath} className={`ra-fill ra-fill--${set ? side : a > 0 ? 'flex' : 'ext'}`} />
        )}
        {goalFlex !== undefined && (!set || wdir > 0) && marker(goalFlex, 'ra-goal', 'gf')}
        {goalExt !== undefined && (!set || wdir < 0) && marker(-goalExt, 'ra-goal', 'ge')}
        {maxFlex !== undefined && maxFlex > 1 && (!set || wdir > 0) && marker(maxFlex, 'ra-max ra-max--flex', 'mf')}
        {maxExt !== undefined && maxExt > 1 && (!set || wdir < 0) && marker(-maxExt, 'ra-max ra-max--ext', 'me')}
        {set && (
          <g className="ra-start">
            {marker(sd, 'ra-start-tick', 'st')}
            <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle" className="ra-start-label">Start</text>
          </g>
        )}
        {has && <circle cx={kx} cy={ky} r={11} className={`ra-knob ra-knob--${dir}`} />}
        {!hideReadout && <>
        <text x={CX} y={CY - 52} textAnchor="middle" className={`ra-readout num ${has ? '' : 'ra-readout--none'}`}>
          {has ? `${Math.abs(a).toFixed(0)}°` : '—'}
        </text>
        <text x={CX} y={CY - 18} textAnchor="middle" className={`ra-dir ra-dir--${dir}`}>
          {has ? dir : 'no reading'}
        </text>
        {set && has && (
          <text x={CX} y={CY + 6} textAnchor="middle" className="ra-moved num">{moved.toFixed(0)}° from start</text>
        )}
        </>}
        <text x={pt(-LIMIT)[0] + 4} y={CY + 26} className="ra-end">Extension</text>
        <text x={pt(LIMIT)[0] - 4} y={CY + 26} textAnchor="end" className="ra-end">Flexion</text>
      </svg>
      {caption && <figcaption className="ra-caption">{caption}</figcaption>}
    </figure>
  );
}
