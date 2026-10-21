import type {
  CustomSection,
  DailyPerformance,
  DayKind,
  GeneralNote,
  Hobby,
  HobbyAccent,
  HobbyNote,
  MonthOccurrence,
  Priority,
  Schedule,
  ScheduleType,
  SectionKind,
  Task,
  TaskDuration,
  TaskStatus,
  TimeLog,
  Weekday,
} from "./types";

/**
 * Momentum backup format.
 *
 * The goal is portability of the user's *history*, not of the current screen.
 * A backup therefore carries the source data everything else is derived from —
 * task definitions, time logs, custom-section schedules, the per-day
 * performance snapshot, hobbies and notes, plus the user's own settings — so a
 * restored install can rebuild streaks, weekly/monthly/yearly performance,
 * recovery days and today's state from first principles rather than trusting a
 * cached number.
 *
 * ### Source of truth
 * - `tasks`       what the user needs to do (and its live state today)
 * - `logs`        date-stamped time, the raw material of all history
 * - `sections`    custom sections *with their schedules* (never flattened)
 * - `performance` the per-day snapshot — needed because planned minutes for a
 *                 since-deleted task cannot be recomputed from the tasks that
 *                 remain, so the snapshot is genuinely irreplaceable history
 * - `hobbies`, `generalNotes`, `hobbyNotes`
 * - `settings`    the user's preferences
 *
 * Note history: backups written before the note split carried a single `notes`
 * array. That shape is still read (see {@link migrateData}), so an old backup
 * restores correctly — each legacy note is routed to `generalNotes` or
 * `hobbyNotes` by whether it had a hobby.
 *
 * ### Deliberately excluded (and why)
 * - `notifications`              a runtime queue, rebuilt by the planner
 * - `scheduledNotificationIds`   Android alarm IDs are device-specific
 * - `notificationPermissionState` a device fact, not a user preference — the
 *                                 app re-checks live permission on every boot
 * - `lastRolloverDate`           derived; the boot rollover recomputes it
 *
 * Everything derived (today's performance row, recovery classification, the
 * streak, the reminder queue) is recomputed after import through the normal
 * boot pipeline, so nothing here can contradict the app's own rules.
 */

export const BACKUP_FORMAT = "momentum-backup";

/** Current backup format version. Bump when the shape changes. */
export const BACKUP_VERSION = 1;

/**
 * Version 0 = a legacy, unversioned export (no `version` field, or `0`).
 * No versioned backup predates v1, but early builds and hand-made exports may
 * predate versioning, and the migration chain needs a real, testable first
 * step so future formats have a pattern to follow.
 */
export const LEGACY_BACKUP_VERSION = 0;

export const APP_VERSION =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_VERSION) || "0.1.0";

/** Meta keys that belong to the user and must travel with a backup. */
export const BACKUP_META_KEYS = [
  "notificationSettings",
  "profileName",
  "firstRunAt",
  "accentColor",
  "lastBackupAt",
  // Notification anti-drift timestamps: restoring these prevents a wall of
  // reminders the instant the user reopens a freshly-restored workspace.
  // (Permission state and native alarm IDs are device facts and are excluded.)
  "lastNotificationAt",
  "lastMeaningfulActivityAt",
  "lastTaskCompletionAt",
  "lastInteractionAt",
] as const;

export type BackupMetaKey = (typeof BACKUP_META_KEYS)[number];

const META_KEY_SET = new Set<string>(BACKUP_META_KEYS);

export interface BackupCounts {
  tasks: number;
  logs: number;
  sections: number;
  performance: number;
  hobbies: number;
  generalNotes: number;
  hobbyNotes: number;
}

export interface BackupSettings {
  /** Curated persistent meta values (see {@link BACKUP_META_KEYS}). */
  meta: Record<string, unknown>;
  /** Stored theme preference (`light` | `dark` | `system`), or null. */
  theme: string | null;
}

export interface BackupData {
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  performance: DailyPerformance[];
  hobbies: Hobby[];
  /** Standalone scratchpad notes — never attached to a hobby. */
  generalNotes: GeneralNote[];
  /** Notes owned by exactly one hobby. */
  hobbyNotes: HobbyNote[];
  settings: BackupSettings;
}

export interface MomentumBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  counts?: Partial<BackupCounts>;
  data: BackupData;
}

