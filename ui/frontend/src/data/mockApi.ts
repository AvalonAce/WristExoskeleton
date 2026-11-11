// Profiles, sessions and health checks. One JSON document ("store"), kept either
//   - in this browser (demo mode: localStorage, seeded with a fictional demo patient), or
//   - on disk via the storage server (live mode: ui/backend/server.py -> ~/exo_data/store.json).
// The class name is historical; it is the real store in live mode.
import type {
  ExoApi, HealthCheck, NewPatient, Patient, Session, SessionSet, SessionSummary, StorageInfo,
} from './types';

const KEY = 'wrist-exo-mock-v3'; // bump when the seed changes so old demo data is replaced

export interface Store {
  patients: Patient[];
  sessions: Session[];
  healthChecks: HealthCheck[];
}

export interface Persistence {
  readonly info: StorageInfo;
  load(): Promise<Store | null>; // null = nothing saved yet
  save(s: Store): Promise<void>;
}

export class BrowserPersistence implements Persistence {
  info: StorageInfo = { where: 'browser', label: 'Saved in this browser (demo data)' };
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Store) : null;
    } catch {
      return null;
    }
  }
  async save(s: Store) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
}

/** ~/exo_data/store.json through the storage server. Saves are sent one at a time, in order. */
export class ServerPersistence implements Persistence {
  info: StorageInfo = { where: 'server', label: 'Saved to ~/exo_data on this computer' };
  private queue: Promise<void> = Promise.resolve();
  async load() {
    const r = await fetch('/api/store', { cache: 'no-store' });
    if (!r.ok) throw new Error(`storage server: ${r.status}`);
    const s = (await r.json()) as Partial<Store>;
    return s.patients ? (s as Store) : null;
  }
  save(s: Store) {
    const body = JSON.stringify(s);
    this.queue = this.queue.then(async () => {
      try {
        const r = await fetch('/api/store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        if (!r.ok) throw new Error(`save failed (${r.status})`);
        this.info = { ...this.info, error: undefined };
      } catch (e) {
        this.info = { ...this.info, error: `Not saved: ${(e as Error).message}. Is the storage server running?` };
        throw e;
      }
    });
    return this.queue;
  }
}

const daysAgo = (d: number, h = 10) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
};
const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60000).toISOString();

function seed(): Store {
  return { ...seedDemo(), healthChecks: [] };
}

function seedDemo(): Omit<Store, 'healthChecks'> {
  const patients: Patient[] = [
    { id: 'p1', code: 'P-001', displayName: 'Demo Patient', side: 'R', springFlex: 2, springExt: 1,
      romGoalFlexDeg: 60, romGoalExtDeg: 50, notes: 'Post distal radius fracture, week 8.',
      createdAt: daysAgo(21) },
  ];
  // Five past sessions, each a flexion set then an extension set, slowly improving.
  // The first session has only a flexion set.
  const sessions: Session[] = [];
  for (let k = 0; k < 5; k++) {
    const start = daysAgo((5 - k) * 3);
    const flexBest = 38 + 4 * k;
    const extBest = 30 + 3 * k;
    const spring = k < 2 ? 1 : 2;
    const sets: SessionSet[] = [{
      mode: 'flexion', springSetting: spring, startedAt: plusMin(start, 1), endedAt: plusMin(start, 6),
      startDeg: -28, reps: 10 + k, bestDeg: flexBest, bestExcursionDeg: flexBest + 28,
      peakTorqueNm: (spring === 1 ? 0.75 : 1.1) * (flexBest + 28) / 60,
    }];
    if (k > 0) {
      sets.push({
        mode: 'extension', springSetting: 1, startedAt: plusMin(start, 7), endedAt: plusMin(start, 12),
        startDeg: 25, reps: 9 + k, bestDeg: -extBest, bestExcursionDeg: extBest + 25,
        peakTorqueNm: 0.75 * (extBest + 25) / 60,
      });
    }
    sessions.push({
      id: `s${k + 1}`, patientId: 'p1', startedAt: start, endedAt: plusMin(start, 12),
      springSetting: spring, notes: '', sets,
      summary: {
        reps: sets.reduce((n, x) => n + x.reps, 0),
        maxFlexDeg: flexBest,
        maxExtDeg: k > 0 ? extBest : 0,
        meanOnsetLeadMs: 110 + 10 * Math.sin(k),
        peakTorqueNm: Math.max(...sets.map((x) => x.peakTorqueNm)),
      },
    });
  }
  return { patients, sessions };
}

