// Range-of-motion trend, then one row per session; a session with sets expands to show them.
import { Fragment, useEffect, useState } from 'react';
import { fmtDuration } from '../../components/SessionEndDialog';
import TrendChart, { bests } from '../../components/TrendChart';
import { api, type Patient, type Session, type SessionSet } from '../../data';
import './tabs.css';

const secs = (a: string, b: string | null) => (b ? (Date.parse(b) - Date.parse(a)) / 1000 : 0);
const dirs = (sets: SessionSet[]) =>
  sets.map((s) => (s.mode === 'flexion' ? 'F' : 'E')).join(' ');
const furthest = (d: number) => `${Math.abs(d).toFixed(0)}° ${d >= 0 ? 'flexion' : 'extension'}`;

export default function HistoryTab({ patient, refresh }: { patient: Patient; refresh: number }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setSessions(null);
    api.listSessions(patient.id).then(setSessions);
  }, [patient.id, refresh]);

  if (!sessions) return <div className="panel tab-panel"><p className="tab-muted">Loading sessions</p></div>;

  const saved = sessions.filter((s) => s.summary);
  return (
    <div className="tab-stack">
      <section className="panel tab-panel">
        <div className="tab-head">
          <h2>Range of motion</h2>
          <p className="tab-key">
            <span><i className="k-flex" />Best flexion</span>
            <span><i className="k-ext" />Best extension</span>
            <span><i className="k-goal" />Goal</span>
          </p>
        </div>
        <TrendChart sessions={saved} goalFlex={patient.romGoalFlexDeg} goalExt={patient.romGoalExtDeg} />
      </section>

      <section className="panel tab-panel">
        <h2>Sessions</h2>
        {!saved.length ? (
          <p className="tab-muted">No sessions yet. Use Start session to record the first one.</p>
        ) : (
          <table className="tab-table">
            <thead>
              <tr>
                <th aria-label="Show sets" /><th>Date</th><th>Length</th><th>Sets</th><th>Reps</th>
                <th>Best flexion</th><th>Best extension</th><th>EMG lead</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => {
                const b = bests(s);
                const has = !!s.sets?.length;
                const isOpen = open === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr className={isOpen ? 'is-open' : ''}>
                      <td>
                        {has && (
                          <button type="button" className="tab-expand" aria-expanded={isOpen}
                            aria-label={isOpen ? 'Hide sets' : 'Show sets'} onClick={() => setOpen(isOpen ? null : s.id)}>
                            {isOpen ? '−' : '+'}
                          </button>
                        )}
                      </td>
                      <td>{new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>{fmtDuration(secs(s.startedAt, s.endedAt))}</td>
                      <td>{has ? <span className="tab-dirs">{s.sets!.length}<small>{dirs(s.sets!)}</small></span> : '—'}</td>
                      <td className="num">{s.summary!.reps}</td>
                      <td className="num flex">{b.flex != null ? `${b.flex.toFixed(0)}°` : '—'}</td>
                      <td className="num ext">{b.ext != null ? `${b.ext.toFixed(0)}°` : '—'}</td>
                      <td className="num">{s.summary!.meanOnsetLeadMs != null ? `${s.summary!.meanOnsetLeadMs.toFixed(0)} ms` : '—'}</td>
                      <td className="tab-notes">{s.notes}</td>
                    </tr>
                    {isOpen && has && (
                      <tr className="tab-sets-row">
                        <td />
                        <td colSpan={8}>
                          <table className="tab-sets">
                            <thead>
                              <tr><th>Set</th><th>Direction</th><th>Spring</th><th>Reps</th><th>Start pose</th>
                                <th>Range from start</th><th>Furthest</th><th>Peak resistance</th><th>Length</th></tr>
                            </thead>
                            <tbody>
                              {s.sets!.map((x, i) => (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td className={x.mode === 'flexion' ? 'flex' : 'ext'}>{x.mode === 'flexion' ? 'Flexion' : 'Extension'}</td>
                                  <td>{x.springSetting}</td>
                                  <td>{x.reps}</td>
                                  <td>{furthest(x.startDeg)}</td>
                                  <td>{x.bestExcursionDeg.toFixed(0)}°</td>
                                  <td>{furthest(x.bestDeg)}</td>
                                  <td>{x.peakTorqueNm.toFixed(2)} N·m</td>
                                  <td>{fmtDuration(secs(x.startedAt, x.endedAt))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
