// The data contract between the UI and its sources (mock now, ROS + backend later).
// WristState mirrors exo_ws/src/wrist_exo_msgs/msg/WristState.msg field for field:
// if the .msg changes, change it here too.

// ---- live stream -----------------------------------------------------------

export const Phase = {
  REST: 0,
  ONSET: 1,
  FLEX: 2,
  EXT: 3,
  HOLD: 4,
  RETURN: 5,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const PHASE_NAMES: Record<Phase, string> = {
  0: 'Rest',
  1: 'Onset',
  2: 'Flexion',
  3: 'Extension',
  4: 'Hold',
  5: 'Return',
};

// Bit flags, OR-ed together in WristState.status. 0 = all healthy.
export const Status = {
  FOREARM_STALE: 1,
  EMG_STALE: 2,
  EMG_FLEX_SAT: 4,
  EMG_EXT_SAT: 8,
} as const;

export const STATUS_NAMES: Record<number, string> = {
  1: 'Forearm IMU stale',
  2: 'EMG stale',
  4: 'Flexor EMG saturated',
  8: 'Extensor EMG saturated',
};

// The exo resists one direction per set; the PT re-orients it between sets.
export type SetMode = 'flexion' | 'extension';
export const Mode = { NONE: 0, FLEXION: 1, EXTENSION: 2 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];
export const modeName = (m: number): SetMode | null =>
  m === Mode.FLEXION ? 'flexion' : m === Mode.EXTENSION ? 'extension' : null;
/** +1 for flexion sets, -1 for extension sets. */
export const modeDir = (m: SetMode) => (m === 'flexion' ? 1 : -1);

// Bit flags in WristState.calib. Steps are requested with ExoControl.calibrate().
export const Calib = {
  NEUTRAL: 1,   // anatomical neutral set (angle 0)
  START: 2,     // start pose recorded (start_deg valid)
  DIRECTION: 4, // test movement done, sensor sign confirmed
  BUSY: 8,      // a step is running
  FLIPPED: 16,  // test movement found the sensors reversed (handled automatically)
  FAILED: 32,   // test movement too small; repeat it
} as const;
export type CalibStep = 'neutral' | 'start' | 'test_move' | 'cancel';

export interface WristState {
  t: number; // header.stamp in seconds (Unix time)
  angle_deg: number; // from anatomical neutral, + = flexion
  velocity_dps: number;
  emg_flex: number; // envelope, ADC counts (later %MVC)
  emg_ext: number;
  emg_flex_thresh: number;
  emg_ext_thresh: number;
  phase: Phase;
  status: number;
  mode: Mode;
  calib: number; // Calib bits
  start_deg: number; // start pose of the current set; 0 until recorded
  excursion_deg: number; // degrees moved from the start pose in the working direction (>= 0)
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** Commands to the exo's state node (ROS: /wrist/mode and /wrist/calibrate, std_msgs/String). */
export interface ExoControl {
  setMode(mode: SetMode | 'none'): void;
  calibrate(step: CalibStep): void;
}

export interface ExoStream {
  /** Called once per WristState (100 Hz). Returns an unsubscribe function. */
  subscribe(cb: (s: WristState) => void): () => void;
  onConnection(cb: (c: ConnectionState) => void): () => void;
  readonly connection: ConnectionState;
}

// ---- raw sensors (sensor test) --------------------------------------------
// Straight from the firmware topics: /imu/hand, /imu/forearm (sensor_msgs/Imu), /emg/raw (EmgBatch).

export type ImuName = 'hand' | 'forearm';

export interface ImuSample {
  t: number; // header.stamp, s
  ax: number; ay: number; az: number; // m/s^2
  gx: number; gy: number; gz: number; // rad/s
}

export interface EmgBatchSample {
  t: number; // stamp of the batch's first sample, s
  rate: number; // Hz
  flexor: number[]; // ADC counts 0-4095
  extensor: number[];
}

export interface RawFeed {
  onImu(which: ImuName, cb: (s: ImuSample) => void): () => void;
  onEmg(cb: (s: EmgBatchSample) => void): () => void;
  onConnection(cb: (c: ConnectionState) => void): () => void;
  readonly connection: ConnectionState;
  /** Where the data comes from, shown in the UI (e.g. "ws://localhost:9090" or "Demo data"). */
  readonly label: string;
}

// ---- profiles + sessions ---------------------------------------------------

export type Side = 'L' | 'R';

export interface Patient {
  id: string;
  code: string; // de-identified label shown in the UI, e.g. "P-001"
  displayName: string;
  side: Side; // treated wrist
  springSetting: number; // notch index on the exo (see torque calibration)
  romGoalFlexDeg: number;
  romGoalExtDeg: number;
  notes: string;
  createdAt: string; // ISO date
}

export type NewPatient = Omit<Patient, 'id' | 'createdAt'>;

export interface SessionSummary {
  reps: number;
  maxFlexDeg: number;
  maxExtDeg: number;
  meanOnsetLeadMs: number | null; // EMG onset before motion onset (the research metric); null = not computed
  peakTorqueNm?: number; // estimated, from angle + spring setting
}

/** One block of reps in one direction, with one exo orientation and spring setting. */
export interface SessionSet {
  mode: SetMode;
  springSetting: number;
  startedAt: string;
  endedAt: string;
  startDeg: number; // start pose (deg from neutral)
  reps: number;
  bestDeg: number; // furthest angle reached in the working direction (deg from neutral, signed)
  bestExcursionDeg: number; // furthest movement from the start pose
  peakTorqueNm: number; // estimated
}

export interface Session {
  id: string;
  patientId: string;
  startedAt: string;
  endedAt: string | null; // null = still recording
  springSetting: number;
  sets?: SessionSet[]; // one-direction exo; absent on older sessions
  notes: string;
  summary: SessionSummary | null; // null until processed
}

export interface ExoApi {
  listPatients(): Promise<Patient[]>;
  getPatient(id: string): Promise<Patient | undefined>;
  createPatient(p: NewPatient): Promise<Patient>;
  updatePatient(id: string, patch: Partial<NewPatient>): Promise<Patient>;
  deletePatient(id: string): Promise<void>;

  listSessions(patientId: string): Promise<Session[]>;
  startSession(patientId: string, opts: { springSetting: number; notes: string }): Promise<Session>;
  /** End a recording and keep it. The live backend will compute the summary from recorded data. */
  stopSession(sessionId: string, result: { summary: SessionSummary; notes: string; sets?: SessionSet[] }): Promise<Session>;
  /** End a recording and throw it away. */
  discardSession(sessionId: string): Promise<void>;
}
