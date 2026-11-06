// Shared frame for sign in and connect. The icon stays on the left across both steps:
// still on sign in, animated while the connect checks run.
import { useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import BrandMark from '../../components/BrandMark';
import './start.css';

interface StartCtx {
  setBusy: (busy: boolean) => void;
}

export function useStart() {
  return useOutletContext<StartCtx>();
}

export default function StartLayout() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-mark">
          <BrandMark animate={busy} size={340} />
        </div>
        <div className="start-side">
          <Outlet context={{ setBusy } satisfies StartCtx} />
        </div>
      </div>
    </div>
  );
}
