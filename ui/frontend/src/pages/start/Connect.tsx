// Connect step after sign in: the icon animates while the sensors are checked.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SensorChecklist from '../../components/SensorChecklist';
import { useSensorChecks } from '../../hooks/useSensorChecks';
import { currentUser } from '../../lib/auth';
import { useStart } from './StartLayout';

export default function Connect() {
  const navigate = useNavigate();
  const { setBusy } = useStart();
  const { states, messages, retry, problem, allReady, checking } = useSensorChecks();
  const user = currentUser();

  useEffect(() => {
    setBusy(checking);
    return () => setBusy(false);
  }, [checking, setBusy]);

  useEffect(() => {
    if (!allReady) return;
    const t = setTimeout(() => navigate('/dashboard', { replace: true }), 900);
    return () => clearTimeout(t);
  }, [allReady, navigate]);

  return (
    <div>
      <h1 className="start-title">{user ? `Hi, ${user.name.split(' ')[0]}` : 'Wrist Exo'}</h1>
      <p className="start-sub" aria-live="polite">
        {problem >= 0 ? 'One sensor needs attention' : allReady ? 'Ready' : 'Getting the exo ready'}
      </p>
      <SensorChecklist states={states} messages={messages} />
      {problem >= 0 && (
        <div className="start-actions">
          <button className="btn" onClick={retry}>Retry</button>
          <button className="btn btn--quiet" onClick={() => navigate('/dashboard', { replace: true })}>
            Continue without it
          </button>
        </div>
      )}
    </div>
  );
}