/** What the export/import UI needs to describe a backup without mutating it. */
export interface BackupSummary {
  exportedAt: string;
  appVersion?: string;
  version: number;
  counts: BackupCounts;
  repairs: string[];
  bytes: number;
}

export type ParseResult =
  | { ok: true; backup: MomentumBackup; summary: BackupSummary }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export interface BackupSource {
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  performance: DailyPerformance[];
  hobbies: Hobby[];
  generalNotes: GeneralNote[];
  hobbyNotes: HobbyNote[];
  meta: { key: string; value: unknown }[];
  theme: string | null;
}

/** Assemble a versioned backup object from the live tables. */
export function buildBackup(
  source: BackupSource,
  now: Date = new Date(),
  appVersion: string = APP_VERSION,
): MomentumBackup {
  const meta: Record<string, unknown> = {};
  for (const row of source.meta) {
    if (META_KEY_SET.has(row.key) && row.value !== undefined) {
      meta[row.key] = row.value;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    counts: {
      tasks: source.tasks.length,
      logs: source.logs.length,
      sections: source.sections.length,
      performance: source.performance.length,
      hobbies: source.hobbies.length,
      generalNotes: source.generalNotes.length,
      hobbyNotes: source.hobbyNotes.length,
    },
    data: {
      tasks: source.tasks,
      logs: source.logs,
      sections: source.sections,
      performance: source.performance,
      hobbies: source.hobbies,
      generalNotes: source.generalNotes,
      hobbyNotes: source.hobbyNotes,
      settings: { meta, theme: source.theme },
    },
  };
}

export function serializeBackup(backup: MomentumBackup): string {
  // Pretty-printed: a backup is a document a user may open, inspect or repair
  // by hand. The size cost is irrelevant next to that.
  return JSON.stringify(backup, null, 2);
}

/** Filesystem-safe, sortable, human-readable name. */
export function backupFilename(prefix: string, date: Date = new Date()): string {
  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `${prefix}-${key}.json`;
}

export function summarizeBackup(backup: MomentumBackup, bytes = 0): BackupSummary {
  const d = backup.data;
  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    version: backup.version,
    counts: {
      tasks: d.tasks.length,
      logs: d.logs.length,
      sections: d.sections.length,
      performance: d.performance.length,
      hobbies: d.hobbies.length,
      generalNotes: d.generalNotes.length,
      hobbyNotes: d.hobbyNotes.length,
    },
    repairs: [],
    bytes,
  };
}

