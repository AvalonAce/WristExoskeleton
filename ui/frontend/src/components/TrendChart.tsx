// Range of motion across sessions: best flexion (cyan) and best extension (magenta) per
// session, with the profile goals as dashed lines. Plain SVG; a handful of points only.
import type { Session } from '../data';
import './TrendChart.css';

interface Props {
  sessions: Session[]; // any order
  goalFlex: number;
  goalExt: number;
}

const W = 1000, H = 260, L = 44, R = 16, T = 16, B = 30;

export default function TrendChart({ sessions, goalFlex, goalExt }: Props) {
  const done = sessions.filter((s) => s.summary).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (done.length < 2) {
    return <p className="tc-empty">The trend appears after two saved sessions.</p>;
  }
  const top = Math.max(90, goalFlex, goalExt);
  const x = (i: number) => L + (i * (W - L - R)) / (done.length - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = (k: 'maxFlexDeg' | 'maxExtDeg') => done.map((s, i) => `${i ? 'L' : 'M'}${x(i)} ${y(s.summary![k])}`).join('');
  const label = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <svg className="tc" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Best flexion and extension over ${done.length} sessions`}>
      {[0, 30, 60, 90].filter((v) => v <= top).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="tc-grid" />
          <text x={L - 8} y={y(v)} className="tc-axis" textAnchor="end" dominantBaseline="middle">{v}°</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(goalFlex)} y2={y(goalFlex)} className="tc-goal tc-goal--flex" />
      <line x1={L} x2={W - R} y1={y(goalExt)} y2={y(goalExt)} className="tc-goal tc-goal--ext" />
      <path d={line('maxFlexDeg')} className="tc-line tc-line--flex" />
      <path d={line('maxExtDeg')} className="tc-line tc-line--ext" />
      {done.map((s, i) => (
        <g key={s.id}>
          <circle cx={x(i)} cy={y(s.summary!.maxFlexDeg)} r={4} className="tc-dot tc-dot--flex" />
          <circle cx={x(i)} cy={y(s.summary!.maxExtDeg)} r={4} className="tc-dot tc-dot--ext" />
          <text x={x(i)} y={H - 8} className="tc-axis" textAnchor="middle">{label(s.startedAt)}</text>
        </g>
      ))}
    </svg>
  );
}
