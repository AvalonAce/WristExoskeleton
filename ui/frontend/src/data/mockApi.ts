// In-browser stand-in for the backend. Seeded with fictional demo patients.
// Edits are kept in localStorage so they survive a page refresh (best effort only).
import type { ExoApi, NewPatient, Patient, Session, SessionSummary } from './types';

const KEY = 'wrist-exo-mock-v2'; // bump when the seed changes so old demo data is replaced

interface Store {
  patients: Patient[];
  sessions: Session[];
}

const daysAgo = (d: number, h = 10) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
};
const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60000).toISOString();

function seed(): Store {
  const patients: Patient[] = [
    { id: 'p1', code: 'P-001', displayName: 'Demo Patient', side: 'R', springSetting: 2,
      romGoalFlexDeg: 60, romGoalExtDeg: 50, notes: 'Post distal radius fracture, week 8.',
      createdAt: daysAgo(21) },
  ];
  // Five past sessions with slowly improving range of motion.
  const sessions: Session[] = [];
  for (let k = 0; k < 5; k++) {
    const start = daysAgo((5 - k) * 3);
    sessions.push({
      id: `s${k + 1}`, patientId: 'p1', startedAt: start, endedAt: plusMin(start, 12),
      springSetting: k < 2 ? 1 : 2, notes: '',
      summary: {
        reps: 20 + 2 * k,
        maxFlexDeg: 38 + 4 * k,
        maxExtDeg: 30 + 3 * k,
        meanOnsetLeadMs: 110 + 10 * Math.sin(k),
      },
    });
  }
  return { patients, sessions };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable: fall back to seed */
  }
  return seed();
}

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class MockApi implements ExoApi {
  private db: Store = load();

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch {
      /* ignore */
    }
  }

  /** Dev helper: wipe edits and restore the seeded demo data. */
  reset() {
    this.db = seed();
    this.save();
  }

  listPatients() {
    return delay([...this.db.patients]);
  }

  getPatient(id: string) {
    return delay(this.db.patients.find((p) => p.id === id));
  }

  createPatient(p: NewPatient) {
    const created: Patient = { ...p, id: newId('p'), createdAt: new Date().toISOString() };
    this.db.patients.push(created);
    this.save();
    return delay(created);
  }

  updatePatient(id: string, patch: Partial<NewPatient>) {
    const p = this.db.patients.find((x) => x.id === id);
    if (!p) return Promise.reject(new Error(`No patient ${id}`));
    Object.assign(p, patch);
    this.save();
    return delay({ ...p });
  }

  deletePatient(id: string) {
    this.db.patients = this.db.patients.filter((p) => p.id !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.patientId !== id);
    this.save();
    return delay(undefined);
  }

  listSessions(patientId: string) {
    const list = this.db.sessions
      .filter((s) => s.patientId === patientId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return delay(list);
  }

  startSession(patientId: string, opts: { springSetting: number; notes: string }) {
    const s: Session = {
      id: newId('s'), patientId, startedAt: new Date().toISOString(), endedAt: null,
      springSetting: opts.springSetting, notes: opts.notes, summary: null,
    };
    this.db.sessions.push(s);
    this.save();
    return delay(s);
  }

  stopSession(sessionId: string, result: { summary: SessionSummary; notes: string }) {
    const s = this.db.sessions.find((x) => x.id === sessionId);
    if (!s) return Promise.reject(new Error(`No session ${sessionId}`));
    s.endedAt = new Date().toISOString();
    // The UI cannot measure onset lead; the mock fills in a plausible value.
    s.summary = { ...result.summary, meanOnsetLeadMs: result.summary.meanOnsetLeadMs ?? 118 };
    s.notes = result.notes;
    this.save();
    return delay({ ...s });
  }

  discardSession(sessionId: string) {
    this.db.sessions = this.db.sessions.filter((x) => x.id !== sessionId);
    this.save();
    return delay(undefined);
  }
}