/* ------------------------------------------------------------------ */
/* Validation primitives                                               */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SECTION_KINDS: SectionKind[] = ["daily", "remainder", "occasional", "custom"];
const TASK_STATUSES: TaskStatus[] = ["active", "completed", "accomplished"];
const SCHEDULE_TYPES: ScheduleType[] = [
  "daily",
  "weekly",
  "custom",
  "monthly-date",
  "monthly-weekday",
];
const OCCURRENCES: MonthOccurrence[] = ["first", "second", "third", "fourth", "last"];
const PRIORITIES: Priority[] = ["low", "medium", "high"];
const DAY_KINDS: DayKind[] = ["normal", "recovery", "inactive"];
const ACCENTS: HobbyAccent[] = [
  "teal",
  "blue",
  "purple",
  "green",
  "orange",
  "red",
  "pink",
  "sand",
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNonEmptyStr = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

/** Accumulates human-readable notes about deterministic repairs. */
class Repairs {
  private readonly parts: string[] = [];
  private readonly counts = new Map<string, number>();

  add(what: string): void {
    this.counts.set(what, (this.counts.get(what) ?? 0) + 1);
  }

  list(): string[] {
    for (const [what, n] of this.counts) {
      this.parts.push(n === 1 ? what : `${what} (×${n})`);
    }
    return [...this.parts];
  }
}

/** Dedupe by a key, keeping the last occurrence (later rows win). */
function dedupeBy<T>(rows: T[], keyOf: (row: T) => string): { rows: T[]; removed: number } {
  const map = new Map<string, T>();
  for (const row of rows) map.set(keyOf(row), row);
  return { rows: [...map.values()], removed: rows.length - map.size };
}

/* ------------------------------------------------------------------ */
/* Row normalizers                                                     */
/* ------------------------------------------------------------------ */

type RowResult<T> = { ok: true; row: T } | { ok: false; error: string };

function normalizeSchedule(raw: unknown, where: string): Schedule | null | string {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) return `${where}: schedule must be an object`;
  const type = raw.type;
  if (!isStr(type) || !SCHEDULE_TYPES.includes(type as ScheduleType)) {
    return `${where}: schedule has an unknown type`;
  }
  const schedule: Schedule = { type: type as ScheduleType };

  if (raw.days !== undefined) {
    if (!Array.isArray(raw.days)) return `${where}: schedule.days must be an array`;
    const days: Weekday[] = [];
    for (const d of raw.days) {
      if (!isNum(d) || d < 0 || d > 6) return `${where}: schedule.days contains an invalid weekday`;
      days.push(d as Weekday);
    }
    schedule.days = days;
  }
  if (raw.dayOfMonth !== undefined) {
    if (raw.dayOfMonth === "last") schedule.dayOfMonth = "last";
    else if (isNum(raw.dayOfMonth) && raw.dayOfMonth >= 1 && raw.dayOfMonth <= 31) {
      schedule.dayOfMonth = Math.round(raw.dayOfMonth);
    } else return `${where}: schedule.dayOfMonth is invalid`;
  }
  if (raw.occurrence !== undefined) {
    if (!isStr(raw.occurrence) || !OCCURRENCES.includes(raw.occurrence as MonthOccurrence)) {
      return `${where}: schedule.occurrence is invalid`;
    }
    schedule.occurrence = raw.occurrence as MonthOccurrence;
  }
  if (raw.weekday !== undefined) {
    if (!isNum(raw.weekday) || raw.weekday < 0 || raw.weekday > 6) {
      return `${where}: schedule.weekday is invalid`;
    }
    schedule.weekday = raw.weekday as Weekday;
  }
  for (const field of ["startTime", "endTime"] as const) {
    const v = raw[field];
    if (v === undefined) continue;
    if (!isStr(v) || !/^\d{1,2}:\d{2}$/.test(v)) return `${where}: schedule.${field} is invalid`;
    schedule[field] = v;
  }
  return schedule;
}

/** Duration is either a positive whole number or explicitly absent (`null`). */
function normalizeDurationValue(raw: unknown): TaskDuration {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const rounded = Math.round(raw);
    return rounded > 0 ? rounded : null;
  }
  return null;
}

function normalizeTask(raw: unknown, index: number): RowResult<Task> {
  const where = `task #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  if (!isStr(raw.title)) return { ok: false, error: `${where} has no title` };

  const section = isStr(raw.section) ? (raw.section as SectionKind) : "daily";
  if (!SECTION_KINDS.includes(section)) return { ok: false, error: `${where} has an unknown section` };

  const status = isStr(raw.status) ? (raw.status as TaskStatus) : "active";
  if (!TASK_STATUSES.includes(status)) return { ok: false, error: `${where} has an unknown status` };

  if (raw.priority !== undefined && (!isStr(raw.priority) || !PRIORITIES.includes(raw.priority as Priority))) {
    return { ok: false, error: `${where} has an invalid priority` };
  }
  if (raw.dueDate !== undefined && (!isStr(raw.dueDate) || !DATE_RE.test(raw.dueDate))) {
    return { ok: false, error: `${where} has an invalid due date` };
  }

  const schedule = normalizeSchedule(raw.schedule, where);
  if (typeof schedule === "string") return { ok: false, error: schedule };

  // Advanced per-task reminder time. A malformed value is dropped (the task
  // then follows its section's time) rather than failing the whole import.
  const notifyTime =
    isStr(raw.notifyTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.notifyTime)
      ? raw.notifyTime
      : undefined;

  // Explicit one-shot reminder. A value that is not a real timestamp is
  // dropped rather than failing the import.
  const remindAt =
    isStr(raw.remindAt) && Number.isFinite(new Date(raw.remindAt).getTime())
      ? new Date(raw.remindAt).toISOString()
      : undefined;

  const planned = normalizeDurationValue(raw.estimatedMinutes);
  const remainingRaw = raw.remainingMinutes;
  const remaining = isNum(remainingRaw)
    ? Math.max(0, Math.round(remainingRaw))
    : (planned ?? 0);

  const task: Task = {
    id: raw.id,
    title: raw.title,
    section,
    customSectionId: isNonEmptyStr(raw.customSectionId) ? raw.customSectionId : undefined,
    estimatedMinutes: planned,
    remainingMinutes: status === "active" ? remaining : 0,
    description: isStr(raw.description) && raw.description.length > 0 ? raw.description : undefined,
    nextAction: isStr(raw.nextAction) && raw.nextAction.length > 0 ? raw.nextAction : undefined,
    dueDate: isStr(raw.dueDate) ? raw.dueDate : undefined,
    priority: isStr(raw.priority) ? (raw.priority as Priority) : undefined,
    schedule: schedule ?? undefined,
    notifyTime,
    remindAt,
    status,
    createdAt: isStr(raw.createdAt) && raw.createdAt.length > 0 ? raw.createdAt : new Date().toISOString(),
    completedAt: isStr(raw.completedAt) ? raw.completedAt : undefined,
    accomplishedAt: isStr(raw.accomplishedAt) ? raw.accomplishedAt : undefined,
  };
  return { ok: true, row: task };
}

function normalizeLog(raw: unknown, index: number): RowResult<TimeLog> {
  const where = `time log #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  if (!isNonEmptyStr(raw.taskId)) return { ok: false, error: `${where} has no task` };
  if (!isNum(raw.minutes) || raw.minutes < 0) return { ok: false, error: `${where} has invalid minutes` };
  if (!isStr(raw.date) || !DATE_RE.test(raw.date)) return { ok: false, error: `${where} has an invalid date` };
  return {
    ok: true,
    row: {
      id: raw.id,
      taskId: raw.taskId,
      minutes: Math.round(raw.minutes),
      date: raw.date,
    },
  };
}

