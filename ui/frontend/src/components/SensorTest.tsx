// Live view of the three raw sensor streams, for the first hook-up of the exo.
// Per sensor: message rate, latest values, and a 5 s scrolling plot. Uses the raw topics
// (not /wrist/state), so it works before the state node or classifier are running.
import { useEffect, useRef, useState } from 'react';
import { raw, type ConnectionState, type EmgBatchSample, type ImuName, type ImuSample } from '../data';
import LiveChart, { type Source, type Trace } from './LiveChart';
import './SensorTest.css';

const RAIL = 4000;
const DEG = 180 / Math.PI;

interface EmgPoint { t: number; flex: number; ext: number }
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

const imuSource = (which: ImuName): Source<ImuSample> => (cb) => raw.onImu(which, cb);
const emgSource: Source<EmgPoint> = (cb) => raw.onEmg((b) => cb({ t: b.t, flex: mean(b.flexor), ext: mean(b.extensor) }));

const GYRO: Trace<ImuSample>[] = [
  { label: 'x', color: '--ink', get: (s) => s.gx * DEG, width: 1.5 },
  { label: 'y', color: '--slate', get: (s) => s.gy * DEG, width: 1.5 },
  { label: 'z', color: '#9aa6b2', get: (s) => s.gz * DEG, width: 1.5 },
];
const EMG: Trace<EmgPoint>[] = [
  { label: 'Flexor', color: '--flex', get: (s) => s.flex },
  { label: 'Extensor', color: '--ext', get: (s) => s.ext },
];

/** Latest message + messages per second, re-rendered 4 times a second. */
function useFeed<T>(subscribe: (cb: (m: T) => void) => () => void) {
  const latest = useRef<T | null>(null);
  const times = useRef<number[]>([]);
  const [view, setView] = useState<{ last: T | null; hz: number }>({ last: null, hz: 0 });
  useEffect(() => {
    const off = subscribe((m) => { latest.current = m; times.current.push(performance.now()); });
    const id = setInterval(() => {
      const now = performance.now();
      times.current = times.current.filter((x) => now - x < 1000);
      setView({ last: latest.current, hz: times.current.length });
    }, 250);
    return () => { off(); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return view;
}

const f = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

function Health({ hz, warn }: { hz: number; warn?: string | null }) {
  const state = hz === 0 ? 'none' : hz < 50 ? 'slow' : warn ? 'warn' : 'ok';
  const text = state === 'none' ? 'No data' : state === 'slow' ? `${hz} msg/s, too slow` : warn ?? `${hz} msg/s`;
  return <span className={`st-health st-health--${state}`}><i aria-hidden="true" />{text}</span>;
}

function ImuCard({ which, title }: { which: ImuName; title: string }) {
  const { last, hz } = useFeed<ImuSample>((cb) => raw.onImu(which, cb));
  const g = last ? Math.hypot(last.ax, last.ay, last.az) : NaN;
  const gWarn = Number.isFinite(g) && Math.abs(g - 9.81) > 1.5 ? `|a| ${g.toFixed(1)} m/s², expected 9.8 at rest` : null;
  return (
    <section className="st-card">
      <header className="st-head"><h3>{title}</h3><Health hz={hz} warn={gWarn} /></header>
      <dl className="st-vals">
        <div><dt>Accel x y z</dt><dd>{f(last?.ax)}  {f(last?.ay)}  {f(last?.az)}<small> m/s²</small></dd></div>
        <div><dt>Gyro x y z</dt><dd>{f(last && last.gx * DEG, 1)}  {f(last && last.gy * DEG, 1)}  {f(last && last.gz * DEG, 1)}<small> °/s</small></dd></div>
      </dl>
      <LiveChart<ImuSample> title="Rotation rate" unit="°/s" traces={GYRO} source={imuSource(which)}
        windowSec={5} height={90} />
    </section>
  );
}

function EmgCard() {
  const { last, hz } = useFeed<EmgBatchSample>((cb) => raw.onEmg(cb));
  const fl = last ? mean(last.flexor) : NaN;
  const ex = last ? mean(last.extensor) : NaN;
  const railed = [fl > RAIL && 'flexor', ex > RAIL && 'extensor'].filter(Boolean);
  return (
    <section className="st-card st-card--wide">
      <header className="st-head">
        <h3>Muscle sensors</h3>
        <Health hz={hz} warn={railed.length ? `${railed.join(' and ')} at maximum` : null} />
      </header>
      <dl className="st-vals">
        <div><dt>Flexor</dt><dd className="flex">{f(fl, 0)}<small> of 4095</small></dd></div>
        <div><dt>Extensor</dt><dd className="ext">{f(ex, 0)}<small> of 4095</small></dd></div>
        <div><dt>Sample rate</dt><dd>{last ? last.rate.toFixed(0) : '—'}<small> Hz</small></dd></div>
      </dl>
      <LiveChart<EmgPoint> title="Muscle activity" unit="sensor level" traces={EMG} source={emgSource}
        windowSec={5} height={110} range={[0, 4095]} ySplits={[0, 1000, 2000, 3000, 4000]} />
      <p className="st-tip">Ask the patient to squeeze, then lift the hand back: the matching channel should rise.</p>
    </section>
  );
}

export default function SensorTest() {
  const [conn, setConn] = useState<ConnectionState>(raw.connection);
  useEffect(() => raw.onConnection(setConn), []);
  return (
    <div className="st">
      <p className={`st-link st-link--${conn}`} role="status">
        <i aria-hidden="true" />
        {conn === 'connected' ? 'Receiving from ' : conn === 'connecting' ? 'Connecting to ' : 'Not connected to '}
        <span>{raw.label}</span>
        {conn === 'disconnected' && ' (retrying every 2 s)'}
      </p>
      <div className="st-grid">
        <ImuCard which="hand" title="Hand sensor" />
        <ImuCard which="forearm" title="Forearm sensor" />
        <EmgCard />
      </div>
    </div>
  );
}
