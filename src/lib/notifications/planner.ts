/**
 * Momentum's reminder philosophy, expressed as one pure module.
 *
 * This is the ONLY place that decides whether a reminder is appropriate. UI
 * components never schedule notifications; the store never invents one. Every
 * reminder Moventum arms comes from `evaluateReminder(context)`.
 *
 * The product rules (and their reasons) in brief:
 *
 * - **Daily tasks** are expected every day: one reminder at their time, plus at
 *   most one later day-level check-in. Never repeatedly, never after they are
 *   done.
 * - **Deadline tasks** count down as the date approaches: one nudge a week out,
 *   another at 3 days, one the day before, the due day itself, then a daily
 *   nudge while overdue. Without a date they get a gentle weekly check-in.
 * - **Bucket-list tasks** use their due date when they have one; undated items
 *   get one calm check-in twice a month, never a recurring nag.
 * - **Custom sections** own their recurrence: a task is only considered on days
 *   its section is active (`isSectionActiveOnDate`).
 * - **Explicit user reminders** (`task.remindAt`, or a time the user typed on
 *   the task) always win, and are never blocked by quiet hours.
 * - **Motivational** nudges are rare, grounded in real remaining work, and
 *   never shame anyone.
 *
 * Priority: HIGH (user reminder / deadline / due / overdue) > MEDIUM (daily,
 * section, weekly) > LOW (bucket-list check-in). One reminder per task per day,
 * highest priority wins; reminders that would fire together are grouped instead
 * of becoming a barrage.
 */

import { NOTIFICATION_DEFAULTS } from "../config";
import { addDays, dateKey, parseKey } from "../date";
import { formatMinutes } from "../format";
import { isSectionActiveOnDate, scheduleForTask, scheduleOccursOn } from "../schedule";
import { isTimedTask } from "../duration";
import { isTaskDoneOn, remainingOn } from "../task-state";
import type { CustomSection, Task, TimeLog } from "../types";
import type { NotificationSettings } from "./types";

export type ReminderPriority = "high" | "medium" | "low";

export type ReminderType =
  | "explicit"
  | "deadline"
  | "due"
  | "overdue"
  | "daily"
  | "weekly"
  | "monthly"
  | "follow_up";

export const PRIORITY_RANK: Record<ReminderPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** The decision for one task on one day. */
export interface ReminderDecision {
  shouldNotify: boolean;
  type: ReminderType | null;
  priority: ReminderPriority | null;
  reason: string;
  taskId: string | null;
  sectionId: string | null;
  suggestedFireTime: Date | null;
}

export interface PlannedReminder {
  /** Stable identity. Same task/type/moment implies the same alarm id. */
  key: string;
  taskIds: string[];
  /** Sections this reminder belongs to ("daily", "remainder", a section id…). */
  sectionIds: string[];
  /** Local calendar day the reminder belongs to (YYYY-MM-DD). */
  date: string;
  title: string;
  body: string;
  at: Date;
  type: ReminderType;
  priority: ReminderPriority;
  reason: string;
  /** True when a passed moment was re-armed for later today. */
  catchUp: boolean;
}

export interface SkippedReminder {
  taskId: string;
  date: string;
  reason: string;
}

export interface ReminderPlan {
  records: PlannedReminder[];
  /** Dev diagnostics only — why a task produced nothing on a given day. */
  skipped: SkippedReminder[];
}

export interface ReminderContext {
  now: Date;
  tasks: Task[];
  logs: TimeLog[];
  sections?: CustomSection[];
  settings: NotificationSettings;
  /** ISO of the last completion / logged minutes / focus session. */
  lastMeaningfulActivityAt?: string | null;
  /** Reminder keys already delivered today (from native reconciliation). */
  firedKeys?: ReadonlySet<string>;
  /** In-app snoozes; they replace today's record for that task. */
  snoozes?: { taskId: string; at: Date }[];
  /**
   * Web delivery needs today's passed moments with their real time so the
   * caller can show them late. Native arming leaves this off: a passed alarm is
   * re-armed a few minutes ahead instead (see `CATCH_UP_LEAD_MINUTES`).
   */
  includePast?: boolean;
}

