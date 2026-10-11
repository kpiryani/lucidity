// Per-caregiver memory and structured records, persisted to a local JSON file.
// Phase 3 replaces this with Postgres; the shape mirrors the tables we'll need.
//
// Rules borrowed from LUCIDITY_CONNECT*.md (used as benchmarks):
// - Unknown stays `null`; it is never coerced to "no" or 0.
// - Every record keeps the caregiver's own words, when it was reported, and
//   the period it describes.
// - Corrections keep prior values in `revisions`; nothing is silently overwritten.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Scores } from "./instruments/index.ts";
import type { InstrumentCode, ItemResponse, Part } from "./instruments/types.ts";

export type { InstrumentCode };

export const NPI_DOMAINS = [
  "delusions",
  "hallucinations",
  "agitation_aggression",
  "depression_dysphoria",
  "anxiety",
  "elation_euphoria",
  "apathy_indifference",
  "disinhibition",
  "irritability_lability",
  "aberrant_motor_behavior",
  "nighttime_behaviors",
  "appetite_eating",
] as const;
export type NpiDomain = (typeof NPI_DOMAINS)[number];

export const GENERAL_TOPICS = [
  "activity_or_hobby",
  "daily_function",
  "caregiver_wellbeing",
  "medical_context",
  "positive_moment",
  "other",
] as const;
export type GeneralTopic = (typeof GENERAL_TOPICS)[number];

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface Revision {
  at: string;
  previous: Record<string, unknown>;
}

interface RecordBase {
  id: string;
  caregiver: string; // sender address (phone/email) — the respondent
  quote: string; // caregiver's own words
  observedPeriod: string | null; // e.g. "last night", "this week"
  reportedAt: string;
  updatedAt: string;
  source: "caregiver_text";
  revisions: Revision[];
}

export interface NpiObservation extends RecordBase {
  kind: "npi_observation";
  domain: NpiDomain;
  severity: 1 | 2 | 3 | null; // null = not yet reported
  distress: 0 | 1 | 2 | 3 | 4 | 5 | null; // caregiver distress; null = not yet reported
  followupDeclined: boolean;
}

export interface LucidityEpisode extends RecordBase {
  kind: "lucidity_episode";
  duration: string | null;
  context: string | null; // what was happening just before (time, visitors, music…)
  whatWasSaidOrDone: string | null;
  afterState: string | null;
  followupDeclined: boolean;
}

export interface GeneralNote extends RecordBase {
  kind: "general_note";
  topic: GeneralTopic;
  summary: string;
}

export interface Alert {
  id: string;
  caregiver: string;
  level: "emergency" | "urgent";
  source: "rules" | "ai";
  reasons: string[];
  text: string;
  at: string;
}

/** One administration of a standardized questionnaire (assessment). */
export interface Assessment {
  id: string;
  kind: "assessment";
  instrument: InstrumentCode;
  instrumentVersion: string;
  administrationMode: "imessage_verbatim";
  recallPeriod: string;
  respondent: string; // caregiver address
  respondentRole: "caregiver";
  patientLabel: string; // e.g. "Dad", as the caregiver refers to them
  status: "in_progress" | "paused" | "completed" | "incomplete";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  responses: ItemResponse[];
  /** Where the questionnaire is up to. */
  cursor: { itemIndex: number; part: Part };
  /** Unclear replies to the current prompt so far. */
  retries: number;
  scores: Scores | null;
  source: "caregiver_imessage";
}

export interface CaregiverState {
  address: string;
  optedOut: boolean;
  history: ChatTurn[];
  /** How the caregiver refers to the patient ("Dad"); one patient per caregiver. */
  patientLabel?: string;
  /** Whether the caregiver wants to see questionnaire results (asked once). */
  scoreConsent?: boolean;
  /** Assessment whose results we asked consent to show; answer pending. */
  awaitingScoreConsentFor?: string;
  /** Questionnaire the AI offered; waiting for YES/NO. */
  pendingOffer?: { instrument: InstrumentCode; patientLabel: string; offeredAt: string };
  /** Last time a check-in was offered (at most one offer a day). */
  lastOfferedAt?: string;
  /** Last time each questionnaire offer was declined. */
  declinedOffers?: Partial<Record<InstrumentCode, string>>;
  /** In-progress or paused assessment id. */
  activeAssessmentId?: string;
}

interface Data {
  caregivers: Record<string, CaregiverState>;
  observations: NpiObservation[];
  lucidityEpisodes: LucidityEpisode[];
  notes: GeneralNote[];
  alerts: Alert[];
  assessments: Assessment[];
}

const HISTORY_LIMIT = 40;

const emptyData = (): Data => ({
  caregivers: {},
  observations: [],
  lucidityEpisodes: [],
  notes: [],
  alerts: [],
  assessments: [],
});

const now = () => new Date().toISOString();

export class Store {
  private data: Data = emptyData();
  private writing: Promise<void> = Promise.resolve();

  /** `path` of `null` keeps everything in memory (used by tests). */
  constructor(private readonly path: string | null) {}

