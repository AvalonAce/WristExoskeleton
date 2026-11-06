import { useEffect, useState } from 'react';
import { fmtDuration } from '../../components/SessionEndDialog';
import TrendChart from '../../components/TrendChart';
import { api, type Patient, type Session } from '../../data';
import './tabs.css';

export default function HistoryTab({ patient, refresh }: { patient: Patient; refresh: number }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);

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
                <th>Date</th><th>Length</th><th>Spring</th><th>Reps</th>
                <th>Best flexion</th><th>Best extension</th><th>EMG lead</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => {
                const len = s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000 : 0;
                return (
                  <tr key={s.id}>
                    <td>{new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td>{fmtDuration(len)}</td>
                    <td className="num">{s.springSetting}</td>
                    <td className="num">{s.summary!.reps}</td>
                    <td className="num flex">{s.summary!.maxFlexDeg.toFixed(0)}°</td>
                    <td className="num ext">{s.summary!.maxExtDeg.toFixed(0)}°</td>
                    <td className="num">{s.summary!.meanOnsetLeadMs != null ? `${s.summary!.meanOnsetLeadMs.toFixed(0)} ms` : '—'}</td>
                    <td className="tab-notes">{s.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