/** How many days the evaluator reasons about (today + 6). */
export const REMINDER_HORIZON_DAYS = 6;
/** Upper bound on evaluated records. */
export const MAX_REMINDER_RECORDS = 60;
/**
 * How far ahead alarms are actually armed. The queue is deliberately not an
 * infinite stream: only the next meaningful reminders are handed to Android,
 * and each later evaluation arms the next one. 72 hours covers a whole weekend
 * away from the app without queueing a week of notifications.
 */
export const NATIVE_HORIZON_HOURS = 72;
/** Hard cap on armed alarms. */
export const MAX_NATIVE_RECORDS = 24;
/** When today's moment has passed, re-arm this far ahead. */
export const CATCH_UP_LEAD_MINUTES = 15;
/** Don't notify within this long after real activity. */
export const ACTIVITY_COOLDOWN_MINUTES = 30;
/** A low-priority reminder never fires this close to another one. */
export const SUPPRESS_WINDOW_MINUTES = 90;
/** Days-before-due milestones: frequency rises as the deadline nears. */
export const DEADLINE_MILESTONES: readonly number[] = [7, 3, 1];

const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

/** Local "HH:MM" → {h, m}, or null when malformed. */
export function parseHHMM(value: string | undefined): { h: number; m: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function atLocal(day: Date, hhmm: string): Date | null {
  const parsed = parseHHMM(hhmm);
  if (!parsed) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), parsed.h, parsed.m);
}

/** True inside the quiet-hours window (may wrap midnight). */
export function isQuietHours(at: Date, settings: NotificationSettings): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = parseHHMM(settings.quietStart);
  const end = parseHHMM(settings.quietEnd);
  if (start === null || end === null) return false;
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  if (startMin === endMin) return false;
  const mins = at.getHours() * 60 + at.getMinutes();
  if (startMin < endMin) return mins >= startMin && mins < endMin;
  return mins >= startMin || mins < endMin;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/* ------------------------------------------------------------------ */
/* Per-task decision                                                   */
/* ------------------------------------------------------------------ */

interface TimeChoice {
  hhmm: string;
  /** A time the user typed themselves — quiet hours do not block it. */
  explicit: boolean;
}

/**
 * The time a task's reminder fires at.
 *
 * Order: the task's own time (explicit), then its section/schedule start time,
 * then the section default from settings.
 */
export function reminderTimeFor(
  task: Task,
  settings: NotificationSettings,
  sections: CustomSection[] = [],
): TimeChoice {
  if (parseHHMM(task.notifyTime)) return { hhmm: task.notifyTime!, explicit: true };
  if (task.section === "daily" || task.section === "custom") {
    const start = scheduleForTask(task, sections)?.startTime;
    if (parseHHMM(start)) return { hhmm: start!, explicit: false };
    return { hhmm: settings.dailyReminderTime, explicit: false };
  }
  if (task.section === "remainder") return { hhmm: settings.remainderTime, explicit: false };
  return { hhmm: settings.occasionalTime, explicit: false };
}

/** Is the task present on `day` (before any done/logged filtering)? */
function occursOnDay(task: Task, day: Date, sections: CustomSection[]): boolean {
  if (task.section === "daily") return true;
  if (task.section === "custom") {
    // Legacy per-task schedules stay authoritative for old records; new tasks
    // inherit the section's schedule.
    if (task.schedule) return scheduleOccursOn(task.schedule, day);
    const section = sections.find((s) => s.id === task.customSectionId);
    return section ? isSectionActiveOnDate(section, day) : false;
  }
  // One-offs are considered when they are due, overdue, or (for unscheduled
  // deadline/bucket-list work) on their gentle check-in day.
  return true;
}

/** Calendar days from `fromKey` to `toKey` (negative when `toKey` is past). */
function daysUntil(fromKey: string, toKey: string): number {
  return Math.round((parseKey(toKey).getTime() - parseKey(fromKey).getTime()) / 86_400_000);
}

const SECTION_LEVEL_TYPES: ReminderType[] = ["daily", "weekly", "monthly"];

interface TaskDayOutcome {
  type: ReminderType;
  priority: ReminderPriority;
  reason: string;
  at: Date;
  explicitTime: boolean;
  /** Calendar days until due; negative once overdue. */
  daysLeft?: number;
}

