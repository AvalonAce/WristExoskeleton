// Shown after Stop session: totals and each set, then Save session or Discard.
import { useState } from 'react';
import type { Patient, SessionSet } from '../data';
import Dialog from './Dialog';
import './SessionEndDialog.css';

export interface SessionResult {
  durationS: number;
  sets: SessionSet[];
}

/** Session-level summary numbers from its sets. */
export function totals(sets: SessionSet[]) {
  const flex = sets.filter((s) => s.mode === 'flexion');
  const ext = sets.filter((s) => s.mode === 'extension');
  return {
    reps: sets.reduce((n, s) => n + s.reps, 0),
    maxFlexDeg: flex.length ? Math.max(...flex.map((s) => s.bestDeg)) : 0,
    maxExtDeg: ext.length ? Math.max(...ext.map((s) => -s.bestDeg)) : 0,
    peakTorqueNm: sets.length ? Math.max(...sets.map((s) => s.peakTorqueNm)) : 0,
    hasFlex: flex.length > 0,
    hasExt: ext.length > 0,
  };
}

interface Props {
  patient: Patient;
  result: SessionResult;
  initialNotes: string;
  onSave: (notes: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const len = (s: SessionSet) => (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000;
const deg = (d: number) => `${Math.abs(d).toFixed(0)}° ${d >= 0 ? 'flexion' : 'extension'}`;

export default function SessionEndDialog({ patient, result: r, initialNotes, onSave, onDiscard }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); await fn(); };
  const t = totals(r.sets);

  const footer = confirmDiscard ? (
    <>
      <span key="warn" className="sed-warn spacer">This session's data will be deleted.</span>
      <button key="keep" type="button" className="btn btn--quiet" onClick={() => setConfirmDiscard(false)} disabled={busy}>Keep it</button>
      <button key="delete" type="button" className="btn btn--danger" onClick={run(onDiscard)} disabled={busy}>Delete session</button>
    </>
  ) : (
    <>
      <button key="discard" type="button" className="btn btn--quiet spacer" onClick={() => setConfirmDiscard(true)} disabled={busy}>Discard</button>
      <button key="save" type="button" className="btn" onClick={run(() => onSave(notes))} disabled={busy}>
        {busy ? 'Saving' : 'Save session'}
      </button>
    </>
  );

  // Escape/backdrop must not silently drop a recording, so the dialog is locked.
  return (
    <Dialog title="Session complete" onClose={() => {}} locked footer={footer} width={640}>
      <dl className="sed-grid">
        <div><dt>Duration</dt><dd>{fmtDuration(r.durationS)}</dd></div>
        <div><dt>Reps</dt><dd>{t.reps}<small> in {r.sets.length} {r.sets.length === 1 ? 'set' : 'sets'}</small></dd></div>
        {t.hasFlex && <div><dt>Best flexion</dt><dd className="flex">{t.maxFlexDeg.toFixed(0)}°<small> of {patient.romGoalFlexDeg}° goal</small></dd></div>}
        {t.hasExt && <div><dt>Best extension</dt><dd className="ext">{t.maxExtDeg.toFixed(0)}°<small> of {patient.romGoalExtDeg}° goal</small></dd></div>}
        <div><dt>Peak resistance (estimated)</dt><dd>{t.peakTorqueNm.toFixed(2)}<small> N·m</small></dd></div>
      </dl>

      {r.sets.length > 0 ? (
        <table className="sed-sets">
          <thead>
            <tr><th>Set</th><th>Direction</th><th>Spring</th><th>Reps</th><th>Range from start</th><th>Furthest</th><th>Length</th></tr>
          </thead>
          <tbody>
            {r.sets.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className={s.mode === 'flexion' ? 'flex' : 'ext'}>{s.mode === 'flexion' ? 'Flexion' : 'Extension'}</td>
                <td>{s.springSetting}</td>
                <td>{s.reps}</td>
                <td>{s.bestExcursionDeg.toFixed(0)}°</td>
                <td>{deg(s.bestDeg)}</td>
                <td>{fmtDuration(len(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="sed-empty">No sets were recorded.</p>
      )}

      <label className="sed-notes">
        <span>Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="How did the patient do? Anything to change next time?" />
      </label>
    </Dialog>
  );
}
