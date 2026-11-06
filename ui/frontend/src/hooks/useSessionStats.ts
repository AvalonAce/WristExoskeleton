import { useEffect, useRef, useState } from 'react';
import { Phase, stream } from '../data';

export interface SessionStats {
  reps: number;
  maxFlex: number; // deg, positive
  maxExt: number;  // deg, positive
}

const zero = (): SessionStats => ({ reps: 0, maxFlex: 0, maxExt: 0 });

/**
 * Counts reps (a RETURN that ends in REST) and tracks max range from the live stream.
 * Change `resetKey` to start counting from zero (e.g. when a recording starts).
 */
export function useSessionStats(resetKey: unknown = 0): SessionStats {
  const acc = useRef<SessionStats>(zero());
  const prev = useRef<number>(Phase.REST);
  const [stats, setStats] = useState(acc.current);

  useEffect(() => {
    acc.current = zero();
    prev.current = Phase.REST;
    setStats(zero());
    const unsub = stream.subscribe((s) => {
      const a = acc.current;
      if (prev.current === Phase.RETURN && s.phase === Phase.REST) a.reps += 1;
      prev.current = s.phase;
      if (Number.isFinite(s.angle_deg)) {
        if (s.angle_deg > a.maxFlex) a.maxFlex = s.angle_deg;
        if (-s.angle_deg > a.maxExt) a.maxExt = -s.angle_deg;
      }
    });
    const t = setInterval(() => setStats({ ...acc.current }), 200);
    return () => { unsub(); clearInterval(t); };
  }, [resetKey]);

  return stats;
}
