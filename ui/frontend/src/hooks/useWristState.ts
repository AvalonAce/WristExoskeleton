import { useEffect, useRef, useState } from 'react';
import { stream, type ConnectionState, type WristState } from '../data';

/**
 * Latest WristState, re-rendered at ~`hz` (default 20 Hz). The stream itself runs at 100 Hz;
 * re-rendering React that often is wasted work. Charts get every sample via `onSample`.
 */
export function useWristState(hz = 20, onSample?: (s: WristState) => void) {
  const latest = useRef<WristState | null>(null);
  const cbRef = useRef(onSample);
  cbRef.current = onSample;
  const [state, setState] = useState<WristState | null>(null);
  const [conn, setConn] = useState<ConnectionState>(stream.connection);

  useEffect(() => {
    const unsub = stream.subscribe((s) => {
      latest.current = s;
      cbRef.current?.(s);
    });
    const unsubConn = stream.onConnection(setConn);
    const timer = setInterval(() => setState(latest.current), 1000 / hz);
    return () => {
      unsub();
      unsubConn();
      clearInterval(timer);
    };
  }, [hz]);

  return { state, connection: conn };
}
