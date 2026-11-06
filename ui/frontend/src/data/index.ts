// The ONE place that decides where data comes from. Pages import `stream`, `raw` and `api` here.
// VITE_DATA=mock (default): everything faked in the browser, no ROS needed.
// VITE_DATA=live (`npm run dev:live`): live sensor data through rosbridge (VITE_ROSBRIDGE_URL,
//   default ws://localhost:9090). Profiles and sessions still live in the browser (MockApi)
//   until the recording backend exists.
import { MockApi } from './mockApi';
import { MockRawFeed } from './mockRaw';
import { MockStream } from './mockStream';
import { RosRawFeed, RosbridgeStream } from './rosbridge';
import type { ExoApi, ExoStream, RawFeed } from './types';

export const DATA_MODE = (import.meta.env.VITE_DATA ?? 'mock') as 'mock' | 'live';
export const ROSBRIDGE_URL = import.meta.env.VITE_ROSBRIDGE_URL ?? 'ws://localhost:9090';

function makeSources(): { stream: ExoStream; raw: RawFeed; api: ExoApi } {
  if (DATA_MODE === 'live') {
    return { stream: new RosbridgeStream(ROSBRIDGE_URL), raw: new RosRawFeed(ROSBRIDGE_URL), api: new MockApi() };
  }
  const stream = new MockStream();
  return { stream, raw: new MockRawFeed(stream), api: new MockApi() };
}

export const { stream, raw, api } = makeSources();
export * from './types';
