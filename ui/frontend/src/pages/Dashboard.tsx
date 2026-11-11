// PT dashboard: patient list on the left; the selected patient's Session / History / Profile.
// Flows: Add patient -> Start session = set 1 (direction, sensors, calibration) -> recording ->
// Next set (re-orient, recalibrate; the exo resists one direction per set) -> Stop session ->
// save or discard.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AddPatientFlow from '../components/AddPatientFlow';
import HealthCheckFlow from '../components/HealthCheckFlow';
import SessionEndDialog, { fmtDuration, totals, type SessionResult } from '../components/SessionEndDialog';
import SetSetupFlow, { type SetStart } from '../components/SetSetupFlow';
import { api, control, springFor, type NewPatient, type Patient, type Session, type SessionSet, type SetMode } from '../data';
import type { SessionStats } from '../hooks/useSessionStats';
import { useSessionStats } from '../hooks/useSessionStats';
import { useWristState } from '../hooks/useWristState';
import { currentUser, signOut } from '../lib/auth';
import { torqueAt } from '../lib/spring';
import HealthTab from './tabs/HealthTab';
import HistoryTab from './tabs/HistoryTab';
import ProfileTab from './tabs/ProfileTab';
import SessionTab from './tabs/SessionTab';
import './Dashboard.css';

type Tab = 'session' | 'history' | 'health' | 'profile';
const TABS: { id: Tab; label: string }[] = [
  { id: 'session', label: 'Session' }, { id: 'history', label: 'History' },
  { id: 'health', label: 'Health check' }, { id: 'profile', label: 'Profile' },
];

interface ActiveSet {
  mode: SetMode;
  spring: number;
  startedMs: number;
  startDeg: number;
}

interface Recording {
  session: Session;
  startedMs: number;
  sets: SessionSet[]; // finished sets
  current: ActiveSet | null; // null between sets
}

function finishSet(a: ActiveSet, st: SessionStats): SessionSet {
  return {
    mode: a.mode, springSetting: a.spring, startDeg: a.startDeg,
    startedAt: new Date(a.startedMs).toISOString(), endedAt: new Date().toISOString(),
    reps: st.reps,
    bestDeg: a.mode === 'flexion' ? st.maxFlex : -st.maxExt,
    bestExcursionDeg: st.bestExcursion,
    peakTorqueNm: torqueAt(st.bestExcursion, a.spring),
  };
}

const other = (m: SetMode): SetMode => (m === 'flexion' ? 'extension' : 'flexion');

const sideName = (p: Patient) => (p.side === 'R' ? 'Right wrist' : 'Left wrist');

