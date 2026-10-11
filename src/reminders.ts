// Caregiver reminders ("remind me to give Dad his meds at 8pm").
//
// The AI turns a request into a local date/time; this code converts it to an
// instant in the caregiver's time zone, stores it, and a timer sends it when
// due through Spectrum. Times are always confirmed back in the caregiver's
// local time, formatted by code (not the model).
//
// Rules (see docs/CONTEXT.md, "The rules everything follows"):
// - STOP silences reminders; START resumes them.
// - An active emergency holds reminders for a while.
// - A reminder the caregiver asked for at a specific time counts as consent,
//   so it is sent at that time even inside quiet hours.

import type { Reminder, Store } from "./store.ts";

export const DEFAULT_TIMEZONE = "America/New_York";
/** After a safety alert, hold routine reminders this long. */
export const EMERGENCY_HOLD_MS = 60 * 60_000;
/** Reminders more than this late (bot was off) are sent with a "was due" note. */
export const LATE_NOTE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------- time zones

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

function partsIn(timeZone: string, at: Date): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The UTC instant for a wall-clock time in `timeZone` (handles DST). */
export function zonedToUtc(local: LocalParts, timeZone: string): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const seen = partsIn(timeZone, new Date(guess));
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += asUtc - seenAsUtc;
  }
  return new Date(guess);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** e.g. "Sun, Oct 11 at 8:00 PM" in the caregiver's time zone. */
export function formatLocal(at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  return `${day} at ${time}`;
}

export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
}

/** "2026-10-11 20:05 (Sunday)" — current local time for the AI's context. */
export function localNowLabel(now: Date, timeZone: string): string {
  const p = partsIn(timeZone, now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${weekday})`;
}

// ---------------------------------------------------------------- scheduling

export type Repeat = "none" | "daily" | "weekly" | "interval";

export type ScheduleResult = { ok: true; dueAt: Date } | { ok: false; error: string };

/**
 * Resolves a requested local time ("20:00", optional "2026-10-12") to the next
 * matching instant. With no date, uses today if still ahead, else tomorrow.
 */
export function resolveDue(time: string, date: string | null, timeZone: string, now: Date): ScheduleResult {
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!t) return { ok: false, error: `"${time}" isn't a 24-hour time like 20:00.` };
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (date) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!d) return { ok: false, error: `"${date}" isn't a date like 2026-10-12.` };
    const due = zonedToUtc({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour, minute }, timeZone);
    if (Number.isNaN(due.getTime())) return { ok: false, error: "That date doesn't exist." };
    if (due.getTime() <= now.getTime()) return { ok: false, error: "That time has already passed. Ask for a future time." };
    return { ok: true, dueAt: due };
  }

  const today = partsIn(timeZone, now);
  let due = zonedToUtc({ ...today, hour, minute }, timeZone);
  if (due.getTime() <= now.getTime()) due = addLocalDays(due, 1, timeZone);
  return { ok: true, dueAt: due };
}

/** Same wall-clock time `days` later in `timeZone` (DST-safe). */
export function addLocalDays(at: Date, days: number, timeZone: string): Date {
  const p = partsIn(timeZone, at);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: p.hour, minute: p.minute },
    timeZone,
  );
}

/** Local date of `at` plus `days`, at hour:minute local time. */
export function localDayAt(at: Date, days: number, hour: number, minute: number, timeZone: string): Date {
  const p = partsIn(timeZone, at);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute }, timeZone);
}

/**
 * New due time for a reminder moved to `time` (HH:MM local): same day as its
 * next occurrence if still ahead, otherwise the next day.
 */
export function rescheduledDue(r: Reminder, time: string, now: Date): ScheduleResult {
  const p = partsIn(r.timeZone, new Date(r.dueAt));
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay = resolveDue(time, `${p.year}-${pad(p.month)}-${pad(p.day)}`, r.timeZone, now);
  return sameDay.ok ? sameDay : resolveDue(time, null, r.timeZone, now);
}

