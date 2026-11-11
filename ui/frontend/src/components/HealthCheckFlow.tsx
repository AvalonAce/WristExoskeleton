// Guided Health Check (see the usage guide). Order:
//   Setup: reference wrist, PRWE total, pain now
//   For each block (reference wrist flexion, extension, then treated wrist flexion, extension):
//     Fit + calibrate (SetSetupFlow, direction and spring fixed)
//     Range   3 slow reps to end range, goniometer reading per rep
//     Pace    5 reps at a comfortable speed
//     Loaded  as many full reps as comfortable in 30 s
//     Pain    0-10
//   The visit is saved after every block; each test step is recorded as its own rosbag.
import { useEffect, useRef, useState } from 'react';
import {
  api, control, recorder, stream,
  type HcBlock, type HcEmg, type HcRep, type HcRole, type HealthCheck, type Patient, type SetMode, type Side,
} from '../data';
import { newId } from '../data/mockApi';
import { RepTracker } from '../lib/healthMetrics';
import Dialog from './Dialog';
import SetSetupFlow, { type SetStart } from './SetSetupFlow';
import './PatientForm.css';
import './SetSetupFlow.css';
import './HealthCheckFlow.css';

const SPRING = 1; // fixed for the whole Health Check (lowest setting; also the loaded test)
const RANGE_REPS = 3;
const PACE_REPS = 5;
const LOADED_S = 30;

type Test = 'range' | 'pace' | 'loaded';
type Phase = 'intro' | 'fit' | Test | 'pain' | 'done';

interface Plan { side: Side; role: HcRole; mode: SetMode }

const other = (s: Side): Side => (s === 'R' ? 'L' : 'R');
const wristName = (s: Side) => (s === 'R' ? 'right' : 'left');
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

function planFor(treated: Side, ref: Side | null): Plan[] {
  const sides: { side: Side; role: HcRole }[] = ref ? [{ side: ref, role: 'reference' }] : [];
  sides.push({ side: treated, role: 'treated' });
  return sides.flatMap((x) => (['flexion', 'extension'] as SetMode[]).map((mode) => ({ ...x, mode })));
}

