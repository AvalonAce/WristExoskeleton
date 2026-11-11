// Live view for the selected patient. Shows live data whether or not a session is recording,
// so the PT can watch the fit before starting.
// During a set (one-direction exo) everything is drawn for that set: the working side of the
// arc from the start pose, resistance from the movement past the start pose, the working
// muscle's threshold, and this set's numbers.
import LiveChart, { type Trace } from '../../components/LiveChart';
import RangeArc from '../../components/RangeArc';
import ResistanceMeter from '../../components/ResistanceMeter';
import {
  Phase, PHASE_NAMES, Status, type ConnectionState, type Patient, type SetMode, type WristState,
} from '../../data';
import type { SessionStats } from '../../hooks/useSessionStats';
import { maxTorque, torqueAt } from '../../lib/spring';

function angleTraces(set: SetMode | null): Trace[] {
  const t: Trace[] = [{ label: 'Angle', color: '--ink', get: (s) => s.angle_deg, signColors: ['--flex', '--ext'] }];
  if (set) t.push({ label: 'Start pose', color: '--slate', get: (s) => s.start_deg, dash: [4, 4], width: 1 });
  return t;
}

function emgTraces(set: SetMode | null): Trace[] {
  const t: Trace[] = [
    { label: 'Flexor', color: '--flex', get: (s) => s.emg_flex, width: set === 'extension' ? 1.25 : 2 },
    { label: 'Extensor', color: '--ext', get: (s) => s.emg_ext, width: set === 'flexion' ? 1.25 : 2 },
  ];
  // Threshold of the working muscle (flexor when there is no set).
  t.push(set === 'extension'
    ? { label: 'Threshold', color: '--ext', get: (s) => s.emg_ext_thresh, dash: [4, 4], width: 1 }
    : { label: 'Threshold', color: '--flex', get: (s) => s.emg_flex_thresh, dash: [4, 4], width: 1 });
  return t;
}

const resistanceTraces = (setting: number, set: SetMode | null): Trace[] => [
  { label: 'Resistance', color: set === 'extension' ? '--ext' : set === 'flexion' ? '--flex' : '--ink',
    get: (s) => torqueAt(set ? s.excursion_deg : s.angle_deg, setting), width: 2 },
  { label: 'Setting maximum', color: '--slate', get: () => maxTorque(setting), dash: [4, 4], width: 1 },
];

function phaseTone(phase: number, angle: number, set: SetMode | null) {
  if (phase === Phase.FLEX) return 'flex';
  if (phase === Phase.EXT) return 'ext';
  if (phase === Phase.HOLD) return set ? (set === 'flexion' ? 'flex' : 'ext') : angle >= 0 ? 'flex' : 'ext';
  if (phase === Phase.ONSET) return 'onset';
  return 'rest';
}

interface Props {
  patient: Patient;
  spring: number; // the current set's spring setting (may differ from the profile)
  set: SetMode | null; // direction of the set being recorded; null when no set is running
  live: WristState | null;
  connection: ConnectionState;
  stats: SessionStats; // this set's (or, without a set, since the page opened)
  recording: boolean;
}

export default function SessionTab({ patient: p, spring, set, live: s, connection, stats, recording }: Props) {
  const status = s?.status ?? 0;
  const sensors = [
    { name: 'Hand', ok: connection === 'connected' },
    { name: 'Forearm', ok: connection === 'connected' && !(status & Status.FOREARM_STALE) },
    { name: 'Muscle', ok: connection === 'connected' && !(status & (Status.EMG_STALE | Status.EMG_FLEX_SAT | Status.EMG_EXT_SAT)) },
  ];
  const peak = torqueAt(set ? stats.bestExcursion : Math.max(stats.maxFlex, stats.maxExt), spring);
  const goal = set === 'flexion' ? p.romGoalFlexDeg : p.romGoalExtDeg;
  const furthest = set === 'flexion' ? stats.maxFlex : stats.maxExt;
  const key = `${spring}-${set ?? 'none'}`; // charts rebuild when the set changes

  return (
    <div className="grid">
      <section className="panel panel--dial" aria-label="Wrist angle">
        <RangeArc angle={s?.angle_deg ?? NaN} goalFlex={p.romGoalFlexDeg} goalExt={p.romGoalExtDeg}
          maxFlex={stats.maxFlex} maxExt={stats.maxExt} size={420}
          set={set && s ? { mode: set, startDeg: s.start_deg } : null} />
        <div className={`phase phase--${s ? phaseTone(s.phase, s.angle_deg, set) : 'rest'}`}>
          {s ? PHASE_NAMES[s.phase] : 'Waiting for data'}
        </div>
        <p className="dial-key">
          {set && <span><i className="k-start" />Start pose</span>}
          <span><i className="k-goal" />Goal</span>
          <span><i className={`k-max ${set === 'extension' ? 'k-max--ext' : ''}`} />{set ? 'Best this set' : 'Best since opened'}</span>
        </p>
      </section>

      <section className="panel panel--charts" aria-label="Live signals">
        <LiveChart key={`a-${key}`} title="Wrist angle" unit="degrees, flexion up" traces={angleTraces(set)}
          range={[-70, 70]} ySplits={[-60, -30, 0, 30, 60]} />
        <LiveChart key={`r-${key}`} title="Resistance" unit={set ? 'N·m, estimated from movement past start' : 'N·m, estimated'}
          traces={resistanceTraces(spring, set)} height={110} range={[0, maxTorque(spring) * 1.25]} />
        <LiveChart key={`e-${key}`} title="Muscle activity"
          unit={set ? `sensor level, working muscle: ${set === 'flexion' ? 'flexor' : 'extensor'}` : 'sensor level'}
          traces={emgTraces(set)} />
      </section>

      <section className="panel panel--resist">
        <ResistanceMeter angle={s?.angle_deg ?? NaN} setting={spring} peak={peak}
          set={set && s ? { mode: set, excursion: s.excursion_deg } : null} />
      </section>

      <section className="panel panel--summary" aria-label={set ? 'This set' : recording ? 'Between sets' : 'Live preview'}>
        {set ? (
          <>
            <div className="stat"><span className="stat-v num">{stats.reps}</span><span className="stat-l">Reps this set</span></div>
            <div className="stat"><span className={`stat-v num ${set === 'flexion' ? 'flex' : 'ext'}`}>{stats.bestExcursion.toFixed(0)}°</span>
              <span className="stat-l">Best range from start</span></div>
            <div className="stat"><span className={`stat-v num ${set === 'flexion' ? 'flex' : 'ext'}`}>{furthest.toFixed(0)}°</span>
              <span className="stat-l">Furthest {set}, goal {goal}°</span></div>
          </>
        ) : (
          <>
            <div className="stat"><span className="stat-v num">—</span>
              <span className="stat-l">{recording ? 'Between sets' : 'Reps count once a set starts'}</span></div>
            <div className="stat"><span className="stat-v num flex">{stats.maxFlex.toFixed(0)}°</span>
              <span className="stat-l">Best flexion, goal {p.romGoalFlexDeg}°</span></div>
            <div className="stat"><span className="stat-v num ext">{stats.maxExt.toFixed(0)}°</span>
              <span className="stat-l">Best extension, goal {p.romGoalExtDeg}°</span></div>
          </>
        )}
        <ul className="sensors" aria-label="Sensors">
          {sensors.map((x) => (
            <li key={x.name} className={x.ok ? 'ok' : 'bad'}>
              <i aria-hidden="true" />{x.name} {x.ok ? 'sensor' : 'sensor not responding'}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