function newPatientDefaults(existing: Patient[]): NewPatient {
  const nums = existing.map((p) => parseInt(p.code.replace(/\D/g, ''), 10)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return {
    code: `P-${String(next).padStart(3, '0')}`, displayName: '', side: 'R', springFlex: 1, springExt: 1,
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
  const [setup, setSetup] = useState(false); // set-up dialog open (first or next set)
  const [rec, setRec] = useState<Recording | null>(null);
  const [ended, setEnded] = useState<SessionResult | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [hcOpen, setHcOpen] = useState(false);
  const [hcRefresh, setHcRefresh] = useState(0);

  const { state: live, connection } = useWristState(30);
  // Counts restart with every set.
  const stats = useSessionStats(rec ? `${rec.session.id}:${rec.sets.length}:${rec.current ? 'on' : 'off'}` : 'idle');
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

  /** Set-up dialog finished: start the session (first set) or the next set. */
  async function startSet(st: SetStart) {
    if (!p) return;
    const current: ActiveSet = { mode: st.mode, spring: st.springSetting, startedMs: Date.now(), startDeg: st.startDeg };
    if (!rec) {
      const session = await api.startSession(p.id, { springSetting: st.springSetting, notes: st.notes });
      setRec({ session, startedMs: Date.now(), sets: [], current });
    } else {
      setRec({ ...rec, current });
    }
    setSetup(false);
    setTab('session');
  }

  /** Close the running set (if any) into the session's list. */
  function closeSet(r: Recording): Recording {
    return r.current ? { ...r, sets: [...r.sets, finishSet(r.current, stats)], current: null } : r;
  }

  function nextSet() {
    if (rec) setRec(closeSet(rec));
    setSetup(true);
  }

  function cancelSetup() {
    setSetup(false);
    if (!rec) control.setMode('none'); // nothing started: put the node back to idle
  }

  function stopRecording() {
    if (!rec) return;
    const r = closeSet(rec);
    setRec(r);
    setEnded({ durationS: elapsed, sets: r.sets });
  }

  async function finish(save: boolean, notes = '') {
    if (!rec || !ended) return;
    if (save) {
      const t = totals(ended.sets);
      await api.stopSession(rec.session.id, {
        notes,
        sets: ended.sets,
        summary: {
          reps: t.reps, maxFlexDeg: t.maxFlexDeg, maxExtDeg: t.maxExtDeg,
          meanOnsetLeadMs: null, peakTorqueNm: t.peakTorqueNm,
        },
      });
    } else {
      await api.discardSession(rec.session.id);
    }
    control.setMode('none');
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
                  {rec?.current
                    ? <span>Spring setting {rec.current.spring} this set</span>
                    : <span>Springs: flexion {p.springFlex}, extension {p.springExt}</span>}
                </p>
              </div>
              {rec ? (
                <div className="rec">
                  <span className="rec-badge" role="status"><i aria-hidden="true" />Recording {fmtDuration(elapsed)}</span>
                  {rec.current ? (
                    <span className={`set-pill set-pill--${rec.current.mode}`}>
                      Set {rec.sets.length + 1}, {rec.current.mode}
                    </span>
                  ) : (
                    <span className="set-pill">Between sets</span>
                  )}
                  <button key="next" className="btn btn--quiet" onClick={nextSet}>
                    {rec.current ? 'Next set' : `Start set ${rec.sets.length + 1}`}
                  </button>
                  <button key="stop" className="btn" onClick={stopRecording}>Stop session</button>
                </div>
              ) : (
                <button className="btn" onClick={() => setSetup(true)}>Start session</button>
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
              <SessionTab patient={p} spring={rec?.current?.spring ?? p.springFlex} set={rec?.current?.mode ?? null} live={live}
                connection={connection} stats={stats} recording={recording} />
            )}
            {tab === 'history' && <HistoryTab patient={p} refresh={historyRefresh} />}
            {tab === 'health' && (
              <HealthTab patient={p} refresh={hcRefresh} disabled={recording} onStart={() => setHcOpen(true)} />
            )}
            {tab === 'profile' && (
              <ProfileTab patient={p} onSaved={(u) => setPatients((ps) => ps!.map((x) => (x.id === u.id ? u : x)))} />
            )}
          </>
        )}
      </main>

      {adding && patients && (
        <AddPatientFlow defaults={newPatientDefaults(patients)} onCancel={() => setAdding(false)} onCreate={createPatient} />
      )}

      {setup && p && (
        <SetSetupFlow
          patient={p}
          setNumber={rec ? rec.sets.length + 1 : 1}
          defaultMode={rec?.sets.length ? other(rec.sets[rec.sets.length - 1].mode) : 'flexion'}
          springDefault={(m) => springFor(p, m)}
          onCancel={cancelSetup}
          onStart={startSet}
        />
      )}

      {hcOpen && p && (
        <HealthCheckFlow patient={p} onClose={() => { setHcOpen(false); setHcRefresh((x) => x + 1); setTab('health'); }} />
      )}

      {ended && p && rec && (
        <SessionEndDialog patient={p} result={ended} initialNotes={rec.session.notes}
          onSave={(notes) => finish(true, notes)} onDiscard={() => finish(false)} />
      )}
    </div>
  );
}
