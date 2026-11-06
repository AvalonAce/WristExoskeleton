// Create or edit a patient profile. The parent owns submit (it decides create vs update).
import { useState, type FormEvent } from 'react';
import type { NewPatient, Side } from '../data';
import { maxTorque } from '../lib/spring';
import './PatientForm.css';

interface Props {
  initial: NewPatient;
  submitLabel: string;
  onSubmit: (p: NewPatient) => Promise<void>;
  onCancel?: () => void;
  formId?: string; // lets a dialog footer hold the buttons
  hideButtons?: boolean;
}

type Errors = Partial<Record<keyof NewPatient, string>>;

export function validatePatient(p: NewPatient): Errors {
  const e: Errors = {};
  if (!p.displayName.trim()) e.displayName = 'Enter a name.';
  if (!p.code.trim()) e.code = 'Enter a patient code.';
  for (const k of ['romGoalFlexDeg', 'romGoalExtDeg'] as const) {
    if (!Number.isFinite(p[k]) || p[k] < 5 || p[k] > 90) e[k] = 'Use a value from 5 to 90 degrees.';
  }
  return e;
}

export default function PatientForm({ initial, submitLabel, onSubmit, onCancel, formId, hideButtons }: Props) {
  const [p, setP] = useState<NewPatient>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewPatient>(k: K, v: NewPatient[K]) => setP((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validatePatient(p);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try { await onSubmit({ ...p, displayName: p.displayName.trim(), code: p.code.trim() }); }
    finally { setBusy(false); }
  }

  const err = (k: keyof NewPatient) => errors[k] && <span className="pf-err">{errors[k]}</span>;

  return (
    <form id={formId} className="pf" onSubmit={submit} noValidate>
      <div className="pf-row">
        <label className="pf-field pf-grow">
          <span>Name</span>
          <input value={p.displayName} onChange={(e) => set('displayName', e.target.value)}
            aria-invalid={!!errors.displayName} autoFocus />
          {err('displayName')}
        </label>
        <label className="pf-field pf-code">
          <span>Patient code</span>
          <input value={p.code} onChange={(e) => set('code', e.target.value)} aria-invalid={!!errors.code} />
          {err('code')}
        </label>
      </div>

      <fieldset className="pf-field">
        <legend>Treated wrist</legend>
        <div className="seg" role="radiogroup">
          {(['L', 'R'] as Side[]).map((s) => (
            <button type="button" key={s} role="radio" aria-checked={p.side === s}
              className={p.side === s ? 'is-on' : ''} onClick={() => set('side', s)}>
              {s === 'L' ? 'Left' : 'Right'}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pf-field">
        <legend>Spring setting</legend>
        <div className="seg seg--wide" role="radiogroup">
          {[1, 2, 3].map((n) => (
            <button type="button" key={n} role="radio" aria-checked={p.springSetting === n}
              className={p.springSetting === n ? 'is-on' : ''} onClick={() => set('springSetting', n)}>
              <strong>{n}</strong><small>{maxTorque(n).toFixed(2)} N·m at 60°</small>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="pf-row">
        <label className="pf-field">
          <span>Flexion goal</span>
          <span className="pf-unit">
            <input type="number" min={5} max={90} value={Number.isFinite(p.romGoalFlexDeg) ? p.romGoalFlexDeg : ''}
              onChange={(e) => set('romGoalFlexDeg', e.target.valueAsNumber)} aria-invalid={!!errors.romGoalFlexDeg} />
            <i>degrees</i>
          </span>
          {err('romGoalFlexDeg')}
        </label>
        <label className="pf-field">
          <span>Extension goal</span>
          <span className="pf-unit">
            <input type="number" min={5} max={90} value={Number.isFinite(p.romGoalExtDeg) ? p.romGoalExtDeg : ''}
              onChange={(e) => set('romGoalExtDeg', e.target.valueAsNumber)} aria-invalid={!!errors.romGoalExtDeg} />
            <i>degrees</i>
          </span>
          {err('romGoalExtDeg')}
        </label>
      </div>

      <label className="pf-field">
        <span>Notes</span>
        <textarea rows={3} value={p.notes} onChange={(e) => set('notes', e.target.value)}
          placeholder="Injury, precautions, what to focus on" />
      </label>

      {!hideButtons && (
        <div className="pf-actions">
          {onCancel && <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>}
          <button className="btn" type="submit" disabled={busy}>{submitLabel}</button>
        </div>
      )}
    </form>
  );
}
