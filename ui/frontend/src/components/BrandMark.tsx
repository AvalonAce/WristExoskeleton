// The Wrist Exo icon as SVG, so its parts can move. Animated: the muscle signal draws across
// the band first, then the hand flexes and extends at the wrist (EMG leads movement, like the
// real data). When `animate` turns false, the current cycle finishes before it stops.
import { useEffect, useId, useState } from 'react';
import { BAND, FOREARM, HAND, SIGNAL } from './brandPaths';
import './BrandMark.css';

interface Props {
  animate?: boolean;
  size?: number;
  title?: string;
}

export default function BrandMark({ animate = false, size = 320, title = 'Wrist Exo' }: Props) {
  const clip = useId().replace(/:/g, '');
  const [running, setRunning] = useState(animate);

  useEffect(() => { if (animate) setRunning(true); }, [animate]);

  return (
    <svg className={`bm ${running ? 'bm--run' : ''}`} viewBox="130 60 1040 1100" width={size}
      role="img" aria-label={title}>
      <defs>
        <clipPath id={clip}>
          <rect className="bm-reveal" x="360" y="730" width="250" height="150" />
        </clipPath>
      </defs>
      <path className="bm-body" fillRule="evenodd" d={FOREARM} />
      <g className="bm-hand" onAnimationIteration={() => { if (!animate) setRunning(false); }}>
        <path className="bm-body" fillRule="evenodd" d={HAND} />
      </g>
      <path className="bm-band" fillRule="evenodd" d={BAND} />
      {/* band-colored fill under the signal, so the undrawn part of the trace reads as band */}
      <path className="bm-band" fillRule="evenodd" d={SIGNAL} />
      <g clipPath={running ? `url(#${clip})` : undefined}>
        <path className="bm-signal" fillRule="evenodd" d={SIGNAL} />
      </g>
    </svg>
  );
}