function normalizeSection(raw: unknown, index: number): RowResult<CustomSection> {
  const where = `section #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  if (!isStr(raw.name)) return { ok: false, error: `${where} has no name` };
  const schedule = normalizeSchedule(raw.schedule, where);
  if (typeof schedule === "string") return { ok: false, error: schedule };
  return {
    ok: true,
    row: {
      id: raw.id,
      name: raw.name,
      icon: isStr(raw.icon) && raw.icon.length > 0 ? raw.icon : undefined,
      // A section without a schedule is meaningless (it owns recurrence), so a
      // missing one defaults to daily rather than silently never firing.
      schedule: schedule ?? { type: "daily" },
      createdAt: isStr(raw.createdAt) && raw.createdAt.length > 0 ? raw.createdAt : new Date().toISOString(),
    },
  };
}

function normalizePerformance(raw: unknown, index: number): RowResult<DailyPerformance> {
  const where = `performance row #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isStr(raw.date) || !DATE_RE.test(raw.date)) return { ok: false, error: `${where} has an invalid date` };
  if (!isNum(raw.plannedMinutes) || raw.plannedMinutes < 0) {
    return { ok: false, error: `${where} has invalid planned minutes` };
  }
  if (!isNum(raw.completedMinutes) || raw.completedMinutes < 0) {
    return { ok: false, error: `${where} has invalid completed minutes` };
  }
  if (raw.percentage !== null && raw.percentage !== undefined && !isNum(raw.percentage)) {
    return { ok: false, error: `${where} has an invalid percentage` };
  }
  if (raw.kind !== undefined && (!isStr(raw.kind) || !DAY_KINDS.includes(raw.kind as DayKind))) {
    return { ok: false, error: `${where} has an invalid day kind` };
  }
  return {
    ok: true,
    row: {
      date: raw.date,
      plannedMinutes: Math.max(0, Math.round(raw.plannedMinutes)),
      completedMinutes: Math.max(0, Math.round(raw.completedMinutes)),
      percentage:
        raw.percentage === null || raw.percentage === undefined
          ? null
          : Math.max(0, Math.min(100, Math.round(raw.percentage))),
      // `kind` is recomputed on import (applyRecoveryKinds), but preserving the
      // stored value keeps the file a faithful snapshot of what was on disk.
      kind: isStr(raw.kind) ? (raw.kind as DayKind) : undefined,
    },
  };
}

