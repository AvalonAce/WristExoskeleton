// Step 1 stub: pick a patient, list their sessions. Plots per session come in step 2+.
import { useEffect, useState } from 'react';
import { api, type Patient, type Session } from '../data';

export default function HistoryPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [pid, setPid] = useState<string>('');
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    api.listPatients().then((ps) => {
      setPatients(ps);
      if (ps.length) setPid(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (pid) api.listSessions(pid).then(setSessions);
  }, [pid]);

  return (
    <section>
      <h1>History</h1>
      <label>
        Patient{' '}
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.displayName}</option>
          ))}
        </select>
      </label>
      <table>
        <thead>
          <tr><th>Date</th><th>Spring</th><th>Reps</th><th>Max flex</th><th>Max ext</th><th>EMG lead</th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.startedAt).toLocaleDateString()}</td>
              <td>{s.springSetting}</td>
              <td>{s.summary?.reps ?? '—'}</td>
              <td>{s.summary ? `${s.summary.maxFlexDeg.toFixed(0)}°` : '—'}</td>
              <td>{s.summary ? `${s.summary.maxExtDeg.toFixed(0)}°` : '—'}</td>
              <td>{s.summary ? `${s.summary.meanOnsetLeadMs.toFixed(0)} ms` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
