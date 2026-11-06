// Scrolling chart of the last `windowSec` seconds of a sample stream, drawn with uPlot.
// Defaults to the WristState stream; pass `source` to plot anything with a `t` (seconds).
// Samples are buffered as they arrive; the plot redraws once per animation frame.
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { stream, type WristState } from '../data';
import './LiveChart.css';

/** Subscribe to timestamped samples; returns an unsubscribe function. */
export type Source<T> = (cb: (s: T) => void) => () => void;

export interface Trace<T = WristState> {
  label: string;
  color: string;
  get: (s: T) => number;
  dash?: number[];
  width?: number;
  /** Draw values above 0 in the first color and below 0 in the second (CSS vars). */
  signColors?: [string, string];
}

interface Props<T> {
  title: string;
  unit: string;
  traces: Trace<T>[];
  source?: Source<T>;
  windowSec?: number;
  height?: number;
  range?: [number, number]; // fixed y range; omit for auto
  ySplits?: number[]; // fixed y gridlines/labels
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const color = (c: string) => (c.startsWith('--') ? cssVar(c) : c);

/** Vertical gradient: above +band in `pos`, below -band in `neg`, neutral in between. */
function signStroke(pos: string, neg: string, mid: string, band = 2) {
  return (u: uPlot) => {
    const { top, height } = u.bbox;
    const f = (v: number) => Math.min(1, Math.max(0, (u.valToPos(v, 'y', true) - top) / height));
    const hi = f(band);
    const lo = f(-band);
    const g = u.ctx.createLinearGradient(0, top, 0, top + height);
    g.addColorStop(0, pos); g.addColorStop(hi, pos); g.addColorStop(hi, mid);
    g.addColorStop(lo, mid); g.addColorStop(lo, neg); g.addColorStop(1, neg);
    return g;
  };
}

const defaultSource = ((cb: (s: WristState) => void) => stream.subscribe(cb)) as Source<unknown>;

export default function LiveChart<T extends { t: number } = WristState>({
  title, unit, traces, source, windowSec = 10, height = 130, range, ySplits,
}: Props<T>) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current!;
    const xs: number[] = [];
    const ys: number[][] = traces.map(() => []);
    const slate = cssVar('--slate');
    const grid = cssVar('--hairline');

    const opts: uPlot.Options = {
      width: el.clientWidth,
      height,
      legend: { show: false },
      cursor: { show: false },
      scales: {
        x: { time: false, range: [-windowSec, 0] },
        y: range ? { range } : { auto: true },
      },
      axes: [
        { stroke: slate, grid: { stroke: grid, width: 1 }, ticks: { show: false },
          splits: () => Array.from({ length: Math.floor(windowSec / 2) + 1 }, (_, i) => -windowSec + 2 * i),
          values: (_u, v) => v.map((x) => (x === 0 ? 'now' : `${-x} s ago`)), size: 28,
          font: '12px "Schibsted Grotesk Variable", sans-serif' },
        { stroke: slate, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 44, space: 22,
          ...(ySplits ? { splits: () => ySplits } : {}),
          font: '12px "Schibsted Grotesk Variable", sans-serif' },
      ],
      series: [{}, ...traces.map((t) => ({
        stroke: t.signColors ? signStroke(color(t.signColors[0]), color(t.signColors[1]), color(t.color)) : color(t.color),
        width: t.width ?? 2, dash: t.dash, points: { show: false },
      }))],
    };
    const plot = new uPlot(opts, [[], ...traces.map(() => [])], el);

    const sub = (source ?? defaultSource) as Source<T>;
    const unsub = sub((s) => {
      xs.push(s.t);
      traces.forEach((t, i) => ys[i].push(t.get(s)));
      const cut = s.t - windowSec - 0.5;
      let k = 0;
      while (k < xs.length && xs[k] < cut) k++;
      if (k) { xs.splice(0, k); ys.forEach((y) => y.splice(0, k)); }
    });

    let raf = 0;
    const draw = () => {
      if (xs.length) {
        const t0 = xs[xs.length - 1];
        plot.setData([xs.map((x) => x - t0), ...ys.map((y) => y.slice())]);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => { unsub(); cancelAnimationFrame(raf); ro.disconnect(); plot.destroy(); };
    // traces are static per chart instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSec, height]);

  return (
    <div className="lc">
      <div className="lc-head">
        <span className="lc-title">{title}</span>
        <span className="lc-keys">
          {traces.filter((t) => !t.dash).map((t) => (
            <span key={t.label} className="lc-key">
              <i style={{ background: t.signColors
                ? `linear-gradient(90deg, var(${t.signColors[0]}) 50%, var(${t.signColors[1]}) 50%)`
                : t.color.startsWith('--') ? `var(${t.color})` : t.color }} />{t.label}
            </span>
          ))}
          <span className="lc-unit">{unit}</span>
        </span>
      </div>
      <div ref={box} className="lc-plot" />
    </div>
  );
}