function normalizeHobby(raw: unknown, index: number): RowResult<Hobby> {
  const where = `hobby #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  if (!isStr(raw.name)) return { ok: false, error: `${where} has no name` };
  if (raw.accent !== undefined && (!isStr(raw.accent) || !ACCENTS.includes(raw.accent as HobbyAccent))) {
    return { ok: false, error: `${where} has an invalid accent` };
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    row: {
      id: raw.id,
      name: raw.name,
      description: isStr(raw.description) && raw.description.length > 0 ? raw.description : undefined,
      icon: isStr(raw.icon) && raw.icon.length > 0 ? raw.icon : undefined,
      accent: isStr(raw.accent) ? (raw.accent as HobbyAccent) : undefined,
      createdAt: isStr(raw.createdAt) && raw.createdAt.length > 0 ? raw.createdAt : now,
      updatedAt: isStr(raw.updatedAt) && raw.updatedAt.length > 0 ? raw.updatedAt : now,
    },
  };
}

function normalizeGeneralNote(raw: unknown, index: number): RowResult<GeneralNote> {
  const where = `note #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  if (raw.title !== undefined && !isStr(raw.title)) return { ok: false, error: `${where} has an invalid title` };
  if (raw.content !== undefined && !isStr(raw.content)) return { ok: false, error: `${where} has invalid content` };
  const now = new Date().toISOString();
  return {
    ok: true,
    row: {
      id: raw.id,
      title: isStr(raw.title) ? raw.title : "",
      content: isStr(raw.content) ? raw.content : "",
      createdAt: isStr(raw.createdAt) && raw.createdAt.length > 0 ? raw.createdAt : now,
      updatedAt: isStr(raw.updatedAt) && raw.updatedAt.length > 0 ? raw.updatedAt : now,
    },
  };
}

function normalizeHobbyNote(raw: unknown, index: number): RowResult<HobbyNote> {
  const where = `hobby note #${index + 1}`;
  if (!isObj(raw)) return { ok: false, error: `${where} is not an object` };
  if (!isNonEmptyStr(raw.id)) return { ok: false, error: `${where} has no id` };
  // A hobby note with no hobby is meaningless; it belongs in General Notes.
  // Reject here and let the migration route it, rather than storing an ownerless row.
  if (!isNonEmptyStr(raw.hobbyId)) return { ok: false, error: `${where} has no hobby` };
  if (raw.title !== undefined && !isStr(raw.title)) return { ok: false, error: `${where} has an invalid title` };
  if (raw.content !== undefined && !isStr(raw.content)) return { ok: false, error: `${where} has invalid content` };
  const now = new Date().toISOString();
  return {
    ok: true,
    row: {
      id: raw.id,
      hobbyId: raw.hobbyId,
      title: isStr(raw.title) ? raw.title : "",
      content: isStr(raw.content) ? raw.content : "",
      createdAt: isStr(raw.createdAt) && raw.createdAt.length > 0 ? raw.createdAt : now,
      updatedAt: isStr(raw.updatedAt) && raw.updatedAt.length > 0 ? raw.updatedAt : now,
    },
  };
}

/** Run a table's normalizers, failing with the first precise error. */
function normalizeTable<T>(
  raw: unknown,
  label: string,
  normalize: (row: unknown, index: number) => RowResult<T>,
): { ok: true; rows: T[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, rows: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `The backup's ${label} list is not an array.` };
  const rows: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = normalize(raw[i], i);
    if (!result.ok) return { ok: false, error: `The backup is damaged — ${result.error}.` };
    rows.push(result.row);
  }
  return { ok: true, rows };
}

/* ------------------------------------------------------------------ */
/* Migration chain                                                     */
/* ------------------------------------------------------------------ */

/**
 * Upgrade an older backup payload to the current shape.
 *
 * Each step is separate and cumulative so a v0 file walks 0→1, and a future v2
 * walks 0→1→2. Nothing here rewrites user content — migrations only add or
 * reshape containers, because content is the one thing a backup exists to keep.
 */
