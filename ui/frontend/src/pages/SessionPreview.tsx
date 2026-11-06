// Style preview of the PT dashboard's Session tab, running on mock data.
// Not wired to real start/stop yet: this page exists to approve the look.
import { useEffect, useState } from 'react';
import LiveChart, { type Trace } from '../components/LiveChart';
import RangeArc from '../components/RangeArc';
import { api, Phase, PHASE_NAMES, Status, type Patient } from '../data';
import { useSessionStats } from '../hooks/useSessionStats';
import { useWristState } from '../hooks/useWristState';
import './SessionPreview.css';

const ANGLE: Trace[] = [{ label: 'Angle', color: '--ink', get: (s) => s.angle_deg, signColors: ['--flex', '--ext'] }];
const VELOCITY: Trace[] = [{ label: 'Velocity', color: '--slate', get: (s) => s.velocity_dps, width: 1.5 }];
const EMG: Trace[] = [
  { label: 'Flexor', color: '--flex', get: (s) => s.emg_flex },
  { label: 'Extensor', color: '--ext', get: (s) => s.emg_ext },
  { label: 'Flexor threshold', color: '--flex', get: (s) => s.emg_flex_thresh, dash: [4, 4], width: 1 },
];

const sideName = (p: Patient) => (p.side === 'R' ? 'Right wrist' : 'Left wrist');

function phaseTone(phase: number, angle: number) {
  if (phase === Phase.FLEX) return 'flex';
  if (phase === Phase.EXT) return 'ext';
  if (phase === Phase.HOLD) return angle >= 0 ? 'flex' : 'ext';
  if (phase === Phase.ONSET) return 'onset';
  return 'rest';
}

export default function SessionPreview() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sel, setSel] = useState<string>('');
  const [query, setQuery] = useState('');
  const { state: s, connection } = useWristState(30);
  const stats = useSessionStats();

  useEffect(() => {
    api.listPatients().then((ps) => { setPatients(ps); if (ps.length) setSel(ps[0].id); });
  }, []);

  const p = patients.find((x) => x.id === sel);
  const shown = patients.filter((x) =>
    `${x.code} ${x.displayName}`.toLowerCase().includes(query.toLowerCase()));
  const status = s?.status ?? 0;
  const sensors = [
    { name: 'Hand', ok: connection === 'connected' },
    { name: 'Forearm', ok: connection === 'connected' && !(status & Status.FOREARM_STALE) },
    { name: 'Muscle', ok: connection === 'connected' && !(status & (Status.EMG_STALE | Status.EMG_FLEX_SAT | Status.EMG_EXT_SAT)) },
  ];

  return (
    <div className="dash">
      <aside className="rail">
        <div className="rail-head">
          <span className="rail-brand">Wrist Exo</span>
        </div>
        <label className="rail-search">
          <span className="sr-only">Search patients</span>
          <input placeholder="Search patients" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <ul className="rail-list">
          {shown.map((x) => (
            <li key={x.id}>
              <button className={`rail-item ${x.id === sel ? 'is-active' : ''}`} onClick={() => setSel(x.id)}>
                <span className="rail-name">{x.displayName}</span>
                <span className="rail-meta">{x.code}  {sideName(x)}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="rail-empty">No patient matches “{query}”.</li>}
        </ul>
        <button className="btn btn--quiet rail-add">Add patient</button>
      </aside>

      <main className="work">
        {p && (
          <>
            <header className="work-head">
              <div>
                <h1>{p.displayName}</h1>
                <p className="work-meta">
                  <span>{p.code}</span><span>{sideName(p)}</span><span>Spring setting {p.springSetting}</span>
                </p>
              </div>
              <button className="btn">Start session</button>
            </header>

            <nav className="tabs" aria-label="Patient sections">
              <a className="is-active" aria-current="page">Session</a>
              <a>History</a>
              <a>Profile</a>
            </nav>

            <section className="live">
              <div className="live-dial">
                <RangeArc
                  angle={s?.angle_deg ?? NaN}
                  goalFlex={p.romGoalFlexDeg}
                  goalExt={p.romGoalExtDeg}
                  maxFlex={stats.maxFlex}
                  maxExt={stats.maxExt}
                  size={440}
                />
                <div className={`phase phase--${s ? phaseTone(s.phase, s.angle_deg) : 'rest'}`}>
                  {s ? PHASE_NAMES[s.phase] : 'Waiting for data'}
                </div>
                <p className="dial-key">
                  <span><i className="k-goal" />Goal</span>
                  <span><i className="k-max" />Best today</span>
                </p>
              </div>
              <div className="live-charts">
                <LiveChart title="Wrist angle" unit="degrees, flexion up" traces={ANGLE} range={[-70, 70]} ySplits={[-60, -30, 0, 30, 60]} />
                <LiveChart title="Movement speed" unit="degrees per second" traces={VELOCITY} height={100} />
                <LiveChart title="Muscle activity" unit="sensor level" traces={EMG} />
              </div>
            </section>

            <section className="summary">
              <div className="stat"><span className="stat-v num">{stats.reps}</span><span className="stat-l">Reps</span></div>
              <div className="stat"><span className="stat-v num flex">{stats.maxFlex.toFixed(0)}°</span>
                <span className="stat-l">Best flexion, goal {p.romGoalFlexDeg}°</span></div>
              <div className="stat"><span className="stat-v num ext">{stats.maxExt.toFixed(0)}°</span>
                <span className="stat-l">Best extension, goal {p.romGoalExtDeg}°</span></div>
              <ul className="sensors" aria-label="Sensors">
                {sensors.map((x) => (
                  <li key={x.name} className={x.ok ? 'ok' : 'bad'}>
                    <i aria-hidden="true" />{x.name} {x.ok ? 'sensor' : 'sensor not responding'}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
