// Set up one set of the one-direction exo, in order:
//   1 Direction  flexion or extension, how to orient the exo, spring setting
//   2 Sensors    quick check (re-orienting the exo can disturb cables)
//   3 Calibrate  neutral -> start pose -> one test movement (learns the sensor sign)
// Used for the first set (Start session) and every later set (Next set).
import { useEffect, useRef, useState } from 'react';
import { Calib, modeDir, type Patient, type SetMode, type Side } from '../data';
import { runCalibStep, setModeConfirmed, type StepResult } from '../hooks/exoCommands';
import { useSensorChecks } from '../hooks/useSensorChecks';
import { useWristState } from '../hooks/useWristState';
import { maxTorque } from '../lib/spring';
import Dialog from './Dialog';
import SensorChecklist from './SensorChecklist';
import './PatientForm.css';
import './StartSessionFlow.css';
import './SetSetupFlow.css';

const STEPS = ['Direction', 'Sensors', 'Calibrate'] as const;

const GUIDE: Record<SetMode, { title: string; fit: string; start: string; test: string }> = {
  flexion: {
    title: 'Flexion',
    fit: 'Orient the exo so the spring resists bending the hand toward the palm side.',
    start: 'Let the wrist relax bent back (extended). Every rep starts from here.',
    test: 'Slowly bend the wrist toward the palm, past straight, then let it come back.',
  },
  extension: {
    title: 'Extension',
    fit: 'Orient the exo so the spring resists lifting the back of the hand.',
    start: 'Let the wrist relax bent forward (flexed). Every rep starts from here.',
    test: 'Slowly lift the back of the hand, past straight, then let it come back.',
  },
};

type CalId = 'neutral' | 'start' | 'test_move';
type CalState = 'todo' | 'running' | 'done' | 'problem';

export interface SetStart {
  mode: SetMode;
  springSetting: number;
  startDeg: number;
  notes: string;
}

/** Health Check blocks: direction, spring and wrist are set by the protocol, not chosen. */
export interface FixedSet {
  mode: SetMode;
  spring: number;
  side: Side;
  title: string;      // dialog title, e.g. "Block 1 of 4: left wrist, flexion"
  startLabel: string; // final button, e.g. "Start range test"
}

interface Props {
  patient: Patient;
  fixed?: FixedSet;
  setNumber: number; // 1 for the first set
  defaultMode: SetMode;
  springDefault: (m: SetMode) => number; // the profile's spring for a direction
  onCancel: () => void;
  onStart: (s: SetStart) => Promise<void>;
}

const describe = (deg: number) =>
  Math.abs(deg) < 2 ? 'straight' : `${Math.abs(deg).toFixed(0)}° ${deg > 0 ? 'flexion' : 'extension'}`;

const PROBLEM: Record<Exclude<StepResult, { ok: true }>['reason'], string> = {
  'no-response': "The exo didn't respond. Check the connection, then try again.",
  timeout: 'That step did not finish. Try again.',
  'too-small': 'The movement was too small. Move a little further, then try again.',
};

