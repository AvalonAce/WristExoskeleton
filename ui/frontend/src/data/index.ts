// The ONE place that decides where data comes from. Pages import `stream`, `raw` and `api` here.
// VITE_DATA=mock (default): everything faked in the browser, no ROS needed.
// VITE_DATA=live (`npm run dev:live`): live sensor data through rosbridge (VITE_ROSBRIDGE_URL,
//   default ws://localhost:9090). Profiles, sessions and health checks are saved by the
//   storage server (ui/backend/server.py, reached at /api) to ~/exo_data, plus rosbags.
import { MockApi, ServerPersistence } from './mockApi';
import { MockRawFeed } from './mockRaw';
import { MockStream } from './mockStream';
import { RosControl, RosRawFeed, RosbridgeStream } from './rosbridge';
import { NoRecorder, ServerRecorder } from './recorder';
import type { ExoApi, ExoControl, ExoStream, RawFeed, Recorder } from './types';

export const DATA_MODE = (import.meta.env.VITE_DATA ?? 'mock') as 'mock' | 'live';
export const ROSBRIDGE_URL = import.meta.env.VITE_ROSBRIDGE_URL ?? 'ws://localhost:9090';

interface Sources { stream: ExoStream; raw: RawFeed; control: ExoControl; api: ExoApi; recorder: Recorder }

function makeSources(): Sources {
  if (DATA_MODE === 'live') {
    return {
      stream: new RosbridgeStream(ROSBRIDGE_URL), raw: new RosRawFeed(ROSBRIDGE_URL),
      control: new RosControl(ROSBRIDGE_URL), api: new MockApi(new ServerPersistence(), false),
      recorder: new ServerRecorder(),
    };
  }
  const stream = new MockStream();
  return { stream, raw: new MockRawFeed(stream), control: stream, api: new MockApi(), recorder: new NoRecorder() };
}

export const { stream, raw, control, api, recorder } = makeSources();
export * from './types';