export function migrateBackup(
  raw: Record<string, unknown>,
  fromVersion: number,
): { data: Record<string, unknown>; repairs: string[] } {
  let data = isObj(raw.data) ? { ...raw.data } : {};
  const repairs: string[] = [];

  if (fromVersion < 1) {
    // v0 → v1: versioning introduced `settings` and the Hobby & Notes tables.
    // An unversioned export simply has neither, so both default to empty.
    data = {
      tasks: [],
      logs: [],
      sections: [],
      performance: [],
      hobbies: [],
      notes: [],
      ...data,
      settings: isObj(data.settings) ? data.settings : { meta: {}, theme: null },
    };
    repairs.push("Upgraded an older, unversioned Momentum backup");
  }

  // Note split (any version before the current one): a single `notes` array is
  // routed into `generalNotes` and `hobbyNotes`. This is a reshape only — every
  // row keeps its id, title, content and timestamps, so no note is lost, and a
  // hobby note stays with its hobby instead of leaking into the scratchpad.
  if (!Array.isArray(data.generalNotes) && !Array.isArray(data.hobbyNotes)) {
    const legacy = Array.isArray(data.notes) ? data.notes : [];
    const generalNotes: unknown[] = [];
    const hobbyNotes: unknown[] = [];
    for (const raw of legacy) {
      if (isObj(raw) && isNonEmptyStr(raw.hobbyId)) hobbyNotes.push(raw);
      else generalNotes.push(raw);
    }
    data = { ...data, generalNotes, hobbyNotes };
    if (legacy.length > 0) repairs.push("Separated general notes from hobby notes");
  }

  return { data, repairs };
}

/* ------------------------------------------------------------------ */
/* Parse + validate                                                    */
/* ------------------------------------------------------------------ */

const INVALID = "This backup file is invalid or was created by an unsupported version of Momentum.";

/**
 * Parse and fully validate a backup document.
 *
 * Validation is complete before any write happens, so a corrupt file can never
 * leave the database half-replaced. Where a problem is *repairable* without
 * losing user data (an orphaned log, a note whose hobby is gone, duplicate
 * ids) it is repaired and reported; where it is not, the whole file is
 * rejected with a specific reason.
 */
