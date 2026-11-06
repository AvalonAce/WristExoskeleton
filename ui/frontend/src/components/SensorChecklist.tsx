import { CHECKS, type CheckState } from '../hooks/useSensorChecks';
import './SensorChecklist.css';

export default function SensorChecklist({ states, messages = [] }: { states: CheckState[]; messages?: (string | null)[] }) {
  return (
    <ol className="checks">
      {CHECKS.map((c, i) => (
        <li key={c.id} className={`check check--${states[i]}`}>
          <span className="check-mark" aria-hidden="true" />
          <span className="check-label">{c.label}</span>
          <span className="check-state">
            {states[i] === 'checking' ? 'Checking' : states[i] === 'ready' ? 'Ready'
              : states[i] === 'problem' ? 'Needs attention' : ''}
          </span>
          {states[i] === 'problem' && <p className="check-fix">{messages[i] ?? c.fix}</p>}
        </li>
      ))}
    </ol>
  );
}
