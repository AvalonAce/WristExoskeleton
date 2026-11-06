// PT dashboard: patient list on the left; the selected patient's Session / History / Profile.
// Flows: Add patient (dialog) -> Start session (fit, sensor check, baseline) -> recording ->
// Stop session -> save or discard.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AddPatientFlow from '../components/AddPatientFlow';
import SessionEndDialog, { fmtDuration, type SessionResult } from '../components/SessionEndDialog';
import StartSessionFlow from '../components/StartSessionFlow';
import { api, type NewPatient, type Patient, type Session } from '../data';
import { useSessionStats } from '../hooks/useSessionStats';
import { useWristState } from '../hooks/useWristState';
import { currentUser, signOut } from '../lib/auth';
import { torqueAt } from '../lib/spring';
import HistoryTab from './tabs/HistoryTab';
import ProfileTab from './tabs/ProfileTab';
import SessionTab from './tabs/SessionTab';
import './Dashboard.css';

type Tab = 'session' | 'history' | 'profile';
const TABS: { id: Tab; label: string }[] = [
  { id: 'session', label: 'Session' }, { id: 'history', label: 'History' }, { id: 'profile', label: 'Profile' },
];

interface Recording {
  session: Session;
  startedMs: number;
  spring: number;
}

const sideName = (p: Patient) => (p.side === 'R' ? 'Right wrist' : 'Left wrist');

function newPatientDefaults(existing: Patient[]): NewPatient {
  const nums = existing.map((p) => parseInt(p.code.replace(/\D/g, ''), 10)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return {
    code: `P-${String(next).padStart(3, '0')}`, displayName: '', side: 'R', springSetting: 1,
    romGoalFlexDeg: 60, romGoalExtDeg: 50, notes: '',
  };
}

/** Seconds since `startMs`, ticking once a second while `on`. */
function useElapsed(startMs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startMs == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);
  return startMs == null ? 0 : Math.max(0, (now - startMs) / 1000);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = currentUser();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [sel, setSel] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('session');
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  const [ended, setEnded] = useState<SessionResult | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const { state: live, connection } = useWristState(30);
  const stats = useSessionStats(rec?.session.id ?? 'idle');
  const elapsed = useElapsed(rec?.startedMs ?? null);

  const load = useCallback(async (select?: string) => {
    const ps = await api.listPatients();
    setPatients(ps);
    setSel((cur) => select ?? (ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? ''));
  }, []);
  useEffect(() => { load(); }, [load]);

  const p = patients?.find((x) => x.id === sel);
  const shown = (patients ?? []).filter((x) =>
    `${x.code} ${x.displayName}`.toLowerCase().includes(query.toLowerCase()));

  async function createPatient(np: NewPatient) {
    const created = await api.createPatient(np);
    setAdding(false);
    setTab('profile');
    await load(created.id);
  }

  async function startRecording(opts: { springSetting: number; notes: string }) {
    if (!p) return;
    const session = await api.startSession(p.id, opts);
    setRec({ session, startedMs: Date.now(), spring: opts.springSetting });
    setStarting(false);
    setTab('session');
  }

  function stopRecording() {
    if (!rec) return;
    setEnded({
      durationS: elapsed, reps: stats.reps, maxFlexDeg: stats.maxFlex, maxExtDeg: stats.maxExt,
      peakTorqueNm: torqueAt(Math.max(stats.maxFlex, stats.maxExt), rec.spring), springSetting: rec.spring,
    });
  }

  async function finish(save: boolean, notes = '') {
    if (!rec || !ended) return;
    if (save) {
      await api.stopSession(rec.session.id, {
        notes,
        summary: {
          reps: ended.reps, maxFlexDeg: ended.maxFlexDeg, maxExtDeg: ended.maxExtDeg,
          meanOnsetLeadMs: null, peakTorqueNm: ended.peakTorqueNm,
        },
      });
    } else {
      await api.discardSession(rec.session.id);
    }
    setEnded(null);
    setRec(null);
    setHistoryRefresh((n) => n + 1);
    if (save) setTab('history');
  }

  const recording = rec != null;

  return (
    <div className="dash">
      <aside className="rail panel">
        <span className="rail-brand">Wrist Exo</span>
        <label>
          <span className="sr-only">Search patients</span>
          <input className="rail-search" placeholder="Search patients" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </label>
        <ul className="rail-list">
          {shown.map((x) => (
            <li key={x.id}>
              <button className={`rail-item ${x.id === sel ? 'is-active' : ''}`}
                disabled={recording && x.id !== sel}
                title={recording && x.id !== sel ? 'Stop the current session to switch patients' : undefined}
                onClick={() => setSel(x.id)}>
                <span className="rail-name">{x.displayName}</span>
                <span className="rail-meta"><span>{x.code}</span><span>{sideName(x)}</span></span>
              </button>
            </li>
          ))}
          {patients && !patients.length && <li className="rail-empty">No patients yet.</li>}
          {patients && !!patients.length && !shown.length && <li className="rail-empty">No patient matches “{query}”.</li>}
        </ul>
        <button className="btn btn--quiet rail-add" onClick={() => setAdding(true)} disabled={recording}>
          Add patient
        </button>
        <div className="rail-user">
          <span className="rail-user-name">{user?.name ?? 'Signed in'}</span>
          <button className="rail-signout" disabled={recording}
            onClick={() => { signOut(); navigate('/signin', { replace: true }); }}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="work">
        {patients && !p && (
          <div className="empty panel">
            <h1>Add your first patient</h1>
            <p>A profile holds the treated wrist, spring setting and range-of-motion goals used in each session.</p>
            <button className="btn" onClick={() => setAdding(true)}>Add patient</button>
          </div>
        )}

        {p && (
          <>
            <header className="work-head">
              <div>
                <h1>{p.displayName}</h1>
                <p className="work-meta">
                  <span>{p.code}</span><span>{sideName(p)}</span>
                  <span>Spring setting {rec?.spring ?? p.springSetting}</span>
                </p>
              </div>
              {recording ? (
                <div className="rec">
                  <span className="rec-badge" role="status"><i aria-hidden="true" />Recording {fmtDuration(elapsed)}</span>
                  <button className="btn" onClick={stopRecording}>Stop session</button>
                </div>
              ) : (
                <button className="btn" onClick={() => setStarting(true)}>Start session</button>
              )}
            </header>

            <nav className="tabs" aria-label="Patient sections">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'is-active' : ''} aria-current={tab === t.id ? 'page' : undefined}
                  onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === 'session' && (
              <SessionTab patient={p} spring={rec?.spring ?? p.springSetting} live={live}
                connection={connection} stats={stats} recording={recording} />
            )}
            {tab === 'history' && <HistoryTab patient={p} refresh={historyRefresh} />}
            {tab === 'profile' && (
              <ProfileTab patient={p} onSaved={(u) => setPatients((ps) => ps!.map((x) => (x.id === u.id ? u : x)))} />
            )}
          </>
        )}
      </main>

      {adding && patients && (
        <AddPatientFlow defaults={newPatientDefaults(patients)} onCancel={() => setAdding(false)} onCreate={createPatient} />
      )}

      {starting && p && (
        <StartSessionFlow patient={p} onCancel={() => setStarting(false)} onStart={startRecording} />
      )}

      {ended && p && rec && (
        <SessionEndDialog patient={p} result={ended} initialNotes={rec.session.notes}
          onSave={(notes) => finish(true, notes)} onDiscard={() => finish(false)} />
      )}
    </div>
  );
}