export function parseBackup(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON, so it can't be a Momentum backup." };
  }

  if (!isObj(parsed)) {
    return { ok: false, error: "That file doesn't contain a Momentum backup." };
  }
  if (parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: "That file isn't a Momentum backup." };
  }

  // Version: absent/0 means a legacy unversioned export.
  const rawVersion = parsed.version;
  if (rawVersion !== undefined && rawVersion !== null && !isNum(rawVersion)) {
    return { ok: false, error: INVALID };
  }
  const version = isNum(rawVersion) ? Math.floor(rawVersion) : LEGACY_BACKUP_VERSION;
  if (version < 0) return { ok: false, error: INVALID };
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `This backup was created by a newer version of Momentum (backup v${version}). Update Momentum, then try again.`,
    };
  }
  if (!isObj(parsed.data)) {
    return { ok: false, error: "This backup is missing its data, so it can't be restored." };
  }

  const repairs = new Repairs();
  const migrated = migrateBackup(parsed, version);
  for (const note of migrated.repairs) repairs.add(note);
  const data = migrated.data;

  const tasksRes = normalizeTable(data.tasks, "task", normalizeTask);
  if (!tasksRes.ok) return { ok: false, error: tasksRes.error };
  const logsRes = normalizeTable(data.logs, "time log", normalizeLog);
  if (!logsRes.ok) return { ok: false, error: logsRes.error };
  const sectionsRes = normalizeTable(data.sections, "section", normalizeSection);
  if (!sectionsRes.ok) return { ok: false, error: sectionsRes.error };
  const perfRes = normalizeTable(data.performance, "performance", normalizePerformance);
  if (!perfRes.ok) return { ok: false, error: perfRes.error };
  const hobbiesRes = normalizeTable(data.hobbies, "hobby", normalizeHobby);
  if (!hobbiesRes.ok) return { ok: false, error: hobbiesRes.error };
  const generalNotesRes = normalizeTable(data.generalNotes, "note", normalizeGeneralNote);
  if (!generalNotesRes.ok) return { ok: false, error: generalNotesRes.error };
  const hobbyNotesRes = normalizeTable(data.hobbyNotes, "hobby note", normalizeHobbyNote);
  if (!hobbyNotesRes.ok) return { ok: false, error: hobbyNotesRes.error };

  // Duplicate primary keys would make the write fail outright; dedupe instead.
  const tasks = dedupeBy(tasksRes.rows, (t) => t.id);
  if (tasks.removed > 0) repairs.add("Merged duplicate tasks");
  const logs = dedupeBy(logsRes.rows, (l) => l.id);
  if (logs.removed > 0) repairs.add("Merged duplicate time logs");
  const sections = dedupeBy(sectionsRes.rows, (s) => s.id);
  if (sections.removed > 0) repairs.add("Merged duplicate sections");
  const performance = dedupeBy(perfRes.rows, (p) => p.date);
  if (performance.removed > 0) repairs.add("Merged duplicate performance rows");
  const hobbies = dedupeBy(hobbiesRes.rows, (h) => h.id);
  if (hobbies.removed > 0) repairs.add("Merged duplicate hobbies");
  const generalNotes = dedupeBy(generalNotesRes.rows, (n) => n.id);
  if (generalNotes.removed > 0) repairs.add("Merged duplicate notes");
  const hobbyNotes = dedupeBy(hobbyNotesRes.rows, (n) => n.id);
  if (hobbyNotes.removed > 0) repairs.add("Merged duplicate hobby notes");

  /* ---------------------------- relations ---------------------------- */

  const taskIds = new Set(tasks.rows.map((t) => t.id));
  const sectionIds = new Set(sections.rows.map((s) => s.id));
  const hobbyIds = new Set(hobbies.rows.map((h) => h.id));

  // A custom task with no resolvable section has no schedule to recur on, so it
  // would silently vanish from every list. Park it in the Deadlines list instead
  // — visible and actionable beats invisible.
  const repairedTasks = tasks.rows.map((t) => {
    if (t.section !== "custom") return t;
    if (t.customSectionId && sectionIds.has(t.customSectionId)) return t;
    repairs.add("Moved custom tasks back to Deadlines (their section was missing)");
    return { ...t, section: "remainder" as SectionKind, customSectionId: undefined };
  });

  // Logs are a task's history. Without its task they can contribute nothing to
  // performance, so keeping them would only pad the file.
  const linkedLogs = logs.rows.filter((l) => {
    if (taskIds.has(l.taskId)) return true;
    repairs.add("Removed time logs whose task no longer exists");
    return false;
  });

  // A hobby note must keep its hobby. If that hobby is gone, the note is not
  // deleted — it moves to General Notes, so its content stays reachable while
  // the "hobby notes live inside a hobby" invariant holds.
  const adoptedNotes: GeneralNote[] = [];
  const filedHobbyNotes = hobbyNotes.rows.filter((n) => {
    if (hobbyIds.has(n.hobbyId)) return true;
    repairs.add("Moved notes from a missing hobby to General Notes");
    adoptedNotes.push({
      id: n.id,
      title: n.title,
      content: n.content,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    });
    return false;
  });
  const mergedGeneralNotes = dedupeBy([...generalNotes.rows, ...adoptedNotes], (n) => n.id);
  if (mergedGeneralNotes.removed > 0) repairs.add("Merged duplicate notes");

  /* ---------------------------- settings ----------------------------- */

  const rawSettings = isObj(data.settings) ? data.settings : {};
  const meta: Record<string, unknown> = {};
  if (isObj(rawSettings.meta)) {
    for (const [key, value] of Object.entries(rawSettings.meta)) {
      // Only the curated allowlist travels: unknown keys could be device state.
      if (META_KEY_SET.has(key)) meta[key] = value;
    }
  }
  const theme = isStr(rawSettings.theme) && ["light", "dark", "system"].includes(rawSettings.theme)
    ? rawSettings.theme
    : null;

  const backup: MomentumBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: isStr(parsed.exportedAt) ? parsed.exportedAt : "",
    appVersion: isStr(parsed.appVersion) ? parsed.appVersion : undefined,
    counts: isObj(parsed.counts) ? (parsed.counts as Partial<BackupCounts>) : undefined,
    data: {
      tasks: repairedTasks,
      logs: linkedLogs,
      sections: sections.rows,
      performance: performance.rows,
      hobbies: hobbies.rows,
      generalNotes: mergedGeneralNotes.rows,
      hobbyNotes: filedHobbyNotes,
      settings: { meta, theme },
    },
  };

  return {
    ok: true,
    backup,
    summary: { ...summarizeBackup(backup, text.length), repairs: repairs.list() },
  };
}