/**
 * The rule table for one task on one day, or a reason it produces nothing.
 *
 * Precedence is deliberate: high-priority reasons are checked first, so a task
 * can never attract both a due reminder and a routine one on the same day.
 */
function decideTaskDay(
  task: Task,
  day: Date,
  today: string,
  loggedToday: ReadonlySet<string>,
  settings: NotificationSettings,
  sections: CustomSection[],
): TaskDayOutcome | { skip: string } {
  const key = dateKey(day);
  if (isTaskDoneOn(task, key)) {
    return { skip: task.status === "accomplished" ? "accomplished" : "done_on_day" };
  }
  if (key === today && loggedToday.has(task.id)) return { skip: "logged_today" };

  /* 1. Explicit user-created one-shot reminder — highest priority. */
  if (task.remindAt) {
    const at = new Date(task.remindAt);
    if (Number.isFinite(at.getTime()) && dateKey(at) === key) {
      return { type: "explicit", priority: "high", reason: "user_reminder", at, explicitTime: true };
    }
  }

  const due = task.dueDate;
  const daysLeft = due ? daysUntil(key, due) : null;
  const overdue = Boolean(due && due < key);
  const dueToday = due === key;
  const time = reminderTimeFor(task, settings, sections);
  const at = atLocal(day, time.hhmm);
  if (!at) return { skip: "bad_time" };

  /* 2. Important deadline reminders — HIGH. The frequency rises as the date
   *    approaches: a week out, 3 days out, the day before, the due day, then
   *    daily while it stays open. */
  if (overdue) {
    if (!settings.overdueReminders) return { skip: "overdue_reminders_off" };
    return {
      type: "overdue",
      priority: "high",
      reason: "overdue",
      at,
      explicitTime: time.explicit,
      daysLeft: daysLeft ?? undefined,
    };
  }
  if (dueToday) {
    if (!settings.specialTaskReminders) return { skip: "due_reminders_off" };
    return {
      type: "due",
      priority: "high",
      reason: "due_today",
      at,
      explicitTime: time.explicit,
      daysLeft: 0,
    };
  }
  if (daysLeft !== null && DEADLINE_MILESTONES.includes(daysLeft)) {
    if (!settings.specialTaskReminders) return { skip: "due_reminders_off" };
    return {
      type: "deadline",
      priority: "high",
      reason: "deadline_soon",
      at,
      explicitTime: time.explicit,
      daysLeft,
    };
  }

  /* 3. Section-level reminders — MEDIUM for daily/custom/weekly, LOW monthly. */
  if (!settings.taskReminders) return { skip: "task_reminders_off" };

  if (task.section === "daily" || task.section === "custom") {
    if (!occursOnDay(task, day, sections)) return { skip: "section_inactive" };
    return { type: "daily", priority: "medium", reason: "scheduled_task", at, explicitTime: time.explicit };
  }

  if (task.section === "remainder") {
    // Dated deadline tasks are handled by the countdown rules above; only
    // undated ones get the weekly check-in.
    if (due) return { skip: "not_due" };
    if (day.getDay() !== settings.remainderWeekday) return { skip: "not_checkin_day" };
    return { type: "weekly", priority: "medium", reason: "weekly_checkin", at, explicitTime: time.explicit };
  }

  if (task.section === "occasional") {
    // Dated bucket-list work is handled by the countdown rules above. Undated
    // items get a calm twice-monthly check-in — enough to stay present without
    // becoming a recurring nag.
    if (due) return { skip: "not_due" };
    const checkinDays = settings.occasionalDays ?? [];
    if (!checkinDays.includes(day.getDate())) return { skip: "not_checkin_day" };
    return { type: "monthly", priority: "low", reason: "monthly_checkin", at, explicitTime: time.explicit };
  }

  return { skip: "unsupported_section" };
}

/* ------------------------------------------------------------------ */
/* Day-level check-in                                                  */
/* ------------------------------------------------------------------ */

