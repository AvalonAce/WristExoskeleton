// Full view of one saved recording: movement from rest and EMG over time, reps shaded and
// numbered. Drag on a chart to zoom into a time range, double-click to zoom out; click a rep
// in the table to zoom to it. Both charts share the time axis and cursor.
import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Patient, Recording } from '../data';
import { REP_MIN, download, fileStamp, findReps, movedOf, restOf, traceCsv, type TraceRep } from '../lib/capture';
import Dialog from './Dialog';
import './RecordingViewer.css';

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const describe = (a: number) =>
  Math.abs(a) < 2 ? 'straight' : `${Math.abs(a).toFixed(0)}° ${a > 0 ? 'flexion' : 'extension'}`;

/** Shade each rep's time span; number it at the top; mark its peak. */
function repPlugin(reps: TraceRep[], tone: string, active: { current: number | null }, markPeaks: boolean): uPlot.Plugin {
  return {
    hooks: {
      drawClear: [(u) => {
        const { ctx } = u;
        const { top, height, left, width } = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip(); // zoomed in: don't shade over the axes
        for (const r of reps) {
          const x0 = u.valToPos(r.t0, 'x', true);
          const x1 = u.valToPos(r.t1, 'x', true);
          ctx.fillStyle = tone;
          ctx.globalAlpha = active.current === r.n ? 0.28 : r.n % 2 ? 0.12 : 0.07;
          ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
        }
        ctx.restore();
      }],
      draw: [(u) => {
        const { ctx } = u;
        const { top, left, width } = u.bbox;
        const dpr = devicePixelRatio || 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, u.bbox.height);
        ctx.clip();
        ctx.font = `600 ${12 * dpr}px ${cssVar('--font') || 'sans-serif'}`;
        ctx.textAlign = 'center';
        for (const r of reps) {
          const xm = u.valToPos((r.t0 + r.t1) / 2, 'x', true);
          if (xm < left || xm > left + width) continue;
          ctx.fillStyle = cssVar('--ink');
          ctx.fillText(String(r.n), xm, top + 14 * dpr);
          if (markPeaks) {
            const xp = u.valToPos(r.tPeak, 'x', true);
            const yp = u.valToPos(r.peakDeg, 'y', true);
            ctx.beginPath();
            ctx.arc(xp, yp, 4 * dpr, 0, 2 * Math.PI);
            ctx.fillStyle = cssVar('--ink');
            ctx.fill();
            ctx.fillStyle = cssVar('--slate');
            ctx.font = `${11 * dpr}px ${cssVar('--font') || 'sans-serif'}`;
            ctx.fillText(`${r.peakDeg.toFixed(0)}°`, xp, yp - 9 * dpr);
            ctx.font = `600 ${12 * dpr}px ${cssVar('--font') || 'sans-serif'}`;
          }
        }
        ctx.restore();
      }],
    },
  };
}

interface Props {
  rec: Recording;
  patient: Patient | undefined;
  onClose: () => void;
}