const empty = (): Store => ({ patients: [], sessions: [], healthChecks: [] });

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class MockApi implements ExoApi {
  private db: Store = empty();
  private ready: Promise<void>;

  /** `seedDemo`: start with the fictional demo patient when nothing is saved yet. */
  constructor(private persist: Persistence = new BrowserPersistence(), seedDemo = true) {
    this.ready = persist.load().then(
      (s) => { this.db = s ? { ...empty(), ...s } : seedDemo ? seed() : empty(); },
      (e) => {
        // Never overwrite the file after a failed load: keep working in memory only.
        this.persist = { info: { ...persist.info, error: `Could not load saved data: ${(e as Error).message}` },
          load: async () => null, save: async () => {} };
        this.db = empty();
      },
    );
  }

  get storage() {
    return this.persist.info;
  }

  private save() {
    this.persist.save(this.db).catch(() => { /* error kept in storage.error */ });
  }

  /** Dev helper: wipe edits and restore the seeded demo data. */
  async reset() {
    await this.ready;
    this.db = seed();
    this.save();
  }

  async listHealthChecks(patientId: string) {
    await this.ready;
    return delay(this.db.healthChecks.filter((h) => h.patientId === patientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
  }

  async saveHealthCheck(hc: HealthCheck) {
    await this.ready;
    const copy: HealthCheck = JSON.parse(JSON.stringify(hc));
    const i = this.db.healthChecks.findIndex((h) => h.id === hc.id);
    if (i >= 0) this.db.healthChecks[i] = copy; else this.db.healthChecks.push(copy);
    this.save();
    return delay(copy);
  }

  async deleteHealthCheck(id: string) {
    await this.ready;
    this.db.healthChecks = this.db.healthChecks.filter((h) => h.id !== id);
    this.save();
    return delay(undefined);
  }

  async listPatients() {
    await this.ready;
    return delay([...this.db.patients]);
  }

  async getPatient(id: string) {
    await this.ready;
    return delay(this.db.patients.find((p) => p.id === id));
  }

  async createPatient(p: NewPatient) {
    await this.ready;
    const created: Patient = { ...p, id: newId('p'), createdAt: new Date().toISOString() };
    this.db.patients.push(created);
    this.save();
    return delay(created);
  }

  async updatePatient(id: string, patch: Partial<NewPatient>) {
    await this.ready;
    const p = this.db.patients.find((x) => x.id === id);
    if (!p) throw new Error(`No patient ${id}`);
    Object.assign(p, patch);
    this.save();
    return delay({ ...p });
  }

  async deletePatient(id: string) {
    await this.ready;
    this.db.patients = this.db.patients.filter((p) => p.id !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.patientId !== id);
    this.db.healthChecks = this.db.healthChecks.filter((h) => h.patientId !== id);
    this.save();
    return delay(undefined);
  }

  async listSessions(patientId: string) {
    await this.ready;
    const list = this.db.sessions
      .filter((s) => s.patientId === patientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return delay(list);
  }

  async startSession(patientId: string, opts: { springSetting: number; notes: string }) {
    await this.ready;
    const s: Session = {
      id: newId('s'), patientId, startedAt: new Date().toISOString(), endedAt: null,
      springSetting: opts.springSetting, notes: opts.notes, summary: null,
    };
    this.db.sessions.push(s);
    this.save();
    return delay(s);
  }

  async stopSession(sessionId: string, result: { summary: SessionSummary; notes: string; sets?: SessionSet[] }) {
    await this.ready;
    const s = this.db.sessions.find((x) => x.id === sessionId);
    if (!s) throw new Error(`No session ${sessionId}`);
    s.endedAt = new Date().toISOString();
    // Onset lead is not measured yet (needs the classifier + backend), so it stays null ("—").
    s.summary = { ...result.summary };
    s.notes = result.notes;
    if (result.sets) s.sets = result.sets;
    this.save();
    return delay({ ...s });
  }

  async discardSession(sessionId: string) {
    await this.ready;
    this.db.sessions = this.db.sessions.filter((x) => x.id !== sessionId);
    this.save();
    return delay(undefined);
  }
}