/** One calm "there is still work today" nudge — never a motivational spam. */
function decideFollowUp(
  pending: PlannedReminder[],
  dayRecords: PlannedReminder[],
  tasks: Task[],
  day: Date,
  today: string,
  loggedToday: ReadonlySet<string>,
  settings: NotificationSettings,
  sections: CustomSection[],
  lastMeaningfulActivityAt: string | null | undefined,
): { at: Date; target: Task | null; remaining: number; sectionIds: string[] } | null {
  if (!settings.taskReminders) return null;
  const key = dateKey(day);
  const at = atLocal(day, settings.followUpTime);
  if (!at) return null;
  // Ordinary nudges never land in quiet hours.
  if (isQuietHours(at, settings)) return null;

  // A task that already had a HIGH-priority reminder today (an explicit one, a
  // due one, an overdue one) must not be mentioned again — higher priority
  // supersedes lower. Routine reminders do not block the later check-in: the
  // product explicitly wants the same daily task mentioned again if it is
  // still open.
  const alreadyMentioned = new Set(
    [...pending, ...dayRecords]
      .filter((r) => r.date === key && r.priority === "high")
      .flatMap((r) => r.taskIds),
  );
  const candidates = tasks.filter(
    (t) =>
      (t.section === "daily" || t.section === "custom") &&
      occursOnDay(t, day, sections) &&
      !alreadyMentioned.has(t.id) &&
      !isTaskDoneOn(t, key) &&
      !(key === today && loggedToday.has(t.id)),
  );
  if (candidates.length === 0) return null;

  const remaining = candidates.reduce(
    (sum, t) => sum + (isTimedTask(t) ? remainingOn(t, key, loggedToday.has(t.id)) : 0),
    0,
  );
  const anyUntimed = candidates.some((t) => !isTimedTask(t));
  // A day of purely timed work with nothing left is finished — no nudge.
  if (remaining <= 0 && !anyUntimed) return null;

  // Never stack onto another reminder: higher priority supersedes.
  const tooClose = [...pending, ...dayRecords].some(
    (r) => r.date === key && Math.abs(r.at.getTime() - at.getTime()) < SUPPRESS_WINDOW_MINUTES * MIN,
  );
  if (tooClose) return null;

  // No immediate nudge right after real activity.
  const activity = ms(lastMeaningfulActivityAt);
  if (activity !== null && at.getTime() - activity < ACTIVITY_COOLDOWN_MINUTES * MIN) return null;

  const target = [...candidates].sort((a, b) => {
    const ra = isTimedTask(a) ? remainingOn(a, key, loggedToday.has(a.id)) : 0;
    const rb = isTimedTask(b) ? remainingOn(b, key, loggedToday.has(b.id)) : 0;
    return rb - ra || a.title.localeCompare(b.title);
  })[0];
  return {
    at,
    target: target ?? null,
    remaining,
    sectionIds: [...new Set(candidates.map(sectionIdOf))],
  };
}

/* ------------------------------------------------------------------ */
/* The evaluator                                                       */
/* ------------------------------------------------------------------ */

/** The section a task belongs to, as a stable metadata string. */
function sectionIdOf(task: Task): string {
  if (task.section === "custom") return task.customSectionId ?? "custom";
  return task.section;
}

function bodyFor(
  type: ReminderType,
  title: string,
  at: Date,
  daysLeft?: number,
): string {
  switch (type) {
    case "explicit":
      return `Reminder — ${title}`;
    case "deadline": {
      const days = Math.max(1, daysLeft ?? 1);
      return days === 1
        ? `1 day left — ${title} is due tomorrow.`
        : `${days} days left — ${title} is due soon.`;
    }
    case "due":
      return `Due today — ${title}`;
    case "overdue": {
      const days = Math.max(1, -(daysLeft ?? 0));
      return `${title} is ${days} day${days === 1 ? "" : "s"} overdue — still open.`;
    }
    case "daily":
      return at.getHours() < 12
        ? `Good morning. Ready to make some progress on ${title}?`
        : `Time for ${title}`;
    case "weekly":
      return `Deadline check-in — ${title}`;
    case "monthly":
      return `Bucket list check-in — ${title}`;
    case "follow_up":
      return `Keep your momentum going — ${title} is still waiting.`;
  }
}

/**
 * Collapse section-level reminders that fire at the same moment.
 *
 * Ten daily tasks at the default 09:00 are one calm notification ("10 tasks
 * planned: …"), never ten. Different moments stay separate reminders.
 */
