// Step 1 stub: proves the live stream works by showing the latest values as numbers.
// Charts, phase indicator and rep counter come in step 2.
import { PHASE_NAMES, STATUS_NAMES } from '../data';
import { useWristState } from '../hooks/useWristState';

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export default function LivePage() {
  const { state: s, connection } = useWristState();

  const flags = s
    ? Object.entries(STATUS_NAMES).filter(([bit]) => s.status & Number(bit)).map(([, n]) => n)
    : [];

  return (
    <section>
      <h1>Live session</h1>
      <p>Connection: <strong>{connection}</strong></p>
      {s && (
        <dl className="readout">
          <dt>Phase</dt><dd>{PHASE_NAMES[s.phase]}</dd>
          <dt>Angle</dt><dd>{fmt(s.angle_deg)}°</dd>
          <dt>Velocity</dt><dd>{fmt(s.velocity_dps)}°/s</dd>
          <dt>EMG flexor</dt><dd>{fmt(s.emg_flex, 0)} (thr {fmt(s.emg_flex_thresh, 0)})</dd>
          <dt>EMG extensor</dt><dd>{fmt(s.emg_ext, 0)} (thr {fmt(s.emg_ext_thresh, 0)})</dd>
          <dt>Status</dt><dd>{flags.length ? flags.join(', ') : 'OK'}</dd>
        </dl>
      )}
    </section>
  );
}