export default function SetSetupFlow({ patient, fixed, setNumber, defaultMode, springDefault, onCancel, onStart }: Props) {
  const first = setNumber === 1 && !fixed;
  const side = fixed?.side ?? patient.side;
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<SetMode>(fixed?.mode ?? defaultMode);
  const [spring, setSpring] = useState(() => fixed?.spring ?? springDefault(defaultMode));
  const [springTouched, setSpringTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [cal, setCal] = useState<Record<CalId, CalState>>({ neutral: 'todo', start: 'todo', test_move: 'todo' });
  const [problem, setProblem] = useState<Partial<Record<CalId, string>>>({});
  const [startDeg, setStartDeg] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [modeError, setModeError] = useState('');
  const [busy, setBusy] = useState(false);
  const checks = useSensorChecks(step === 1);
  const { state: live } = useWristState(10);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode mounts twice: set on every mount, not just at creation
    return () => { alive.current = false; };
  }, []);

  const g = GUIDE[mode];
  const running = Object.values(cal).includes('running');
  const allDone = cal.neutral === 'done' && cal.start === 'done' && cal.test_move === 'done';

  // Entering calibration tells the node the new mode (which clears any old calibration).
  async function toCalibrate() {
    setModeError('');
    setCal({ neutral: 'todo', start: 'todo', test_move: 'todo' });
    setStartDeg(null);
    setFlipped(false);
    if (!(await setModeConfirmed(mode))) {
      setModeError("The exo didn't confirm the set direction. Check the connection, then try again.");
      return;
    }
    if (alive.current) setStep(2);
  }

  async function run(id: CalId) {
    setCal((c) => ({ ...c, [id]: 'running' }));
    setProblem((p) => ({ ...p, [id]: undefined }));
    const r = await runCalibStep(id);
    if (!alive.current) return;
    if (!r.ok) {
      setCal((c) => ({ ...c, [id]: 'problem' }));
      setProblem((p) => ({ ...p, [id]: PROBLEM[r.reason] }));
      return;
    }
    // Redoing neutral or the start pose invalidates what came after it (same as the node).
    setCal((c) => ({
      ...c, [id]: 'done',
      ...(id === 'neutral' ? { start: 'todo', test_move: 'todo' } : {}),
      ...(id === 'start' ? { test_move: 'todo' } : {}),
    }));
    if (id === 'start' || id === 'test_move') setStartDeg(r.state.start_deg);
    if (id === 'test_move') setFlipped((r.state.calib & Calib.FLIPPED) !== 0);
  }

  const rows: { id: CalId; title: string; help: string; action: string; enabled: boolean; doneText?: string }[] = [
    { id: 'neutral', title: 'Neutral', help: 'Hold the wrist straight, in line with the forearm, and keep it still.',
      action: 'Record neutral', enabled: true },
    { id: 'start', title: 'Start pose', help: g.start, action: 'Record start pose',
      enabled: cal.neutral === 'done', doneText: startDeg != null ? `Recorded at ${describe(startDeg)}` : undefined },
    { id: 'test_move', title: 'Test movement', help: g.test, action: 'Start test movement',
      enabled: cal.start === 'done',
      doneText: flipped ? 'Direction confirmed. Sensors were mounted reversed; corrected.' : 'Direction confirmed.' },
  ];

  // A start pose on the wrong side of neutral usually means the wrong exo orientation.
  const startOdd = startDeg != null && modeDir(mode) * startDeg > 5;

  const footer = (
    <>
      <button key="cancel" type="button" className="btn btn--quiet spacer" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      {step === 1 && <button key="back" type="button" className="btn btn--quiet" onClick={() => setStep(0)}>Back</button>}
      {step === 0 && <button key="next0" type="button" className="btn" onClick={() => setStep(1)}>Continue</button>}
      {step === 1 && checks.problem >= 0 && (
        <button key="retry" type="button" className="btn" onClick={checks.retry}>Retry</button>
      )}
      {step === 1 && checks.problem >= 0 && (
        <button key="skip" type="button" className="btn btn--quiet" onClick={toCalibrate}>Continue anyway</button>
      )}
      {step === 2 && (
        <button key="start" type="button" className="btn" disabled={!allDone || busy || running}
          onClick={async () => {
            setBusy(true);
            await onStart({ mode, springSetting: spring, startDeg: startDeg ?? 0, notes });
          }}>
          {busy ? 'Starting' : fixed ? fixed.startLabel : first ? 'Start recording' : `Start set ${setNumber}`}
        </button>
      )}
    </>
  );

  // Sensor check passes -> move on, telling the node the mode first.
  useEffect(() => {
    if (step !== 1 || !checks.allReady) return;
    const t = setTimeout(toCalibrate, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, checks.allReady]);

  return (
    <Dialog title={fixed ? fixed.title : first ? `Start session for ${patient.displayName}` : `Set ${setNumber}`} onClose={onCancel}
      locked={busy || running} footer={footer} width={600}>
      <ol className="ssf-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'is-now' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="ssf-num">{i < step ? '✓' : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && fixed && (
        <div className="ssf-pane">
          <p className="sts-live"><span className={`sts-chip sts-chip--${mode}`}>{g.title}</span>
            {side === 'R' ? 'Right' : 'Left'} wrist, spring setting {spring}</p>
          <p className="ssf-lead">{g.fit} Put it on the <strong>{side === 'R' ? 'right' : 'left'} wrist</strong> and
            set the spring to <strong>{spring}</strong>.</p>
          <p className="ssf-lead">{g.start}</p>
        </div>
      )}

      {step === 0 && !fixed && (
        <div className="ssf-pane">
          <div className="pf-field">
            <span className="ssf-label">Which direction is this set?</span>
            <div className="seg seg--wide sts-dir" role="radiogroup">
              {(['flexion', 'extension'] as SetMode[]).map((m) => (
                <button type="button" key={m} role="radio" aria-checked={mode === m}
                  className={`${mode === m ? 'is-on' : ''} sts-dir--${m}`}
                  onClick={() => { setMode(m); if (!springTouched) setSpring(springDefault(m)); }}>
                  <strong>{GUIDE[m].title}</strong>
                  <small>{m === 'flexion' ? 'Starts bent back, works by bending forward' : 'Starts bent forward, works by lifting back'}</small>
                </button>
              ))}
            </div>
          </div>
          <p className="ssf-lead">{g.fit} Put it on the patient's <strong>{side === 'R' ? 'right' : 'left'} wrist</strong>.</p>
          <div className="pf-field">
            <span className="ssf-label">Spring setting for this set</span>
            <div className="seg seg--wide" role="radiogroup">
              {[1, 2, 3].map((n) => (
                <button type="button" key={n} role="radio" aria-checked={spring === n}
                  className={spring === n ? 'is-on' : ''} onClick={() => { setSpring(n); setSpringTouched(true); }}>
                  <strong>{n}</strong><small>{maxTorque(n).toFixed(2)} N·m at 60°</small>
                </button>
              ))}
            </div>
          </div>
          {first && (
            <label className="pf-field ssf-notes">
              <span className="ssf-label">Session notes (optional)</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="For example: first session after cast removal" />
            </label>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="ssf-pane">
          <p className="ssf-lead" aria-live="polite">
            {checks.problem >= 0 ? 'One sensor needs attention.' : checks.allReady ? 'All sensors ready.' : 'Checking each sensor.'}
          </p>
          <SensorChecklist states={checks.states} messages={checks.messages} />
          {modeError && <p className="sts-error">{modeError}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="ssf-pane">
          <p className="sts-live" aria-live="off">
            <span className={`sts-chip sts-chip--${mode}`}>{g.title} set</span>
            Wrist now: <strong>{live ? describe(live.angle_deg) : 'no data'}</strong>
          </p>
          <ol className="sts-cal">
            {rows.map((r) => {
              const st = cal[r.id];
              return (
                <li key={r.id} className={`sts-row sts-row--${st} ${r.enabled ? '' : 'is-locked'}`}>
                  <span className="check-mark" aria-hidden="true" />
                  <div className="sts-text">
                    <strong>{r.title}</strong>
                    <p>{st === 'done' && r.doneText ? r.doneText : r.help}</p>
                    {st === 'problem' && <p className="sts-problem">{problem[r.id]}</p>}
                  </div>
                  <button type="button" className={`btn ${st === 'done' ? 'btn--quiet' : ''}`}
                    disabled={!r.enabled || running} onClick={() => run(r.id)}>
                    {st === 'running' ? (r.id === 'test_move' ? 'Waiting for movement' : 'Hold still') : st === 'done' ? 'Redo' : r.action}
                  </button>
                </li>
              );
            })}
          </ol>
          {startOdd && (
            <p className="sts-error">
              The start pose is on the {mode === 'flexion' ? 'flexion' : 'extension'} side of straight. For a {g.title.toLowerCase()} set
              it should be bent the other way; check the exo orientation and redo the start pose.
            </p>
          )}
          {modeError && <p className="sts-error">{modeError}</p>}
        </div>
      )}
    </Dialog>
  );
}
