// Health check results: one card per visit, newest first. Rows = wrist x direction.
// Range band: >= 90% of the reference wrist = matches; else >= 40 deg = functional; else below.
import { useEffect, useState } from 'react';
import { api, type HealthCheck, type Patient } from '../../data';
import { BAND, BAND_TEXT, profileLabel, resultRows, toCsv, type ResultRow } from '../../lib/healthMetrics';
import './tabs.css';

const n = (v: number | null, d = 0, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);
const signed = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}°`);

const LABEL_TEXT = { healthy: 'Healthy', recovering: 'Recovering', incomplete: 'Incomplete' } as const;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HealthTab({ patient, refresh, onStart, disabled }: {
  patient: Patient; refresh: number; onStart: () => void; disabled: boolean;
}) {
  const [list, setList] = useState<HealthCheck[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    api.listHealthChecks(patient.id).then((l) => { if (on) setList(l); });
    return () => { on = false; };
  }, [patient.id, refresh, tick]);
  const st = api.storage;

  return (
    <div className="tab-stack">
      <section className="panel tab-panel">
        <div className="tab-head">
          <div>
            <h2>Health check</h2>
            <span className="tab-muted">{st.label}</span>
          </div>
          <button className="btn" onClick={onStart} disabled={disabled}
            title={disabled ? 'Stop the current session first' : undefined}>
            Start health check
          </button>
        </div>
        {st.error && <p className="sts-error">{st.error}</p>}
        <p className="tab-muted">
          Range band: ≥ {BAND.matchPct}% of the reference wrist = matches reference; otherwise ≥ {BAND.functionalDeg}° =
          functional (Ryu 1991). Cut-offs are team-chosen. Co-contraction = antagonist ÷ agonist EMG above resting level during reps (provisional).
        </p>
        {list && !list.length && <p>No health checks yet.</p>}
      </section>

      {list?.map((hc) => (
        <Visit key={hc.id} hc={hc} patient={patient}
          onDelete={async () => {
            if (!window.confirm('Delete this health check? Its rosbags in ~/exo_data/bags are kept.')) return;
            await api.deleteHealthCheck(hc.id);
            setTick((t) => t + 1);
          }} />
      ))}
    </div>
  );
}

function Visit({ hc, patient, onDelete }: { hc: HealthCheck; patient: Patient; onDelete: () => void }) {
  const rows = resultRows(hc);
  const label = profileLabel(rows);
  const date = new Date(hc.startedAt);
  return (
    <section className="panel tab-panel">
      <div className="tab-head">
        <div>
          <h2>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            <span className={`hc-label hc-label--${label}`}>{LABEL_TEXT[label]}</span>
          </h2>
          <span className="tab-muted">
            PRWE {hc.prwe ?? '—'} · pain before {hc.painBaseline ?? '—'} ·{' '}
            {hc.referenceSide ? `reference: ${hc.referenceSide === 'R' ? 'right' : 'left'} wrist` : 'no reference wrist'}
          </span>
        </div>
        <div className="hc-actions">
          <button className="btn btn--quiet"
            onClick={() => download(`${patient.code}_${hc.startedAt.slice(0, 10)}_healthcheck.csv`, toCsv(hc, patient))}>
            Export CSV
          </button>
          <button className="btn btn--quiet" onClick={onDelete}>Delete</button>
        </div>
      </div>
      {!rows.length && <p className="tab-muted">No block was finished in this visit.</p>}
      {!!rows.length && <table className="tab-table hc-results">
        <thead>
          <tr>
            <th>Block</th><th>Range (IMU)</th><th>Goniometer<br /><small>IMU − gonio</small></th>
            <th>% of ref.</th><th>Band</th><th>Peak speed</th><th>Smooth&shy;ness</th><th>Loaded<br /><small>reps in 30 s</small></th>
            <th>Co-con&shy;traction</th><th>Pain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <Row key={i} r={r} />)}
        </tbody>
      </table>}
    </section>
  );
}

function Row({ r }: { r: ResultRow }) {
  const b = r.block;
  return (
    <tr className={b.complete ? '' : 'is-partial'}>
      <td>
        {b.side === 'R' ? 'Right' : 'Left'} <span className={b.mode === 'flexion' ? 'flex' : 'ext'}>{b.mode}</span>
        <br /><small className="tab-muted">{b.role}{b.complete ? '' : ', incomplete'}</small>
      </td>
      <td>{n(r.imuDeg, 0, '°')}</td>
      <td>{n(r.gonioDeg, 0, '°')}<br /><small className="tab-muted">{signed(r.diffDeg)}</small></td>
      <td>{n(r.pctOfRef, 0, '%')}</td>
      <td>{r.band ? <span className={`hc-band hc-band--${r.band}`}>{BAND_TEXT[r.band]}</span> : '—'}</td>
      <td>{n(r.peakDps, 0, '°/s')}</td>
      <td>{n(r.sparc, 2)}</td>
      <td>{r.loadedReps ?? '—'}</td>
      <td>{n(r.ccRatio, 2)}</td>
      <td>{r.pain ?? '—'}</td>
    </tr>
  );
}
