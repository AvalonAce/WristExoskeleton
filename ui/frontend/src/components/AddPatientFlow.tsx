// Add patient, in order: 1) connect the exo and watch every sensor live, 2) patient details.
// Step 1 is the hook-up test: with VITE_DATA=live it shows the real /imu/* and /emg/raw data.
import { useEffect, useState } from 'react';
import { raw, type NewPatient } from '../data';
import Dialog from './Dialog';
import PatientForm from './PatientForm';
import SensorTest from './SensorTest';
import './StartSessionFlow.css';

const STEPS = ['Connect the exo', 'Patient details'] as const;

interface Props {
  defaults: NewPatient;
  onCancel: () => void;
  onCreate: (p: NewPatient) => Promise<void>;
}

/** True once all three sensor topics have delivered data within the last second. */
function useAllSensorsLive() {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const last = { hand: 0, forearm: 0, emg: 0 };
    const offs = [
      raw.onImu('hand', () => { last.hand = performance.now(); }),
      raw.onImu('forearm', () => { last.forearm = performance.now(); }),
      raw.onEmg(() => { last.emg = performance.now(); }),
    ];
    const id = setInterval(() => {
      const now = performance.now();
      setLive(Object.values(last).every((t) => now - t < 1000));
    }, 300);
    return () => { offs.forEach((o) => o()); clearInterval(id); };
  }, []);
  return live;
}

export default function AddPatientFlow({ defaults, onCancel, onCreate }: Props) {
  const [step, setStep] = useState(0);
  const allLive = useAllSensorsLive();

  const footer = step === 0 ? (
    <>
      {!allLive && <span className="ssf-hint spacer">Not every sensor is sending data yet.</span>}
      <button className={`btn btn--quiet ${allLive ? 'spacer' : ''}`} onClick={onCancel}>Cancel</button>
      <button className="btn" onClick={() => setStep(1)}>{allLive ? 'Continue' : 'Continue anyway'}</button>
    </>
  ) : (
    <>
      <button className="btn btn--quiet spacer" onClick={() => setStep(0)}>Back</button>
      <button className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      <button className="btn" type="submit" form="new-patient">Create patient</button>
    </>
  );

  return (
    <Dialog title="Add patient" onClose={onCancel} footer={footer} width={step === 0 ? 880 : 600}>
      <ol className="ssf-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'is-now' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="ssf-num">{i < step ? '✓' : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <>
          <p className="ssf-lead apf-lead">
            Put the exo on, then move the wrist. Each sensor should show data and react to the movement.
          </p>
          <SensorTest key={raw.label} />
        </>
      )}
      {step === 1 && (
        <PatientForm formId="new-patient" hideButtons initial={defaults} submitLabel="Create patient" onSubmit={onCreate} />
      )}
    </Dialog>
  );
}