const stamp = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
  `_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

function mergeEmg(parts: (HcEmg & { n: number })[]): HcEmg | null {
  const n = parts.reduce((a, p) => a + p.n, 0);
  if (!n) return null;
  const agonist = parts.reduce((a, p) => a + p.agonist * p.n, 0) / n;
  const antagonist = parts.reduce((a, p) => a + p.antagonist * p.n, 0) / n;
  return { agonist, antagonist, ratio: agonist > 0 ? antagonist / agonist : NaN };
}

interface Props {
  patient: Patient;
  onClose: (saved: HealthCheck | null) => void;
}

export default function HealthCheckFlow({ patient, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [refSide, setRefSide] = useState<Side | null>(other(patient.side));
  const [prwe, setPrwe] = useState('');
  const [painStart, setPainStart] = useState<number | null>(null);
  const [hc, setHc] = useState<HealthCheck | null>(null);
  const [bi, setBi] = useState(0); // block index
  const [block, setBlock] = useState<HcBlock | null>(null);
  const [warn, setWarn] = useState('');
  const plan = hc ? planFor(patient.side, hc.referenceSide) : planFor(patient.side, refSide);
  const cur = plan[bi];

  // ---- live test step: rep tracker + rosbag ---------------------------------------
  const tracker = useRef<RepTracker | null>(null);
  const emgParts = useRef<(HcEmg & { n: number })[]>([]);
  const [reps, setReps] = useState<HcRep[]>([]);
  const [exc, setExc] = useState(0);
  const [moving, setMoving] = useState(false);
  const [loadedEnd, setLoadedEnd] = useState<number | null>(null); // ms when the 30 s ends
  const [now, setNow] = useState(Date.now());
  const loadedOn = useRef(false);
  const [attempt, setAttempt] = useState(0); // Redo bumps this to restart the test

  const testPhase = phase === 'range' || phase === 'pace' || phase === 'loaded';

  useEffect(() => {
    if (!testPhase || !cur) return;
    const tr = new RepTracker(cur.mode);
    tracker.current = tr;
    setReps([]);
    const max = phase === 'range' ? RANGE_REPS : phase === 'pace' ? PACE_REPS : Infinity;
    let count = 0;
    const unsub = stream.subscribe((s) => {
      if (phase === 'loaded' && !loadedOn.current) return;
      if (count >= max) return;
      const r = tr.push(s);
      if (r) { count += 1; setReps((xs) => [...xs, r]); }
    });
    const ui = setInterval(() => { setExc(tr.excursion); setMoving(tr.moving); }, 100);
    return () => { unsub(); clearInterval(ui); };
  }, [phase, bi, attempt, testPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Keep the EMG of the test just finished (a redone attempt is dropped). */
  function commitEmg() {
    const tr = tracker.current;
    const e = tr?.emg();
    if (tr && e) emgParts.current.push({ ...e, n: tr.emgN });
    tracker.current = null;
  }

  // Countdown for the loaded test.
  useEffect(() => {
    if (loadedEnd == null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= loadedEnd) { loadedOn.current = false; clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [loadedEnd]);
  const left = loadedEnd == null ? LOADED_S : Math.max(0, (loadedEnd - now) / 1000);
  const loadedDone = loadedEnd != null && left <= 0;

  async function startBag(test: Test, b: HcBlock): Promise<HcBlock> {
    if (!recorder.available || !hc) return b;
    try {
      const name = await recorder.start(`${patient.code}_${stamp(new Date(hc.startedAt))}_${b.side}_${b.mode}_${test}`);
      setWarn('');
      return name ? { ...b, bags: [...b.bags, name] } : b;
    } catch (e) {
      setWarn(`Raw data is not being recorded: ${(e as Error).message}`);
      return b;
    }
  }

  // ---- step transitions ---------------------------------------------------------
  async function begin() {
    const h: HealthCheck = {
      id: newId('h'), patientId: patient.id, startedAt: new Date().toISOString(), endedAt: null,
      referenceSide: refSide, prwe: prwe.trim() === '' ? null : Math.round(Number(prwe)),
      painBaseline: painStart, notes: '', blocks: [],
    };
    await api.saveHealthCheck(h);
    setHc(h);
    setBi(0);
    setPhase('fit');
  }

  async function fitted(st: SetStart) {
    emgParts.current = [];
    const b: HcBlock = {
      side: cur.side, role: cur.role, mode: cur.mode, springSetting: st.springSetting, startDeg: st.startDeg,
      startedAt: new Date().toISOString(), endedAt: null, range: [], pace: [], loaded: null, emg: null,
      pain: null, bags: [], complete: false,
    };
    setBlock(await startBag('range', b));
    setPhase('range');
  }

  async function nextTest() {
    if (!block) return;
    commitEmg();
    await recorder.stop();
    if (phase === 'range') {
      const b = { ...block, range: reps.map((r, i) => ({ ...r, gonioDeg: gonio[i] ?? null })) };
      setBlock(await startBag('pace', b));
      setPhase('pace');
    } else if (phase === 'pace') {
      const b = { ...block, pace: reps };
      setLoadedEnd(null);
      loadedOn.current = false;
      setBlock(await startBag('loaded', b));
      setPhase('loaded');
    } else if (phase === 'loaded') {
      setBlock({
        ...block,
        loaded: { durationS: LOADED_S, reps: reps.length, bestDeg: reps.length ? Math.max(...reps.map((r) => r.peakDeg)) : 0 },
      });
      setPhase('pain');
    }
  }

  async function saveBlock(pain: number) {
    if (!block || !hc) return;
    const b: HcBlock = { ...block, pain, emg: mergeEmg(emgParts.current), endedAt: new Date().toISOString(), complete: true };
    const last = bi + 1 >= plan.length;
    const h: HealthCheck = { ...hc, blocks: [...hc.blocks, b], endedAt: last ? new Date().toISOString() : null };
    await api.saveHealthCheck(h);
    setHc(h);
    setBlock(null);
    if (last) { control.setMode('none'); setPhase('done'); }
    else { setBi(bi + 1); setPhase('fit'); }
  }

  /** Stop early: keep finished blocks, and the current one marked incomplete if it has data. */
  async function stopEarly() {
    if (testPhase) commitEmg();
    await recorder.stop();
    control.setMode('none');
    if (!hc) return onClose(null);
    let blocks = hc.blocks;
    if (block) {
      const partial: HcBlock = {
        ...block,
        range: block.range.length || phase !== 'range' ? block.range : reps.map((r, i) => ({ ...r, gonioDeg: gonio[i] ?? null })),
        pace: block.pace.length || phase !== 'pace' ? block.pace : reps,
        emg: mergeEmg(emgParts.current), endedAt: new Date().toISOString(), complete: false,
      };
      if (partial.range.length) blocks = [...blocks, partial];
    }
    const h = { ...hc, blocks, endedAt: new Date().toISOString() };
    if (!blocks.length) { await api.deleteHealthCheck(hc.id); return onClose(null); }
    await api.saveHealthCheck(h);
    onClose(h);
  }

  // Goniometer readings for the range reps (typed in by the therapist).
  const [gonio, setGonio] = useState<(number | null)[]>([]);
  useEffect(() => { if (phase === 'range') setGonio([]); }, [phase, bi]);

  // ---- render -------------------------------------------------------------------
  if (phase === 'fit' && cur) {
    return (
      <SetSetupFlow
        key={bi}
        patient={patient}
        fixed={{
          mode: cur.mode, spring: SPRING, side: cur.side,
          title: `Block ${bi + 1} of ${plan.length}: ${wristName(cur.side)} wrist, ${cur.mode}`,
          startLabel: 'Start range test',
        }}
        setNumber={bi + 1}
        defaultMode={cur.mode}
        springDefault={() => SPRING}
        onCancel={stopEarly}
        onStart={fitted}
      />
    );
  }

  const progress = hc && (
    <ol className="hc-blocks" aria-label="Blocks">
      {plan.map((x, i) => (
        <li key={i} className={i < hc.blocks.length ? 'is-done' : i === bi && phase !== 'done' ? 'is-now' : ''}>
          <span className={`hc-dot hc-dot--${x.mode}`} aria-hidden="true" />
          {cap(wristName(x.side))} {x.mode}
          <small>{x.role}</small>
        </li>
      ))}
    </ol>
  );

  const repTable = (withGonio: boolean, max: number) => (
    <table className="hc-reps">
      <thead>
        <tr><th>Rep</th><th>Range (IMU)</th>{withGonio && <th>Goniometer</th>}<th>Peak speed</th><th>Smoothness</th></tr>
      </thead>
      <tbody>
        {Array.from({ length: Number.isFinite(max) ? max : Math.max(reps.length, 1) }, (_, i) => {
          const r = reps[i];
          return (
            <tr key={i} className={r ? '' : 'is-empty'}>
              <td>{i + 1}</td>
              <td>{r ? `${r.peakDeg.toFixed(0)}°` : i === reps.length ? (moving ? 'moving…' : 'waiting') : ''}</td>
              {withGonio && (
                <td>
                  <input className="hc-num" type="number" inputMode="numeric" min={0} max={120} disabled={!r}
                    aria-label={`Goniometer reading, rep ${i + 1}`}
                    value={gonio[i] ?? ''} placeholder="°"
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      setGonio((g) => { const c = [...g]; c[i] = v; return c; });
                    }} />
                </td>
              )}
              <td>{r ? `${r.peakDps.toFixed(0)}°/s` : ''}</td>
              <td>{r?.sparc != null ? r.sparc.toFixed(2) : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const meter = cur && (
    <div className="hc-meter" aria-hidden="true">
      <div className={`hc-meter-fill hc-meter-fill--${cur.mode}`} style={{ width: `${Math.min(100, (exc / 90) * 100)}%` }} />
      <span>{exc.toFixed(0)}° from start pose</span>
    </div>
  );

  let title = 'Health check';
  let body: JSX.Element | null = null;
  let footer: JSX.Element | null = null;
  const stopBtn = (
    <button key="stop" type="button" className="btn btn--quiet spacer" onClick={stopEarly}>
      {hc ? 'Stop and keep finished blocks' : 'Cancel'}
    </button>
  );

  if (phase === 'intro') {
    title = `Health check for ${patient.displayName}`;
    const prweBad = prwe.trim() !== '' && !(Number(prwe) >= 0 && Number(prwe) <= 100);
    body = (
      <div className="ssf-pane">
        <p className="ssf-lead">
          Four blocks, about 20–25 minutes. Each wrist does flexion then extension: range (3 reps with
          the goniometer), comfortable pace (5 reps), 30 s at spring {SPRING}, then pain 0–10.
        </p>
        <div className="pf-field">
          <span className="ssf-label">Reference wrist (tested first)</span>
          <div className="seg seg--wide" role="radiogroup">
            <button type="button" role="radio" aria-checked={refSide === other(patient.side)}
              className={refSide === other(patient.side) ? 'is-on' : ''} onClick={() => setRefSide(other(patient.side))}>
              <strong>{cap(wristName(other(patient.side)))} wrist</strong><small>the other wrist; uninjured</small>
            </button>
            <button type="button" role="radio" aria-checked={refSide === null}
              className={refSide === null ? 'is-on' : ''} onClick={() => setRefSide(null)}>
              <strong>None</strong><small>both wrists injured: compare to the 40° functional line only</small>
            </button>
          </div>
          <p className="tab-muted">
            Treated wrist: <strong>{wristName(patient.side)}</strong> (from the profile).
          </p>
        </div>
        <div className="hc-row">
          <label className="pf-field">
            <span className="ssf-label">PRWE total, 0–100 (optional)</span>
            <input className="hc-num hc-num--wide" type="number" min={0} max={100} value={prwe}
              onChange={(e) => setPrwe(e.target.value)} placeholder="from the paper form" />
            {prweBad && <span className="sts-error">Enter 0–100, or leave empty.</span>}
          </label>
          <div className="pf-field">
            <span className="ssf-label">Pain right now, 0–10</span>
            <PainScale value={painStart} onPick={setPainStart} />
          </div>
        </div>
        {warn && <p className="sts-error">{warn}</p>}
      </div>
    );
    footer = (
      <>
        {stopBtn}
        <button key="begin" type="button" className="btn" disabled={prweBad || painStart == null} onClick={begin}>Begin block 1</button>
      </>
    );
  } else if (testPhase && cur) {
    const label = { range: 'Active range', pace: 'Comfortable pace', loaded: 'Loaded, 30 s' }[phase];
    title = `Block ${bi + 1} of ${plan.length}: ${wristName(cur.side)} wrist, ${cur.mode} · ${label}`;
    const tip = {
      range: `Slowly move as far as you can into ${cur.mode}, hold a moment for the goniometer, then relax back. ${RANGE_REPS} reps.`,
      pace: `Move into ${cur.mode} and back at a comfortable, natural speed. ${PACE_REPS} reps.`,
      loaded: `Spring ${SPRING}. As many full reps into ${cur.mode} as is comfortable, until the timer ends.`,
    }[phase];
    const gonioOk = reps.every((_, i) => gonio[i] != null && Number.isFinite(gonio[i]));
    const ready = phase === 'range' ? reps.length >= RANGE_REPS && gonioOk
      : phase === 'pace' ? reps.length >= PACE_REPS : loadedDone;
    body = (
      <div className="ssf-pane">
        {progress}
        <p className="ssf-lead">{tip}</p>
        {phase === 'loaded' && (
          <div className="hc-timer" role="timer" aria-live="off">
            <strong>{Math.ceil(left)}</strong><span>s left</span>
            <span className="hc-timer-reps">{reps.length} {reps.length === 1 ? 'rep' : 'reps'}</span>
          </div>
        )}
        {meter}
        {phase !== 'loaded' && repTable(phase === 'range', phase === 'range' ? RANGE_REPS : PACE_REPS)}
        {phase === 'range' && reps.length >= RANGE_REPS && !gonioOk && (
          <p className="tab-muted">Type the goniometer reading for each rep to continue.</p>
        )}
        {warn && <p className="sts-error">{warn}</p>}
      </div>
    );
    footer = (
      <>
        {stopBtn}
        <button key="redo" type="button" className="btn btn--quiet"
          onClick={() => { setGonio([]); setLoadedEnd(null); loadedOn.current = false; setAttempt((a) => a + 1); }}>
          Redo
        </button>
        {phase === 'loaded' && loadedEnd == null ? (
          <button key="go" type="button" className="btn" onClick={() => { loadedOn.current = true; setNow(Date.now()); setLoadedEnd(Date.now() + LOADED_S * 1000); }}>
            Start 30 s
          </button>
        ) : (
          <button key="next" type="button" className="btn" disabled={!ready} onClick={nextTest}>
            {phase === 'range' ? 'Next: pace' : phase === 'pace' ? 'Next: loaded' : 'Next: pain'}
          </button>
        )}
      </>
    );
  } else if (phase === 'pain' && cur) {
    title = `Block ${bi + 1} of ${plan.length}: ${wristName(cur.side)} wrist, ${cur.mode} · Pain`;
    const before = hc?.blocks[hc.blocks.length - 1]?.pain ?? hc?.painBaseline ?? null;
    body = (
      <div className="ssf-pane">
        {progress}
        <p className="ssf-lead">Ask: “How much does the wrist hurt right now, 0 = none, 10 = worst imaginable?”</p>
        <PainScale value={null} onPick={(v) => saveBlock(v)} />
        <p className="tab-muted">
          Picking a number saves this block. {before != null && `Before: ${before}. `}
          Stop the visit if pain has risen by 3 or more, or the person asks.
        </p>
      </div>
    );
    footer = stopBtn;
  } else if (phase === 'done') {
    title = 'Health check saved';
    body = (
      <div className="ssf-pane">
        {progress}
        <p className="ssf-lead">All {plan.length} blocks are saved. The results are in the Health check tab.</p>
      </div>
    );
    footer = <button key="close" type="button" className="btn" onClick={() => onClose(hc)}>See results</button>;
  }

  return (
    <Dialog title={title} onClose={stopEarly} locked footer={footer} width={720}>
      {body}
    </Dialog>
  );
}

function PainScale({ value, onPick }: { value: number | null; onPick: (v: number) => void }) {
  return (
    <div className="hc-pain" role="radiogroup" aria-label="Pain 0 to 10">
      {Array.from({ length: 11 }, (_, i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i}
          className={value === i ? 'is-on' : ''} onClick={() => onPick(i)}>{i}</button>
      ))}
    </div>
  );
}