/** "every 4 weeks", "every 10 days", "every day". */
export function cadence(days: number): string {
  if (days === 1) return "every day";
  if (days === 7) return "every week";
  return days % 7 === 0 ? `every ${days / 7} weeks` : `every ${days} days`;
}

function stepDays(reminder: Reminder): number | null {
  if (reminder.repeat === "daily") return 1;
  if (reminder.repeat === "weekly") return 7;
  if (reminder.repeat === "interval") return reminder.intervalDays ?? null;
  return null;
}

export function nextOccurrence(reminder: Reminder, now: Date): Date | null {
  const step = stepDays(reminder);
  if (!step) return null;
  let due = addLocalDays(new Date(reminder.dueAt), step, reminder.timeZone);
  while (due.getTime() <= now.getTime()) due = addLocalDays(due, step, reminder.timeZone);
  return due;
}

export function describeReminder(r: Reminder): string {
  const at = new Date(r.dueAt);
  const when =
    r.repeat === "daily"
      ? `every day at ${formatTime(at, r.timeZone)}`
      : r.repeat === "weekly"
        ? `every ${new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, weekday: "long" }).format(at)} at ${formatTime(at, r.timeZone)}`
        : r.repeat === "interval" && r.intervalDays
          ? `${cadence(r.intervalDays)}, next ${formatLocal(at, r.timeZone)}`
          : formatLocal(at, r.timeZone);
  return `"${r.what}", ${when}`;
}

export function reminderText(r: Reminder, now: Date): string {
  const late = now.getTime() - Date.parse(r.dueAt) > LATE_NOTE_MS;
  const base = `Reminder: ${r.what}`;
  return late ? `${base} (this was due ${formatLocal(new Date(r.dueAt), r.timeZone)})` : base;
}

// ---------------------------------------------------------------- delivery

export interface DeliveryDeps {
  store: Store;
  /** Sends a text to the caregiver; throws on failure. */
  send: (caregiver: string, text: string) => Promise<void>;
  now?: () => Date;
  log?: (message: string, data?: unknown) => void;
  /**
   * Optional custom text for a reminder (e.g. a check-in invitation).
   * Return null to skip this occurrence without sending, undefined for the default text.
   */
  compose?: (reminder: Reminder, now: Date) => Promise<string | null | undefined>;
}

function advanceAfter(r: Reminder, now: Date): Date | null {
  const next = nextOccurrence(r, now);
  if (next) r.dueAt = next.toISOString();
  else r.status = "sent";
  return next;
}

/** Sends every due reminder once. Returns how many were sent. */
export async function deliverDue(deps: DeliveryDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  let sent = 0;

  for (const r of deps.store.dueReminders(now)) {
    const state = deps.store.caregiver(r.caregiver);
    if (state.optedOut) continue; // STOP: hold until START
    if (state.lastEmergencyAt && now.getTime() - Date.parse(state.lastEmergencyAt) < EMERGENCY_HOLD_MS) {
      continue; // EM6: hold routine reminders during an active emergency
    }

    const composed = deps.compose ? await deps.compose(r, now) : undefined;
    if (composed === null) {
      advanceAfter(r, now);
      await deps.store.commit();
      log("[lucidity.reminder] skipped", { id: r.id });
      continue;
    }
    const text = composed ?? reminderText(r, now);
    try {
      await deps.send(r.caregiver, text);
    } catch (err) {
      r.attempts += 1;
      if (r.attempts >= MAX_ATTEMPTS) r.status = "failed";
      await deps.store.commit();
      log("[lucidity.reminder] send failed", { id: r.id, attempts: r.attempts, err });
      continue;
    }

    sent += 1;
    r.attempts = 0;
    r.lastSentAt = now.toISOString();
    const next = advanceAfter(r, now);
    await deps.store.appendTurn(r.caregiver, "assistant", text);
    log("[lucidity.reminder] sent", { id: r.id, next: next?.toISOString() ?? null });
  }
  return sent;
}

/** Polls for due reminders. Returns a function that stops the timer. */
export function startReminderLoop(deps: DeliveryDeps, everyMs = 20_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDue(deps);
    } catch (err) {
      deps.log?.("[lucidity.reminder] loop error", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
