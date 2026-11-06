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
  const large = Math.abs(a2 - a1) > 2 * LIMIT * 0.5 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
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
}

export default function RangeArc({
  angle, goalFlex, goalExt, maxFlex, maxExt, caption, intro = false, hideReadout = false, size = 420,
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

  return (
    <figure className={`ra ${intro ? 'ra--intro' : ''}`} style={{ width: size }} aria-label={
      has ? `Wrist at ${Math.abs(a).toFixed(0)} degrees ${dir}` : 'Wrist angle not available'}>
      <svg viewBox="0 0 400 236" role="img">
        <path d={arcPath(-LIMIT, LIMIT)} className="ra-track" pathLength={1} />
        <g className="ra-ticks">{ticks}</g>
        {has && Math.abs(a) >= 0.5 && (
          <path d={a > 0 ? arcPath(0, a) : arcPath(a, 0)} className={`ra-fill ra-fill--${a > 0 ? 'flex' : 'ext'}`} />
        )}
        {goalFlex !== undefined && marker(goalFlex, 'ra-goal', 'gf')}
        {goalExt !== undefined && marker(-goalExt, 'ra-goal', 'ge')}
        {maxFlex !== undefined && maxFlex > 1 && marker(maxFlex, 'ra-max ra-max--flex', 'mf')}
        {maxExt !== undefined && maxExt > 1 && marker(-maxExt, 'ra-max ra-max--ext', 'me')}
        {has && <circle cx={kx} cy={ky} r={11} className={`ra-knob ra-knob--${dir}`} />}
        {!hideReadout && <>
        <text x={CX} y={CY - 52} textAnchor="middle" className={`ra-readout num ${has ? '' : 'ra-readout--none'}`}>
          {has ? `${Math.abs(a).toFixed(0)}°` : '—'}
        </text>
        <text x={CX} y={CY - 18} textAnchor="middle" className={`ra-dir ra-dir--${dir}`}>
          {has ? dir : 'no reading'}
        </text>
        </>}
        <text x={pt(-LIMIT)[0] + 4} y={CY + 26} className="ra-end">Extension</text>
        <text x={pt(LIMIT)[0] - 4} y={CY + 26} textAnchor="end" className="ra-end">Flexion</text>
      </svg>
      {caption && <figcaption className="ra-caption">{caption}</figcaption>}
    </figure>
  );
}
