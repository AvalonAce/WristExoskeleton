// Start session, in order: fit the exo, check the sensors, record a resting baseline.
// The baseline is what the EMG onset threshold is computed from, so it is not skippable.
import { useEffect, useState } from 'react';
import type { Patient } from '../data';
import { useSensorChecks } from '../hooks/useSensorChecks';
import { useWristState } from '../hooks/useWristState';
import { maxTorque } from '../lib/spring';
import Dialog from './Dialog';
import SensorChecklist from './SensorChecklist';
import './PatientForm.css';
import './StartSessionFlow.css';

const BASELINE_S = 5; // mock; the real protocol uses 10 s
const STEPS = ['Fit the exo', 'Check sensors', 'Resting baseline'] as const;

interface Props {
  patient: Patient;
  onCancel: () => void;
  onStart: (opts: { springSetting: number; notes: string }) => Promise<void>;
}

export default function StartSessionFlow({ patient, onCancel, onStart }: Props) {
  const [step, setStep] = useState(0);
  const [spring, setSpring] = useState(patient.springSetting);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const checks = useSensorChecks(step === 1);
  const [baseT, setBaseT] = useState(0); // seconds of baseline recorded
  const { state: live } = useWristState(10);

  // Move on by itself once every sensor is ready.
  useEffect(() => {
    if (step === 1 && checks.allReady) {
      const t = setTimeout(() => setStep(2), 700);
      return () => clearTimeout(t);
    }
  }, [step, checks.allReady]);

  useEffect(() => {
    if (step !== 2) return;
    setBaseT(0);
    const t0 = performance.now();
    const id = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      setBaseT(Math.min(BASELINE_S, s));
      if (s >= BASELINE_S) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [step]);

  const baselineDone = baseT >= BASELINE_S;
  const side = patient.side === 'R' ? 'right' : 'left';

  const footer = (
    <>
      <button className="btn btn--quiet spacer" onClick={onCancel} disabled={busy}>Cancel</button>
      {step > 0 && step < 2 && <button className="btn btn--quiet" onClick={() => setStep(step - 1)}>Back</button>}
      {step === 0 && <button className="btn" onClick={() => setStep(1)}>Continue</button>}
      {step === 1 && checks.problem >= 0 && <button className="btn" onClick={checks.retry}>Retry</button>}
      {step === 2 && (
        <button className="btn" disabled={!baselineDone || busy}
          onClick={async () => { setBusy(true); await onStart({ springSetting: spring, notes }); }}>
          {busy ? 'Starting' : 'Start recording'}
        </button>
      )}
    </>
  );

  return (
    <Dialog title={`Start session for ${patient.displayName}`} onClose={onCancel} locked={busy} footer={footer} width={560}>
      <ol className="ssf-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'is-now' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="ssf-num">{i < step ? '✓' : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="ssf-pane">
          <p className="ssf-lead">
            Put the exo on the patient's <strong>{side} wrist</strong>, with the forearm resting flat on the table.
          </p>
          <div className="pf-field">
            <span className="ssf-label">Spring setting for this session</span>
            <div className="seg seg--wide" role="radiogroup">
              {[1, 2, 3].map((n) => (
                <button type="button" key={n} role="radio" aria-checked={spring === n}
                  className={spring === n ? 'is-on' : ''} onClick={() => setSpring(n)}>
                  <strong>{n}</strong><small>{maxTorque(n).toFixed(2)} N·m at 60°</small>
                </button>
              ))}
            </div>
            {spring !== patient.springSetting && (
              <p className="ssf-hint">Profile setting is {patient.springSetting}. This session will use {spring}.</p>
            )}
          </div>
          <label className="pf-field ssf-notes">
            <span className="ssf-label">Session notes (optional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="For example: first session after cast removal" />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="ssf-pane">
          <p className="ssf-lead" aria-live="polite">
            {checks.problem >= 0 ? 'One sensor needs attention.' : checks.allReady ? 'All sensors ready.' : 'Checking each sensor.'}
          </p>
          <SensorChecklist states={checks.states} messages={checks.messages} />
        </div>
      )}

      {step === 2 && (
        <div className="ssf-pane">
          <p className="ssf-lead">
            {baselineDone
              ? 'Baseline recorded. The patient can start moving once recording begins.'
              : 'Ask the patient to relax the hand and keep the wrist still.'}
          </p>
          <div className="ssf-base" role="progressbar" aria-valuemin={0} aria-valuemax={BASELINE_S} aria-valuenow={Math.round(baseT)}>
            <div style={{ width: `${(baseT / BASELINE_S) * 100}%` }} />
          </div>
          <div className="ssf-base-meta">
            <span>{baselineDone ? 'Done' : `${Math.ceil(BASELINE_S - baseT)} s left`}</span>
            {live && (
              <span>
                Resting muscle level: flexor {live.emg_flex.toFixed(0)}, extensor {live.emg_ext.toFixed(0)}
              </span>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
