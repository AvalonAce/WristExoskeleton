// Live data from the exo through rosbridge_server (websocket, default ws://localhost:9090).
// One shared connection; it retries every 2 s while disconnected, so the UI can be opened
// before the ROS side is up.
//
// Topics (see exo_ws): /imu/hand, /imu/forearm (sensor_msgs/msg/Imu, 100 Hz),
// /emg/raw (wrist_exo_msgs/msg/EmgBatch, 100 msg/s x 10 samples), /wrist/state (WristState).
// rosbridge must be started from a terminal with exo_ws sourced, or it cannot decode the
// wrist_exo_msgs types.
import ROSLIB from 'roslib';
import type {
  ConnectionState, EmgBatchSample, ExoStream, ImuName, ImuSample, Phase, RawFeed, WristState,
} from './types';

interface Stamp { sec: number; nanosec: number }
interface Vec3 { x: number; y: number; z: number }
interface ImuMsg { header: { stamp: Stamp }; linear_acceleration: Vec3; angular_velocity: Vec3 }
interface EmgMsg { header: { stamp: Stamp }; sample_rate: number; flexor: number[]; extensor: number[] }
type WristStateMsg = Omit<WristState, 't'> & { header: { stamp: Stamp } };

const sec = (s: Stamp) => s.sec + s.nanosec * 1e-9;
const num = (v: number | null | undefined) => (v == null ? NaN : v); // rosbridge may send NaN as null

class RosConnection {
  readonly ros: ROSLIB.Ros;
  state: ConnectionState = 'connecting';
  lastError = '';
  private subs = new Set<(c: ConnectionState) => void>();
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly url: string) {
    this.ros = new ROSLIB.Ros({});
    this.ros.on('connection', () => this.set('connected'));
    this.ros.on('error', (e: unknown) => { this.lastError = String((e as Event)?.type ?? e); });
    this.ros.on('close', () => { this.set('disconnected'); this.scheduleRetry(); });
    this.open();
  }

  private open() {
    this.set('connecting');
    try { this.ros.connect(this.url); } catch { this.scheduleRetry(); }
  }

  private scheduleRetry() {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; if (this.state !== 'connected') this.open(); }, 2000);
  }

  private set(c: ConnectionState) {
    if (this.state === c) return;
    this.state = c;
    this.subs.forEach((cb) => cb(c));
  }

  onConnection(cb: (c: ConnectionState) => void) {
    this.subs.add(cb);
    cb(this.state);
    return () => { this.subs.delete(cb); };
  }

  /** Subscribe to a topic; re-subscribes after every reconnect. Returns an unsubscribe function. */
  topic<M>(name: string, messageType: string, cb: (m: M) => void) {
    let t: ROSLIB.Topic | null = null;
    const make = () => {
      t?.unsubscribe();
      t = new ROSLIB.Topic({ ros: this.ros, name, messageType, queue_length: 1 });
      t.subscribe((m) => cb(m as unknown as M));
    };
    make();
    const off = this.onConnection((c) => { if (c === 'connected') make(); });
    return () => { off(); t?.unsubscribe(); t = null; };
  }
}

let shared: RosConnection | null = null;
export function rosConnection(url: string) {
  if (!shared) shared = new RosConnection(url);
  return shared;
}

export class RosbridgeStream implements ExoStream {
  private conn: RosConnection;
  constructor(url: string) { this.conn = rosConnection(url); }
  get connection() { return this.conn.state; }
  onConnection(cb: (c: ConnectionState) => void) { return this.conn.onConnection(cb); }

  subscribe(cb: (s: WristState) => void) {
    return this.conn.topic<WristStateMsg>('/wrist/state', 'wrist_exo_msgs/msg/WristState', (m) => cb({
      t: sec(m.header.stamp),
      angle_deg: num(m.angle_deg),
      velocity_dps: num(m.velocity_dps),
      emg_flex: num(m.emg_flex),
      emg_ext: num(m.emg_ext),
      emg_flex_thresh: num(m.emg_flex_thresh),
      emg_ext_thresh: num(m.emg_ext_thresh),
      phase: m.phase as Phase,
      status: m.status,
    }));
  }
}

export class RosRawFeed implements RawFeed {
  private conn: RosConnection;
  constructor(url: string) { this.conn = rosConnection(url); }
  get label() { return this.conn.url; }
  get connection() { return this.conn.state; }
  onConnection(cb: (c: ConnectionState) => void) { return this.conn.onConnection(cb); }

  onImu(which: ImuName, cb: (s: ImuSample) => void) {
    return this.conn.topic<ImuMsg>(`/imu/${which}`, 'sensor_msgs/msg/Imu', (m) => cb({
      t: sec(m.header.stamp),
      ax: m.linear_acceleration.x, ay: m.linear_acceleration.y, az: m.linear_acceleration.z,
      gx: m.angular_velocity.x, gy: m.angular_velocity.y, gz: m.angular_velocity.z,
    }));
  }

  onEmg(cb: (s: EmgBatchSample) => void) {
    return this.conn.topic<EmgMsg>('/emg/raw', 'wrist_exo_msgs/msg/EmgBatch', (m) => cb({
      t: sec(m.header.stamp), rate: m.sample_rate, flexor: m.flexor, extensor: m.extensor,
    }));
  }
}
