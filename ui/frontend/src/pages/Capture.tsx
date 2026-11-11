// Class-demo capture: sign in -> this screen. Pick or add a participant, set neutral, Record,
// Stop. Each recording saves its numbers, a 20 Hz trace, and (live mode) a rosbag.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AngleDial from '../components/AngleDial';
import Dialog from '../components/Dialog';
import LiveChart, { type Trace } from '../components/LiveChart';
import RecordingViewer from '../components/RecordingViewer';
import { api, recorder, stream, type Patient, type Recording, type SetMode, type Side } from '../data';
import { newId } from '../data/mockApi';
import { runCalibStep, setModeConfirmed } from '../hooks/exoCommands';
import { useWristState } from '../hooks/useWristState';
import { currentUser, signOut } from '../lib/auth';
import { Capture as Cap, download, fileStamp, summaryCsv, traceCsv, type CaptureNumbers } from '../lib/capture';
import '../components/PatientForm.css';
import '../components/StartSessionFlow.css';
import './tabs/tabs.css';
import './Dashboard.css';
import './Capture.css';

const SIGN_KEY = 'wrist-exo-angle-sign';
const DIR_KEY = 'wrist-exo-capture-dir';
const loadDir = (): SetMode => { try { return localStorage.getItem(DIR_KEY) === 'extension' ? 'extension' : 'flexion'; } catch { return 'flexion'; } };
const loadSign = (): 1 | -1 => { try { return localStorage.getItem(SIGN_KEY) === '-1' ? -1 : 1; } catch { return 1; } };

const describe = (a: number) =>
  !Number.isFinite(a) ? '—' : Math.abs(a) < 2 ? 'straight' : `${Math.abs(a).toFixed(0)}° ${a > 0 ? 'flexion' : 'extension'}`;
const d0 = (v: number) => (Number.isFinite(v) ? v.toFixed(0) : '—');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type Neutral = 'none' | 'holding' | 'done' | 'failed';