function groupReminders(records: PlannedReminder[]): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const groups = new Map<string, { record: PlannedReminder; titles: string[] }>();

  for (const r of records) {
    if (!SECTION_LEVEL_TYPES.includes(r.type)) {
      out.push(r);
      continue;
    }
    const key = `group:${r.type}:${r.date}:${r.at.getTime()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.record.taskIds.push(...r.taskIds);
      for (const s of r.sectionIds) {
        if (!existing.record.sectionIds.includes(s)) existing.record.sectionIds.push(s);
      }
      existing.titles.push(r.title);
      continue;
    }
    const merged: PlannedReminder = {
      ...r,
      key,
      taskIds: [...r.taskIds],
      sectionIds: [...r.sectionIds],
    };
    groups.set(key, { record: merged, titles: [r.title] });
    out.push(merged);
  }

  for (const { record, titles } of groups.values()) {
    if (titles.length <= 1) continue;
    const listed = titles.slice(0, 3).join(", ");
    const more = titles.length > 3 ? ` and ${titles.length - 3} more` : "";
    if (record.type === "weekly") {
      record.title = "Deadline check-in";
      record.body = `${titles.length} tasks are still waiting: ${listed}${more}`;
    } else if (record.type === "monthly") {
      record.title = "Bucket list check-in";
      record.body = `${titles.length} items on your bucket list: ${listed}${more}`;
    } else {
      record.title = "Today's plan";
      record.body = `${titles.length} tasks planned: ${listed}${more}`;
    }
  }
  return out;
}

/**
 * Evaluate every reminder Momentum should arm for the next
 * `REMINDER_HORIZON_DAYS + 1` days, earliest first.
 *
 * Deterministic: same context in, same plan out — every rule above is covered
 * by planner.test.ts.
 */
export function evaluateReminder(ctx: ReminderContext): ReminderPlan {
  const { now, tasks, logs, sections = [] } = ctx;
  const settings: NotificationSettings = { ...NOTIFICATION_DEFAULTS, ...ctx.settings };
  const records: PlannedReminder[] = [];
  const skipped: SkippedReminder[] = [];

  if (!settings.enabled) return { records, skipped };

  const today = dateKey(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMs = now.getTime();
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));
  const firedKeys = ctx.firedKeys ?? new Set<string>();
  const snoozes = new Map(
    (ctx.snoozes ?? [])
      .filter((s) => s.at.getTime() > nowMs)
      .map((s) => [s.taskId, s.at] as const),
  );

  for (let offset = 0; offset <= REMINDER_HORIZON_DAYS; offset++) {
    const day = addDays(todayStart, offset);
    const key = dateKey(day);

    // One reminder per task per day is a property of this loop.
    const dayRecords: PlannedReminder[] = [];

    for (const task of tasks) {
      // A snoozed task's reminder for today is replaced at the end of the day.
      if (key === today && snoozes.has(task.id)) continue;

      const outcome = decideTaskDay(task, day, today, loggedToday, settings, sections);
      if ("skip" in outcome) {
        skipped.push({ taskId: task.id, date: key, reason: outcome.skip });
        continue;
      }
      // Quiet hours silence ordinary reminders only. A time the user chose for
      // themselves, and important due/overdue reminders, are never suppressed.
      if (
        !outcome.explicitTime &&
        outcome.priority !== "high" &&
        isQuietHours(outcome.at, settings)
      ) {
        skipped.push({ taskId: task.id, date: key, reason: "quiet_hours" });
        continue;
      }

      let at = outcome.at;
      let catchUp = false;
      if (at.getTime() <= nowMs + 1000) {
        // A passed moment can still be delivered today — but only for
        // meaningful reminders, and never for the gentle low-priority ones.
        if (key !== today || outcome.priority === "low") {
          skipped.push({ taskId: task.id, date: key, reason: "moment_passed" });
          continue;
        }
        if (!ctx.includePast) {
          at = new Date(nowMs + CATCH_UP_LEAD_MINUTES * MIN);
          catchUp = true;
        }
      }

      dayRecords.push({
        key: `${task.id}:${key}`,
        taskIds: [task.id],
        sectionIds: [sectionIdOf(task)],
        date: key,
        title: task.title,
        body: bodyFor(outcome.type, task.title, at, outcome.daysLeft),
        at,
        type: outcome.type,
        priority: outcome.priority,
        reason: outcome.reason,
        catchUp,
      });
    }

    // The calm later check-in, once per day.
    const followUp = decideFollowUp(
      records,
      dayRecords,
      tasks,
      day,
      today,
      loggedToday,
      settings,
      sections,
      ctx.lastMeaningfulActivityAt,
    );
    if (followUp) {
      dayRecords.push({
        key: `follow_up:${key}`,
        taskIds: followUp.target ? [followUp.target.id] : [],
        sectionIds: followUp.sectionIds,
        date: key,
        title: "Momentum",
        body:
          followUp.remaining > 0
            ? `You still have ${formatMinutes(followUp.remaining)} planned today — a small session keeps the momentum going.`
            : `Still on today's list — a small session keeps the momentum going.`,
        at: followUp.at,
        type: "follow_up",
        priority: "medium",
        reason: "remaining_work",
        catchUp: false,
      });
    }

    // Snooze replaces today's schedule with the user's chosen moment.
    if (key === today) {
      for (const [taskId, at] of snoozes) {
        const task = tasks.find((t) => t.id === taskId);
        if (!task || isTaskDoneOn(task, today) || loggedToday.has(taskId)) continue;
        for (let i = dayRecords.length - 1; i >= 0; i--) {
          if (dayRecords[i].taskIds.includes(taskId)) dayRecords.splice(i, 1);
        }
        dayRecords.push({
          key: `snooze:${taskId}:${today}`,
          taskIds: [taskId],
          sectionIds: [sectionIdOf(task)],
          date: today,
          title: task.title,
          body: `Reminder — ${task.title}`,
          at,
          type: "explicit",
          priority: "high",
          reason: "snoozed",
          catchUp: false,
        });
      }
    }

    for (const r of groupReminders(dayRecords)) {
      if (firedKeys.has(r.key)) continue;
      records.push(r);
    }
  }

  records.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { records: records.slice(0, MAX_REMINDER_RECORDS), skipped };
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * The public per-task decision, in the shape the product spec asks for. Used
 * by diagnostics and by tests; `evaluateReminder` is the planner built on it.
 */
