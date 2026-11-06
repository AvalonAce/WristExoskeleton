// Live view for the selected patient. Shows live data whether or not a session is recording,
// so the PT can watch the fit before starting.
import LiveChart, { type Trace } from '../../components/LiveChart';
import RangeArc from '../../components/RangeArc';
import ResistanceMeter from '../../components/ResistanceMeter';
import { Phase, PHASE_NAMES, Status, type ConnectionState, type Patient, type WristState } from '../../data';
import type { SessionStats } from '../../hooks/useSessionStats';
import { maxTorque, torqueAt } from '../../lib/spring';

const ANGLE: Trace[] = [{ label: 'Angle', color: '--ink', get: (s) => s.angle_deg, signColors: ['--flex', '--ext'] }];
const EMG: Trace[] = [
  { label: 'Flexor', color: '--flex', get: (s) => s.emg_flex },
  { label: 'Extensor', color: '--ext', get: (s) => s.emg_ext },
  { label: 'Threshold', color: '--flex', get: (s) => s.emg_flex_thresh, dash: [4, 4], width: 1 },
];
const resistance = (setting: number): Trace[] => [
  { label: 'Resistance', color: '--ink', get: (s) => torqueAt(s.angle_deg, setting), width: 2 },
  { label: 'Setting maximum', color: '--slate', get: () => maxTorque(setting), dash: [4, 4], width: 1 },
];

function phaseTone(phase: number, angle: number) {
  if (phase === Phase.FLEX) return 'flex';
  if (phase === Phase.EXT) return 'ext';
  if (phase === Phase.HOLD) return angle >= 0 ? 'flex' : 'ext';
  if (phase === Phase.ONSET) return 'onset';
  return 'rest';
}

interface Props {
  patient: Patient;
  spring: number; // the session's spring setting (may differ from the profile)
  live: WristState | null;
  connection: ConnectionState;
  stats: SessionStats;
  recording: boolean;
}

export default function SessionTab({ patient: p, spring, live: s, connection, stats, recording }: Props) {
  const status = s?.status ?? 0;
  const sensors = [
    { name: 'Hand', ok: connection === 'connected' },
    { name: 'Forearm', ok: connection === 'connected' && !(status & Status.FOREARM_STALE) },
    { name: 'Muscle', ok: connection === 'connected' && !(status & (Status.EMG_STALE | Status.EMG_FLEX_SAT | Status.EMG_EXT_SAT)) },
  ];
  const peak = torqueAt(Math.max(stats.maxFlex, stats.maxExt), spring);

  return (
    <div className="grid">
      <section className="panel panel--dial" aria-label="Wrist angle">
        <RangeArc angle={s?.angle_deg ?? NaN} goalFlex={p.romGoalFlexDeg} goalExt={p.romGoalExtDeg}
          maxFlex={stats.maxFlex} maxExt={stats.maxExt} size={420} />
        <div className={`phase phase--${s ? phaseTone(s.phase, s.angle_deg) : 'rest'}`}>
          {s ? PHASE_NAMES[s.phase] : 'Waiting for data'}
        </div>
        <p className="dial-key">
          <span><i className="k-goal" />Goal</span>
          <span><i className="k-max" />{recording ? 'Best this session' : 'Best since opened'}</span>
        </p>
      </section>

      <section className="panel panel--charts" aria-label="Live signals">
        <LiveChart title="Wrist angle" unit="degrees, flexion up" traces={ANGLE}
          range={[-70, 70]} ySplits={[-60, -30, 0, 30, 60]} />
        <LiveChart key={spring} title="Resistance" unit="N·m, estimated" traces={resistance(spring)}
          height={110} range={[0, maxTorque(spring) * 1.25]} />
        <LiveChart title="Muscle activity" unit="sensor level" traces={EMG} />
      </section>

      <section className="panel panel--resist">
        <ResistanceMeter angle={s?.angle_deg ?? NaN} setting={spring} peak={peak} />
      </section>

      <section className="panel panel--summary" aria-label={recording ? 'This session' : 'Live preview'}>
        <div className="stat"><span className="stat-v num">{recording ? stats.reps : '—'}</span>
          <span className="stat-l">{recording ? 'Reps' : 'Reps count once recording starts'}</span></div>
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
    </div>
  );
}