export default function CapturePage() {
  const navigate = useNavigate();
  const user = currentUser();
  const [people, setPeople] = useState<Patient[] | null>(null);
  const [sel, setSel] = useState('');
  const [adding, setAdding] = useState(false);
  const [recs, setRecs] = useState<Recording[]>([]);
  const [allRecs, setAllRecs] = useState<Recording[]>([]);
  const [sign, setSign] = useState<1 | -1>(loadSign);
  const [dir, setDir] = useState<SetMode>(loadDir);
  const [neutral, setNeutral] = useState<Neutral>('none');
  const [note, setNote] = useState('');
  const [rec, setRec] = useState<{ startedAt: string; bag: string | null; neutralSet: boolean } | null>(null);
  const [nums, setNums] = useState<CaptureNumbers | null>(null);
  const [bagWarn, setBagWarn] = useState('');
  const [viewing, setViewing] = useState<Recording | null>(null);
  const cap = useRef<Cap | null>(null);
  const { state: s, connection } = useWristState(15);
  // Rest pose for the dial (node angle, deg): set at Record, else the first reading.
  // Stored unflipped, and the dial shows |angle - rest|, so Flip direction doesn't affect it.
  const [rest, setRest] = useState<number | null>(null);
  const peakMoved = useRef(0);
  const [peak, setPeak] = useState<number | null>(null);
  useEffect(() => {
    if (rest == null && s && Number.isFinite(s.angle_deg)) setRest(s.angle_deg);
  }, [rest, s]);

  const p = people?.find((x) => x.id === sel);

  const loadPeople = useCallback(async (select?: string) => {
    const ps = await api.listPatients();
    setPeople(ps);
    setSel((cur) => select ?? (ps.some((x) => x.id === cur) ? cur : ps[0]?.id ?? ''));
  }, []);
  const loadRecs = useCallback(async () => {
    const all = await api.listRecordings();
    setAllRecs(all);
    setRecs(all.filter((r) => r.patientId === sel));
  }, [sel]);
  useEffect(() => { loadPeople(); }, [loadPeople]);
  useEffect(() => { loadRecs(); }, [loadRecs]);

  // Free movement in both directions: make sure no one-direction set is active on the node.
  useEffect(() => { setModeConfirmed('none'); }, []);

  // Feed the running capture while recording.
  useEffect(() => {
    if (!rec) return;
    const unsub = stream.subscribe((x) => {
      cap.current?.push(x);
      if (rest != null && Number.isFinite(x.angle_deg)) peakMoved.current = Math.max(peakMoved.current, Math.abs(x.angle_deg - rest));
    });
    const ui = setInterval(() => {
      if (cap.current) setNums({ ...cap.current.nums });
      setPeak(peakMoved.current);
    }, 200);
    return () => { unsub(); clearInterval(ui); };
  }, [rec]);

  function flip() {
    const n = (sign === 1 ? -1 : 1) as 1 | -1;
    setSign(n);
    try { localStorage.setItem(SIGN_KEY, String(n)); } catch { /* ignore */ }
  }

  function pickDir(d: SetMode) {
    setDir(d);
    try { localStorage.setItem(DIR_KEY, d); } catch { /* ignore */ }
  }

  async function setNeutralNow() {
    setNeutral('holding');
    const r = await runCalibStep('neutral');
    setNeutral(r.ok ? 'done' : 'failed');
    if (r.ok) setRest(null); // the angle's zero moved: take the rest pose again
  }

  async function start() {
    if (!p) return;
    const startedAt = new Date().toISOString();
    cap.current = new Cap(sign);
    setNums(null);
    if (s && Number.isFinite(s.angle_deg)) setRest(s.angle_deg); // dial measures from here
    peakMoved.current = 0;
    setPeak(null);
    let bag: string | null = null;
    setBagWarn('');
    if (recorder.available) {
      try { bag = await recorder.start(`${p.code}_${fileStamp(startedAt)}`); }
      catch (e) { setBagWarn(`Raw rosbag not recording: ${(e as Error).message}. Numbers and trace still save.`); }
    }
    setRec({ startedAt, bag, neutralSet: neutral === 'done' });
  }

  async function stop() {
    if (!p || !rec || !cap.current) return;
    await recorder.stop();
    const c = cap.current;
    const r: Recording = {
      id: newId('r'), patientId: p.id, startedAt: rec.startedAt, note: note.trim(), direction: dir,
      ...c.nums, angleSign: sign, neutralSet: rec.neutralSet, bag: rec.bag, trace: c.trace,
    };
    cap.current = null;
    setRec(null);
    await api.saveRecording(r);
    setNote('');
    await loadRecs();
  }

  async function addPerson(np: { code: string; displayName: string; side: Side; notes: string }) {
    const created = await api.createPatient({
      ...np, springFlex: 1, springExt: 1, romGoalFlexDeg: 60, romGoalExtDeg: 50,
    });
    setAdding(false);
    await loadPeople(created.id);
  }

  const angle = s ? sign * s.angle_deg : NaN;
  const angleTraces: Trace[] = [{ label: 'Angle', color: '--ink', get: (x) => sign * x.angle_deg, signColors: ['--flex', '--ext'] }];
  const emgTraces: Trace[] = [
    { label: 'Flexor', color: '--flex', get: (x) => x.emg_flex, width: 2 },
    { label: 'Extensor', color: '--ext', get: (x) => x.emg_ext, width: 2 },
    { label: 'Flexor threshold', color: '--flex', get: (x) => x.emg_flex_thresh, dash: [4, 4], width: 1 },
    { label: 'Extensor threshold', color: '--ext', get: (x) => x.emg_ext_thresh, dash: [4, 4], width: 1 },
  ];
  const st = api.storage;
  const recording = rec != null;
  const nextCode = (() => {
    const ns = (people ?? []).map((x) => parseInt(x.code.replace(/\D/g, ''), 10)).filter(Number.isFinite);
    return `P-${String((ns.length ? Math.max(...ns) : 0) + 1).padStart(3, '0')}`;
  })();

  return (
    <div className="dash">
      <aside className="rail panel">
        <span className="rail-brand">Wrist Exo</span>
        <ul className="rail-list">
          {(people ?? []).map((x) => (
            <li key={x.id}>
              <button className={`rail-item ${x.id === sel ? 'is-active' : ''}`} disabled={recording && x.id !== sel}
                onClick={() => setSel(x.id)}>
                <span className="rail-name">{x.code}{x.displayName ? ` · ${x.displayName}` : ''}</span>
                <span className="rail-meta"><span>{x.side === 'R' ? 'Right' : 'Left'} wrist</span>
                  <span>{allRecs.filter((r) => r.patientId === x.id).length} rec.</span></span>
              </button>
            </li>
          ))}
          {people && !people.length && <li className="rail-empty">No participants yet.</li>}
        </ul>
        <button className="btn btn--quiet rail-add" onClick={() => setAdding(true)} disabled={recording}>+ New participant</button>
        <button className="btn btn--quiet rail-add cap-export" disabled={!allRecs.length}
          onClick={() => download(`exo_recordings_${fileStamp(new Date().toISOString())}.csv`, summaryCsv(allRecs, people ?? []))}>
          Export all CSV
        </button>
        <div className="rail-user">
          <span className="rail-user-name">{user?.name ?? 'Signed in'}</span>
          <button className="rail-signout" disabled={recording} onClick={() => { signOut(); navigate('/signin', { replace: true }); }}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="work cap">
        <header className="cap-head panel">
          <div className="cap-who">
            <h1>{p ? `${p.code}${p.displayName ? ` · ${p.displayName}` : ''}` : 'Live'}</h1>
            <p className="work-meta">
              {p && <span>{p.side === 'R' ? 'Right' : 'Left'} wrist</span>}
              <span className={`cap-conn cap-conn--${connection}`}><i aria-hidden="true" />{connection}</span>
              <span>{st.label}</span>
            </p>
          </div>
          <div className="cap-angle" aria-live="off">
            <strong className={angle > 2 ? 'flex' : angle < -2 ? 'ext' : ''}>{describe(angle)}</strong>
            <span>flexor {d0(s?.emg_flex ?? NaN)} · extensor {d0(s?.emg_ext ?? NaN)}</span>
          </div>
        </header>
        {st.error && <p className="sts-error">{st.error}</p>}

        <section className="panel cap-controls" aria-label="Controls">
          <div className="cap-step">
            <button className="btn btn--quiet" onClick={setNeutralNow} disabled={recording || neutral === 'holding'}>
              {neutral === 'holding' ? 'Hold straight…' : 'Set neutral'}
            </button>
            <small>{neutral === 'done' ? 'Neutral set.' : neutral === 'failed' ? 'No response; try again.'
              : neutral === 'holding' ? 'Keep the wrist straight and still, 2 s.' : 'Wrist straight, in line with the forearm.'}</small>
          </div>
          <div className="cap-step">
            <button className="btn btn--quiet" onClick={flip} disabled={recording}>Flip direction</button>
            <small>Use if bending toward the palm reads as extension.</small>
          </div>
          <label className="cap-note">
            <span className="ssf-label">Note for this recording</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. max range both ways, 5 reps" />
          </label>
          {recording ? (
            <button className="btn cap-rec is-on" onClick={stop}><i aria-hidden="true" />Stop · {mmss(nums?.durationS ?? 0)}</button>
          ) : (
            <button className="btn cap-rec" onClick={start} disabled={!p} title={p ? undefined : 'Add or pick a participant first'}>
              <i aria-hidden="true" />Record
            </button>
          )}
        </section>
        {bagWarn && <p className="sts-error">{bagWarn}</p>}

        {recording && nums && (
          <section className="panel cap-nums" aria-label="This recording">
            <div><span>Max flexion</span><strong className="flex">{d0(nums.maxFlexDeg)}°</strong></div>
            <div><span>Max extension</span><strong className="ext">{d0(nums.maxExtDeg)}°</strong></div>
            <div><span>Peak speed</span><strong>{d0(nums.peakDps)}°/s</strong></div>
            <div><span>Reps flex / ext</span><strong>{nums.flexReps} / {nums.extReps}</strong></div>
            <div><span>EMG peak flex / ext</span><strong>{d0(nums.emgFlexPeak)} / {d0(nums.emgExtPeak)}</strong></div>
          </section>
        )}

        <div className="cap-live">
        <section className="panel cap-dial" aria-label="Live angle">
          <div className="seg seg--wide cap-dir" role="radiogroup" aria-label="Direction">
            {(['flexion', 'extension'] as SetMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={dir === m} disabled={recording}
                className={`${dir === m ? 'is-on' : ''} cap-dir--${m}`} onClick={() => pickDir(m)}>
                <strong>{m === 'flexion' ? 'Flexion' : 'Extension'}</strong>
              </button>
            ))}
          </div>
          <AngleDial mode={dir} moved={s && rest != null ? Math.abs(s.angle_deg - rest) : NaN}
            peak={recording ? peak : null} />
          <p className="cap-rest">
            Measured from the rest pose{rest != null ? ` (${describe(sign * rest)})` : ''}, taken when you press Record.{' '}
            <button type="button" className="cap-link" disabled={recording || !s}
              onClick={() => s && setRest(s.angle_deg)}>Reset rest</button>
          </p>
        </section>

        <section className="panel panel--charts" aria-label="Live signals">
          <LiveChart key={`a${sign}`} title="Wrist angle" unit="degrees, flexion up" traces={angleTraces}
            range={[-90, 90]} ySplits={[-60, -30, 0, 30, 60]} height={190} />
          <LiveChart title="Muscle activity" unit="EMG envelope, sensor level" traces={emgTraces} height={160} />
        </section>
        </div>

        <section className="panel">
          <div className="tab-head">
            <h2>Recordings{p ? ` · ${p.code}` : ''}</h2>
          </div>
          {!recs.length && <p className="tab-muted">{p ? 'None yet. Press Record.' : 'Pick or add a participant.'}</p>}
          {!!recs.length && (
            <table className="tab-table cap-table">
              <thead>
                <tr><th>Started</th><th>Direction</th><th>Length</th><th>Note</th><th>Max flex</th><th>Max ext</th><th>Peak speed</th>
                  <th>Reps f / e</th><th>EMG peak f / e</th><th /></tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      {!r.neutralSet && <small className="tab-muted" title="Set neutral was not done; angle zero is the node's start-up auto-zero"> auto-zero</small>}</td>
                    <td className={r.direction === 'extension' ? 'ext' : r.direction === 'flexion' ? 'flex' : ''}>{r.direction ?? '—'}</td>
                    <td>{mmss(r.durationS)}</td>
                    <td className="tab-notes">{r.note || '—'}</td>
                    <td className="flex">{d0(r.maxFlexDeg)}°</td>
                    <td className="ext">{d0(r.maxExtDeg)}°</td>
                    <td>{d0(r.peakDps)}°/s</td>
                    <td>{r.flexReps} / {r.extReps}</td>
                    <td>{d0(r.emgFlexPeak)} / {d0(r.emgExtPeak)}</td>
                    <td className="cap-row-actions">
                      <button className="btn btn--sm" onClick={() => setViewing(r)}>View</button>
                      <button className="btn btn--quiet btn--sm"
                        onClick={() => download(`${p?.code ?? 'rec'}_${fileStamp(r.startedAt)}_trace.csv`, traceCsv(r))}>Trace CSV</button>
                      <button className="btn btn--quiet btn--sm" onClick={async () => {
                        if (!window.confirm('Delete this recording? Its rosbag (if any) stays in ~/exo_data/bags.')) return;
                        await api.deleteRecording(r.id);
                        loadRecs();
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {viewing && <RecordingViewer rec={viewing} patient={people?.find((x) => x.id === viewing.patientId)} onClose={() => setViewing(null)} />}
      {adding && <NewPerson code={nextCode} onCancel={() => setAdding(false)} onCreate={addPerson} />}
    </div>
  );
}

function NewPerson({ code: code0, onCancel, onCreate }: {
  code: string;
  onCancel: () => void;
  onCreate: (p: { code: string; displayName: string; side: Side; notes: string }) => Promise<void>;
}) {
  const [code, setCode] = useState(code0);
  const [label, setLabel] = useState('');
  const [side, setSide] = useState<Side>('R');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = code.trim().length > 0;
  return (
    <Dialog title="New participant" onClose={onCancel} locked={busy} width={460}
      footer={<>
        <button key="c" type="button" className="btn btn--quiet spacer" onClick={onCancel}>Cancel</button>
        <button key="s" type="button" className="btn" disabled={!ok || busy}
          onClick={async () => { setBusy(true); await onCreate({ code: code.trim(), displayName: label.trim(), side, notes: notes.trim() }); }}>
          Add
        </button>
      </>}>
      <div className="ssf-pane">
        <label className="pf-field">
          <span className="ssf-label">Code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="pf-field">
          <span className="ssf-label">Label (optional, not a full name)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. initials or 'team member'" />
        </label>
        <div className="pf-field">
          <span className="ssf-label">Wrist wearing the exo</span>
          <div className="seg seg--wide" role="radiogroup">
            {(['L', 'R'] as Side[]).map((x) => (
              <button key={x} type="button" role="radio" aria-checked={side === x} className={side === x ? 'is-on' : ''}
                onClick={() => setSide(x)}><strong>{x === 'L' ? 'Left' : 'Right'}</strong></button>
            ))}
          </div>
        </div>
        <label className="pf-field">
          <span className="ssf-label">Notes (optional)</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no wrist injuries" />
        </label>
      </div>
    </Dialog>
  );
}