export function evaluateTaskDay(
  ctx: ReminderContext,
  task: Task,
  day: Date,
): ReminderDecision {
  const settings: NotificationSettings = { ...NOTIFICATION_DEFAULTS, ...ctx.settings };
  const today = dateKey(ctx.now);
  const loggedToday = new Set(
    ctx.logs.filter((l) => l.date === today).map((l) => l.taskId),
  );
  const outcome = decideTaskDay(task, day, today, loggedToday, settings, ctx.sections ?? []);
  if ("skip" in outcome) {
    return {
      shouldNotify: false,
      type: null,
      priority: null,
      reason: outcome.skip,
      taskId: task.id,
      sectionId: task.customSectionId ?? null,
      suggestedFireTime: null,
    };
  }
  return {
    shouldNotify: true,
    type: outcome.type,
    priority: outcome.priority,
    reason: outcome.reason,
    taskId: task.id,
    sectionId: task.customSectionId ?? null,
    suggestedFireTime: outcome.at,
  };
}

/* ------------------------------------------------------------------ */
/* Native selection                                                    */
/* ------------------------------------------------------------------ */

/**
 * The alarms that are actually handed to Android.
 *
 * Only the next meaningful reminders are armed — never an infinite stream.
 * `evaluateReminder` still reasons across the full horizon so decisions and
 * diagnostics stay honest; each later reconciliation arms whatever comes next
 * (that is also why a fired reminder is never immediately replaced: the next
 * evaluation decides, once it knows what was delivered).
 */
export function selectNativeSchedule(
  records: PlannedReminder[],
  now: Date,
): PlannedReminder[] {
  const limit = now.getTime() + NATIVE_HORIZON_HOURS * 60 * 60_000;
  return records.filter((r) => r.at.getTime() <= limit).slice(0, MAX_NATIVE_RECORDS);
}
