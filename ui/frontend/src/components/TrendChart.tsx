// Range of motion across sessions: best flexion (cyan) and best extension (magenta) per
// session, with the profile goals as dashed lines. Plain SVG; a handful of points only.
// A session that did no set in one direction has no point for it (no fake zero), and that
// line simply skips the session.
import type { Session } from '../data';
import './TrendChart.css';

interface Props {
  sessions: Session[]; // any order
  goalFlex: number;
  goalExt: number;
}

const W = 1000, H = 260, L = 44, R = 16, T = 16, B = 30;

/** Best value per direction, or null if the session had no set in that direction. */
export function bests(s: Session): { flex: number | null; ext: number | null } {
  if (s.sets?.length) {
    const f = s.sets.filter((x) => x.mode === 'flexion').map((x) => x.bestDeg);
    const e = s.sets.filter((x) => x.mode === 'extension').map((x) => -x.bestDeg);
    return { flex: f.length ? Math.max(...f) : null, ext: e.length ? Math.max(...e) : null };
  }
  return { flex: s.summary?.maxFlexDeg ?? null, ext: s.summary?.maxExtDeg ?? null };
}

export default function TrendChart({ sessions, goalFlex, goalExt }: Props) {
  const done = sessions.filter((s) => s.summary).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (done.length < 2) {
    return <p className="tc-empty">The trend appears after two saved sessions.</p>;
  }
  const pts = done.map(bests);
  const top = Math.max(90, goalFlex, goalExt);
  const x = (i: number) => L + (i * (W - L - R)) / (done.length - 1);
  const y = (v: number) => T + (1 - Math.max(0, v) / top) * (H - T - B);
  const line = (k: 'flex' | 'ext') => {
    const ok = pts.map((p, i) => [i, p[k]] as const).filter(([, v]) => v != null) as [number, number][];
    return ok.map(([i, v], j) => `${j ? 'L' : 'M'}${x(i)} ${y(v)}`).join('');
  };
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
      <path d={line('flex')} className="tc-line tc-line--flex" />
      <path d={line('ext')} className="tc-line tc-line--ext" />
      {done.map((s, i) => (
        <g key={s.id}>
          {pts[i].flex != null && <circle cx={x(i)} cy={y(pts[i].flex!)} r={4} className="tc-dot tc-dot--flex" />}
          {pts[i].ext != null && <circle cx={x(i)} cy={y(pts[i].ext!)} r={4} className="tc-dot tc-dot--ext" />}
          <text x={x(i)} y={H - 8} className="tc-axis" textAnchor="middle">{label(s.startedAt)}</text>
        </g>
      ))}
    </svg>
  );
}
