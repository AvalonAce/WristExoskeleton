// The four start-up checks, shared by the Connect screen and the Start session flow.
// LIVE (VITE_DATA=live): each check listens to its ROS topic through rosbridge.
// MOCK: each check passes on a timer. Add ?fail=forearm (or hand, muscle, exo) to the URL to
// preview a failure; Retry then succeeds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DATA_MODE, ROSBRIDGE_URL, raw, type ConnectionState } from '../data';

export type CheckState = 'waiting' | 'checking' | 'ready' | 'problem';
export type CheckId = 'exo' | 'hand' | 'forearm' | 'muscle';

export interface Check {
  id: CheckId;
  label: string;
  fix: string; // default advice when the check fails
}

export const CHECKS: Check[] = [
  { id: 'exo', label: 'Connecting to the exo', fix: 'Plug the exo into this laptop and press its reset button.' },
  { id: 'hand', label: 'Hand sensor', fix: 'Check the cable on the hand sensor, then retry.' },
  { id: 'forearm', label: 'Forearm sensor', fix: 'Check the cable on the forearm sensor, then retry.' },
  { id: 'muscle', label: 'Muscle sensors', fix: 'Check that both electrode pads are firmly on the skin, then retry.' },
];

const STEP_MS = 650;        // mock pacing
const LISTEN_MS = 1500;     // live: how long each sensor is listened to
const MIN_MSGS = 75;        // live: of ~150 expected at 100 msg/s in LISTEN_MS
const CONNECT_MS = 4000;    // live: how long to wait for rosbridge
const RAIL = 4000;          // ADC counts; a channel averaging above this is saturated

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitConnected(ms: number): Promise<boolean> {
  if (raw.connection === 'connected') return Promise.resolve(true);
  return new Promise((resolve) => {
    let off = () => {};
    const t = setTimeout(() => { off(); resolve(false); }, ms);
    off = raw.onConnection((c: ConnectionState) => {
      if (c === 'connected') { clearTimeout(t); setTimeout(() => off()); resolve(true); }
    });
  });
}

/** Listen to one sensor for LISTEN_MS; returns null if healthy, else what went wrong. */
async function listen(id: Exclude<CheckId, 'exo'>): Promise<string | null> {
  let count = 0;
  let flex = 0, ext = 0, samples = 0;
  const off = id === 'muscle'
    ? raw.onEmg((b) => {
      count += 1;
      for (let i = 0; i < b.flexor.length; i++) { flex += b.flexor[i]; ext += b.extensor[i]; samples += 1; }
    })
    : raw.onImu(id, () => { count += 1; });
  await sleep(LISTEN_MS);
  off();
  const name = id === 'muscle' ? 'muscle sensors' : `${id} sensor`;
  if (count === 0) return `No data from the ${name}. ${CHECKS.find((c) => c.id === id)!.fix}`;
  if (count < MIN_MSGS) {
    return `The ${name} is sending only ${Math.round(count / (LISTEN_MS / 1000))} messages a second (expected about 100). Check its cable, then retry.`;
  }
  if (id === 'muscle' && samples) {
    const railed = [flex / samples > RAIL && 'flexor', ext / samples > RAIL && 'extensor'].filter(Boolean);
    if (railed.length) {
      return `The ${railed.join(' and ')} channel reads at its maximum. Re-seat the electrode pads or lower the sensor gain, then retry.`;
    }
  }
  return null;
}

export function useSensorChecks(enabled = true) {
  const fail = new URLSearchParams(window.location.search).get('fail');
  const [states, setStates] = useState<CheckState[]>(CHECKS.map(() => 'waiting'));
  const [messages, setMessages] = useState<(string | null)[]>(CHECKS.map(() => null));
  const [run, setRun] = useState(0);
  const failedOnce = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const set = (i: number, st: CheckState, msg: string | null = null) => {
      if (cancelled) return;
      setStates((s) => s.map((v, j) => (j === i ? st : v)));
      setMessages((m) => m.map((v, j) => (j === i ? msg : v)));
    };
    setStates(CHECKS.map(() => 'waiting'));
    setMessages(CHECKS.map(() => null));

    (async () => {
      for (let i = 0; i < CHECKS.length; i++) {
        const c = CHECKS[i];
        set(i, 'checking');
        let problem: string | null = null;
        if (DATA_MODE === 'live') {
          problem = c.id === 'exo'
            ? ((await waitConnected(CONNECT_MS)) ? null
              : `Can't reach the exo's data link at ${ROSBRIDGE_URL}. Start rosbridge, then retry.`)
            : await listen(c.id);
        } else {
          await sleep(i === 0 ? 300 + STEP_MS : STEP_MS);
          if (c.id === fail && !failedOnce.current) { failedOnce.current = true; problem = c.fix; }
        }
        if (cancelled) return;
        if (problem) { set(i, 'problem', problem); return; }
        set(i, 'ready');
      }
    })();
    return () => { cancelled = true; };
  }, [run, fail, enabled]);

  const retry = useCallback(() => setRun((r) => r + 1), []);
  const problem = states.indexOf('problem');
  const allReady = states.every((s) => s === 'ready');
  return { states, messages, retry, problem, allReady, checking: problem < 0 && !allReady };
}