  async load(): Promise<void> {
    if (!this.path) return;
    try {
      this.data = { ...emptyData(), ...JSON.parse(await readFile(this.path, "utf8")) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // Writes are serialized and atomic (write temp file, then rename).
  private save(): Promise<void> {
    const path = this.path;
    if (!path) return Promise.resolve();
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.tmp`, snapshot);
      await rename(`${path}.tmp`, path);
    });
    return this.writing;
  }

  /** Persist after mutating objects returned by this store. */
  commit(): Promise<void> {
    return this.save();
  }

  async addAssessment(assessment: Assessment): Promise<Assessment> {
    this.data.assessments.push(assessment);
    await this.save();
    return assessment;
  }

  assessment(id: string | undefined): Assessment | undefined {
    return id ? this.data.assessments.find((a) => a.id === id) : undefined;
  }

  /** Most recent completed/incomplete assessment of an instrument for this caregiver. */
  latestAssessment(caregiver: string, instrument: InstrumentCode): Assessment | undefined {
    return this.data.assessments
      .filter((a) => a.respondent === caregiver && a.instrument === instrument && a.completedAt)
      .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))[0];
  }

  caregiver(address: string): CaregiverState {
    return (this.data.caregivers[address] ??= { address, optedOut: false, history: [] });
  }

  async setOptedOut(address: string, optedOut: boolean): Promise<void> {
    this.caregiver(address).optedOut = optedOut;
    await this.save();
  }

  async appendTurn(address: string, role: ChatTurn["role"], text: string): Promise<void> {
    const history = this.caregiver(address).history;
    history.push({ role, text, at: now() });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    await this.save();
  }

  recentHistory(address: string, limit = 20): ChatTurn[] {
    return this.caregiver(address).history.slice(-limit);
  }

  async addObservation(
    input: Pick<NpiObservation, "caregiver" | "domain" | "severity" | "distress" | "quote" | "observedPeriod">,
  ): Promise<NpiObservation> {
    const at = now();
    const record: NpiObservation = {
      kind: "npi_observation",
      id: `obs_${randomUUID().slice(0, 8)}`,
      ...input,
      followupDeclined: false,
      reportedAt: at,
      updatedAt: at,
      source: "caregiver_text",
      revisions: [],
    };
    this.data.observations.push(record);
    await this.save();
    return record;
  }

  async addLucidityEpisode(
    input: Pick<
      LucidityEpisode,
      "caregiver" | "quote" | "observedPeriod" | "duration" | "context" | "whatWasSaidOrDone" | "afterState"
    >,
  ): Promise<LucidityEpisode> {
    const at = now();
    const record: LucidityEpisode = {
      kind: "lucidity_episode",
      id: `luc_${randomUUID().slice(0, 8)}`,
      ...input,
      followupDeclined: false,
      reportedAt: at,
      updatedAt: at,
      source: "caregiver_text",
      revisions: [],
    };
    this.data.lucidityEpisodes.push(record);
    await this.save();
    return record;
  }

  async addNote(
    input: Pick<GeneralNote, "caregiver" | "topic" | "summary" | "quote" | "observedPeriod">,
  ): Promise<GeneralNote> {
    const at = now();
    const record: GeneralNote = {
      kind: "general_note",
      id: `note_${randomUUID().slice(0, 8)}`,
      ...input,
      reportedAt: at,
      updatedAt: at,
      source: "caregiver_text",
      revisions: [],
    };
    this.data.notes.push(record);
    await this.save();
    return record;
  }

  async addAlert(input: Omit<Alert, "id" | "at">): Promise<Alert> {
    const alert: Alert = { id: `alert_${randomUUID().slice(0, 8)}`, at: now(), ...input };
    this.data.alerts.push(alert);
    await this.save();
    return alert;
  }

  /**
   * Applies non-undefined fields to a record owned by `caregiver`, keeping the
   * previous values in `revisions`. Returns null if the record isn't theirs.
   */
  async updateObservation(
    caregiver: string,
    id: string,
    changes: Partial<Pick<NpiObservation, "severity" | "distress" | "observedPeriod" | "followupDeclined">>,
  ): Promise<NpiObservation | null> {
    const record = this.data.observations.find((o) => o.id === id && o.caregiver === caregiver);
    if (!record) return null;
    applyChanges(record, changes);
    await this.save();
    return record;
  }

  async updateLucidityEpisode(
    caregiver: string,
    id: string,
    changes: Partial<
      Pick<LucidityEpisode, "duration" | "context" | "whatWasSaidOrDone" | "afterState" | "observedPeriod" | "followupDeclined">
    >,
  ): Promise<LucidityEpisode | null> {
    const record = this.data.lucidityEpisodes.find((e) => e.id === id && e.caregiver === caregiver);
    if (!record) return null;
    applyChanges(record, changes);
    await this.save();
    return record;
  }

  /** This caregiver's recent observations and episodes, oldest first (for agent context). */
  recentRecords(caregiver: string, withinHours = 48, limit = 12): Array<NpiObservation | LucidityEpisode> {
    const cutoff = Date.now() - withinHours * 3_600_000;
    const recent = (r: RecordBase) => r.caregiver === caregiver && Date.parse(r.reportedAt) >= cutoff;
    return [...this.data.observations.filter(recent), ...this.data.lucidityEpisodes.filter(recent)]
      .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt))
      .slice(-limit);
  }

  /** This caregiver's recent general notes, oldest first. */
  recentNotes(caregiver: string, withinHours = 48): GeneralNote[] {
    const cutoff = Date.now() - withinHours * 3_600_000;
    return this.data.notes.filter((n) => n.caregiver === caregiver && Date.parse(n.reportedAt) >= cutoff);
  }

  /** Read-only snapshot, for tests and debugging. */
  snapshot(): Readonly<Data> {
    return this.data;
  }
}

function applyChanges(record: RecordBase, changes: Record<string, unknown>): void {
  const target = record as unknown as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || target[key] === value) continue;
    previous[key] = target[key];
    target[key] = value;
  }
  if (Object.keys(previous).length === 0) return;
  record.revisions.push({ at: now(), previous });
  record.updatedAt = now();
}
