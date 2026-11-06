// Start-up screen: the range arc draws in and sweeps once while the sensors are checked.
// Mock mode passes each check on a timer. Add ?fail=forearm (or hand, muscle, exo) to the URL
// to preview the failure state.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RangeArc from '../components/RangeArc';
import './LoadingScreen.css';

type CheckState = 'waiting' | 'checking' | 'ready' | 'problem';

interface Check {
  id: 'exo' | 'hand' | 'forearm' | 'muscle';
  label: string;
  fix: string; // shown when the check fails
}

const CHECKS: Check[] = [
  { id: 'exo', label: 'Connecting to the exo', fix: 'Plug the exo into this laptop and press its reset button.' },
  { id: 'hand', label: 'Hand sensor', fix: 'Check the cable on the hand sensor, then retry.' },
  { id: 'forearm', label: 'Forearm sensor', fix: 'Check the cable on the forearm sensor, then retry.' },
  { id: 'muscle', label: 'Muscle sensors', fix: 'Check that both electrode pads are firmly on the skin, then retry.' },
];

const STEP_MS = 650;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One calibration-style sweep of the knob: neutral -> extension -> flexion -> neutral. */
function useSweep(enabled: boolean) {
  const [angle, setAngle] = useState(NaN);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    const keys = [0, -55, 60, 0];
    const dur = 1700;
    const delay = 1000; // wait for the track to draw in
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const u = (now - t0) / dur;
      if (u < 0) { raf = requestAnimationFrame(tick); return; }
      if (u >= 1) { setAngle(NaN); return; }
      const seg = Math.min(keys.length - 2, Math.floor(u * (keys.length - 1)));
      const f = u * (keys.length - 1) - seg;
      const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
      setAngle(keys[seg] + (keys[seg + 1] - keys[seg]) * e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
  return angle;
}

export default function LoadingScreen() {
  const navigate = useNavigate();
  const fail = new URLSearchParams(window.location.search).get('fail');
  const [states, setStates] = useState<CheckState[]>(CHECKS.map(() => 'waiting'));
  const [run, setRun] = useState(0); // bump to retry
  const sweep = useSweep(run === 0);
  const failedOnce = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    setStates(CHECKS.map(() => 'waiting'));
    CHECKS.forEach((c, i) => {
      timers.push(setTimeout(() => setStates((s) => s.map((v, j) => (j === i ? 'checking' : v))), 400 + i * STEP_MS));
      timers.push(setTimeout(() => {
        // A requested failure happens only on the first attempt, so Retry shows recovery.
        const bad = c.id === fail && !failedOnce.current;
        if (bad) failedOnce.current = true;
        setStates((s) => s.map((v, j) => (j === i ? (bad ? 'problem' : 'ready') : v)));
        if (bad) timers.forEach(clearTimeout);
      }, 400 + (i + 1) * STEP_MS));
    });
    return () => timers.forEach(clearTimeout);
  }, [run, fail]);

  const problem = states.indexOf('problem');
  const allReady = states.every((s) => s === 'ready');

  useEffect(() => {
    if (!allReady) return;
    const t = setTimeout(() => navigate('/preview'), 900);
    return () => clearTimeout(t);
  }, [allReady, navigate]);

  return (
    <div className="boot">
      <div className="boot-inner">
        <RangeArc angle={sweep} intro size={440} />
        <div className="boot-side">
          <h1 className="boot-title">Wrist Exo</h1>
          <p className="boot-sub" aria-live="polite">
            {problem >= 0 ? 'One sensor needs attention' : allReady ? 'Ready' : 'Getting the exo ready'}
          </p>
          <ol className="boot-checks">
            {CHECKS.map((c, i) => (
              <li key={c.id} className={`boot-check boot-check--${states[i]}`}>
                <span className="boot-mark" aria-hidden="true" />
                <span className="boot-label">{c.label}</span>
                <span className="boot-state">
                  {states[i] === 'checking' ? 'Checking' : states[i] === 'ready' ? 'Ready'
                    : states[i] === 'problem' ? 'Not found' : ''}
                </span>
                {states[i] === 'problem' && <p className="boot-fix">{c.fix}</p>}
              </li>
            ))}
          </ol>
          {problem >= 0 && (
            <div className="boot-actions">
              <button className="btn" onClick={() => setRun((r) => r + 1)}>Retry</button>
              <button className="btn btn--quiet" onClick={() => navigate('/preview')}>Continue without it</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