export default function RecordingViewer({ rec, patient, onClose }: Props) {
  const tr = rec.trace;
  const reps = useMemo(() => findReps(tr), [tr]);
  const moved = useMemo(() => movedOf(tr), [tr]);
  const rest = useMemo(() => restOf(tr), [tr]);
  const box1 = useRef<HTMLDivElement>(null);
  const box2 = useRef<HTMLDivElement>(null);
  const plots = useRef<uPlot[]>([]);
  const active = useRef<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const tMax = tr.t.length ? tr.t[tr.t.length - 1] : 0;

  useEffect(() => {
    if (!tr.t.length) return;
    const tone = cssVar(rec.direction === 'extension' ? '--ext' : '--flex');
    const width = Math.max(320, box1.current!.clientWidth);
    const sync = uPlot.sync(`rec-${rec.id}`);
    const common = (h: number): Partial<uPlot.Options> => ({
      width, height: h,
      cursor: { sync: { key: sync.key, setSeries: false }, drag: { x: true, y: false } },
      legend: { show: true },
      hooks: {
        setScale: [(u, key) => {
          if (key !== 'x') return;
          const { min, max } = u.scales.x;
          setZoomed(min != null && max != null && (min > 0.01 || max < tMax - 0.01));
          for (const o of plots.current) {
            if (o !== u && (o.scales.x.min !== min || o.scales.x.max !== max)) o.setScale('x', { min: min!, max: max! });
          }
        }],
      },
    });
    const axes = (yLabel: string): uPlot.Axis[] => [
      { stroke: cssVar('--slate'), grid: { stroke: cssVar('--bone') }, values: (_u, v) => v.map((x) => `${x.toFixed(x % 1 ? 1 : 0)} s`) },
      { stroke: cssVar('--slate'), grid: { stroke: cssVar('--bone') }, label: yLabel, size: 52 },
    ];
    const p1 = new uPlot({
      ...common(260),
      scales: { x: { time: false }, y: { range: (_u, _lo, hi) => [0, Math.max(30, Math.ceil((hi * 1.25 + 5) / 10) * 10)] } }, // headroom for labels
      axes: axes('deg from rest'),
      series: [
        { label: 'Time (s)', value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} s`) },
        { label: 'Moved from rest', stroke: tone, width: 2, value: (_u, v) => (v == null ? '—' : `${v.toFixed(0)}°`) },
        { label: '15° rep line', stroke: cssVar('--slate'), width: 1, dash: [4, 4], points: { show: false } },
      ],
      plugins: [repPlugin(reps, tone, active, true)],
    } as uPlot.Options, [tr.t, moved, tr.t.map(() => REP_MIN)], box1.current!);
    const p2 = new uPlot({
      ...common(200),
      scales: { x: { time: false } },
      axes: axes('EMG level'),
      series: [
        { label: 'Time (s)', value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} s`) },
        { label: 'Flexor', stroke: cssVar('--flex'), width: 1.75 },
        { label: 'Extensor', stroke: cssVar('--ext'), width: 1.75 },
      ],
      plugins: [repPlugin(reps, tone, active, false)],
    } as uPlot.Options, [tr.t, tr.flex, tr.ext], box2.current!);
    plots.current = [p1, p2];
    const ro = new ResizeObserver(() => {
      const w = Math.max(320, box1.current?.clientWidth ?? width);
      p1.setSize({ width: w, height: 260 });
      p2.setSize({ width: w, height: 200 });
    });
    ro.observe(box1.current!);
    return () => { ro.disconnect(); p1.destroy(); p2.destroy(); plots.current = []; };
  }, [tr, reps, moved, rec.id, rec.direction, tMax]);

  function zoom(min: number, max: number) {
    plots.current[0]?.setScale('x', { min, max });
  }
  function pick(r: TraceRep) {
    active.current = r.n;
    setSel(r.n);
    const pad = Math.max(0.5, (r.t1 - r.t0) * 0.4);
    zoom(Math.max(0, r.t0 - pad), Math.min(tMax, r.t1 + pad));
  }
  function reset() {
    active.current = null;
    setSel(null);
    zoom(0, tMax);
    plots.current.forEach((u) => u.redraw());
  }

  const peaks = reps.map((r) => r.peakDeg);
  const mean = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : NaN;
  const when = new Date(rec.startedAt);
  const name = `${patient?.code ?? 'Recording'}${patient?.displayName ? ` · ${patient.displayName}` : ''}`;

  return (
    <Dialog title={`${name}, ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
      onClose={onClose} width={1100}
      footer={<>
        <button key="csv" type="button" className="btn btn--quiet spacer"
          onClick={() => download(`${patient?.code ?? 'rec'}_${fileStamp(rec.startedAt)}_trace.csv`, traceCsv(rec))}>
          Trace CSV
        </button>
        <button key="close" type="button" className="btn" onClick={onClose}>Close</button>
      </>}>
      <div className="rv">
        <div className="rv-facts">
          <div><span>Direction</span><strong className={rec.direction === 'extension' ? 'ext' : 'flex'}>{rec.direction ?? '—'}</strong></div>
          <div><span>Length</span><strong>{mmss(rec.durationS)}</strong></div>
          <div><span>Reps</span><strong>{reps.length}</strong></div>
          <div><span>Best rep</span><strong>{peaks.length ? `${Math.max(...peaks).toFixed(0)}°` : '—'}</strong></div>
          <div><span>Mean rep</span><strong>{Number.isFinite(mean) ? `${mean.toFixed(0)}°` : '—'}</strong></div>
          <div><span>Rest pose</span><strong className="rv-small">{describe(rest)}</strong></div>
        </div>
        {rec.note && <p className="rv-note">“{rec.note}”</p>}

        {!tr.t.length ? (
          <p className="tab-muted">This recording has no data (nothing was received while it ran).</p>
        ) : (
          <>
            <div className="rv-bar">
              <span className="tab-muted">Drag across a chart to zoom into a time range. Click a rep below to jump to it.</span>
              <button type="button" className="btn btn--quiet btn--sm" onClick={reset} disabled={!zoomed && sel == null}>Show all</button>
            </div>
            <div className="rv-chart" ref={box1} />
            <div className="rv-chart" ref={box2} />
            <table className="tab-table rv-table">
              <thead><tr><th>Rep</th><th>Start</th><th>Peak from rest</th><th>Duration</th><th>Peak speed</th></tr></thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.n} className={sel === r.n ? 'is-sel' : ''} onClick={() => pick(r)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); } }}>
                    <td>{r.n}</td>
                    <td>{r.t0.toFixed(1)} s</td>
                    <td>{r.peakDeg.toFixed(0)}°</td>
                    <td>{(r.t1 - r.t0).toFixed(1)} s</td>
                    <td>{r.peakDps.toFixed(0)}°/s</td>
                  </tr>
                ))}
                {!reps.length && <tr><td colSpan={5} className="tab-muted">No reps found (no movement of {REP_MIN}° or more from rest and back).</td></tr>}
              </tbody>
            </table>
            <p className="tab-muted rv-foot">
              A rep = moving at least {REP_MIN}° further from the last low point and coming back by at least half of that.
              Rest pose = the wrist position in the first 0.5 s of the recording.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
