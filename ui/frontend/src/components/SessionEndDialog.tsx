// Shown after Stop session: the session's results, then Save session or Discard.
import { useState } from 'react';
import type { Patient } from '../data';
import Dialog from './Dialog';
import './SessionEndDialog.css';

export interface SessionResult {
  durationS: number;
  reps: number;
  maxFlexDeg: number;
  maxExtDeg: number;
  peakTorqueNm: number;
  springSetting: number;
}

interface Props {
  patient: Patient;
  result: SessionResult;
  initialNotes: string;
  onSave: (notes: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function SessionEndDialog({ patient, result: r, initialNotes, onSave, onDiscard }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); await fn(); };

  const footer = confirmDiscard ? (
    <>
      <span className="sed-warn spacer">This session's data will be deleted.</span>
      <button className="btn btn--quiet" onClick={() => setConfirmDiscard(false)} disabled={busy}>Keep it</button>
      <button className="btn btn--danger" onClick={run(onDiscard)} disabled={busy}>Delete session</button>
    </>
  ) : (
    <>
      <button className="btn btn--quiet spacer" onClick={() => setConfirmDiscard(true)} disabled={busy}>Discard</button>
      <button className="btn" onClick={run(() => onSave(notes))} disabled={busy}>
        {busy ? 'Saving' : 'Save session'}
      </button>
    </>
  );

  // Escape/backdrop must not silently drop a recording, so the dialog is locked.
  return (
    <Dialog title="Session complete" onClose={() => {}} locked footer={footer} width={560}>
      <dl className="sed-grid">
        <div><dt>Duration</dt><dd>{fmtDuration(r.durationS)}</dd></div>
        <div><dt>Reps</dt><dd>{r.reps}</dd></div>
        <div><dt>Best flexion</dt><dd className="flex">{r.maxFlexDeg.toFixed(0)}°<small> of {patient.romGoalFlexDeg}° goal</small></dd></div>
        <div><dt>Best extension</dt><dd className="ext">{r.maxExtDeg.toFixed(0)}°<small> of {patient.romGoalExtDeg}° goal</small></dd></div>
        <div><dt>Peak resistance (estimated)</dt><dd>{r.peakTorqueNm.toFixed(2)}<small> N·m</small></dd></div>
        <div><dt>Spring setting</dt><dd>{r.springSetting}</dd></div>
      </dl>
      <label className="sed-notes">
        <span>Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="How did the patient do? Anything to change next time?" />
      </label>
    </Dialog>
  );
}
