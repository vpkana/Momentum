import { dateKey, todayKey } from "./date";
import { isTimedTask as isTimedTaskDuration, plannedMinutesOf, remainingMinutesOf } from "./duration";
import type { SectionKind, Task } from "./types";

/**
 * Lifecycle helpers for tasks.
 *
 * Momentum separates three concerns:
 *   - the task *definition* (what the user needs to do) — permanent
 *   - the *current day's* state (status / remaining minutes) — date-scoped
 *   - the *history* (time logs + daily performance rows) — never overwritten
 *
 * Recurring work (the Daily section and custom scheduled sections) comes back
 * every scheduled day: a completion belongs to the day it happened, not to the
 * task forever. One-off work (deadlines / bucket list) keeps its outcome, and
 * so does any dated task — a deadline is never reopened by the rollover.
 */

/** Done = finished today's work OR permanently accomplished. */
export const isTaskDone = (t: Task): boolean => t.status !== "active";

/** Finished normally (today's recurring work or a completed one-off). */
export const isTaskCompleted = (t: Task): boolean => t.status === "completed";

/** Permanently retired goal kept as history. */
export const isTaskAccomplished = (t: Task): boolean => t.status === "accomplished";

/** Still part of active work. */
export const isTaskOpen = (t: Task): boolean => t.status === "active";

/** Sections whose work repeats: a completion only counts for its own day. */
export function isRecurringSection(section: SectionKind): boolean {
  return section === "daily" || section === "custom";
}

/**
 * Whether a task's work repeats.
 *
 * The Daily section recurs every local calendar day; a custom section recurs
 * according to its own schedule (weekly, monthly date, last day, monthly
 * weekday…). Recurrence is a property of the *section*, so any task inside a
 * recurring section reopens whenever the section is next active — it is not
 * limited to Daily.
 *
 * A `custom` task with no section id is malformed (it has no schedule to
 * consult), so it is treated as a one-off rather than reopened every day.
 *
 * Remainder and Occasional are deliberately excluded: their completion is
 * permanent and must never be reopened by the day rollover.
 */
export function isRecurringTask(task: Task): boolean {
  if (task.section === "daily") return true;
  if (task.section === "custom") return Boolean(task.customSectionId);
  return false;
}

/**
 * Whether a completed task's outcome is final.
 *
 * A due date is a deadline commitment: once that work is finished it must stay
 * finished, even when the task was filed in a recurring section. Only undated
 * daily/custom work reopens for the next occurrence; reopening a deadline is
 * always a deliberate user action.
 */
function keepsCompletion(task: Task): boolean {
  return !isRecurringTask(task) || Boolean(task.dueDate);
}

/** The local calendar date a task's completion belongs to, when known. */
export function completionDayOf(task: Task): string | null {
  if (!task.completedAt) return null;
  const d = new Date(task.completedAt);
  if (Number.isNaN(d.getTime())) return null;
  return dateKey(d);
}

/**
 * Whether a task counts as done ON a specific local calendar day.
 *
 * This is the date-aware replacement for `task.status === "completed"` when
 * reasoning about recurring work: a Daily task completed yesterday must read
 * as *pending* today, even before the day rollover has been persisted.
 */
export function isTaskDoneOn(task: Task, key: string): boolean {
  if (task.status === "accomplished") return true;
  if (task.status === "active") return false;
  // One-off and deadline work keeps its outcome permanently.
  if (keepsCompletion(task)) return true;
  const day = completionDayOf(task);
  // Unknown day (legacy rows) → assume it belongs to the current day and let
  // the rollover decide; never nag about something that may be done today.
  return day === null || day === key;
}

/**
 * Whether a recurring task's current-day state belongs to an earlier day and
 * must be reopened. Only the live fields change — logs and performance rows
 * (the history) are never touched.
 */
export function needsNewDayReset(task: Task, today: string, loggedToday: boolean): boolean {
  if (task.status === "accomplished") return false;
  // One-offs (deadline / bucket list) keep their completion state.
  if (!isRecurringTask(task)) return false;

  if (task.status === "completed") {
    // A dated task is deadline work: completion is final, never rolled over.
    if (task.dueDate) return false;
    const completedDay = completionDayOf(task);
    // A completion with no trustworthy timestamp is stale for recurring work.
    return completedDay === null || completedDay < today;
  }

  // Completion-based work has no minutes to carry over — only its completion
  // state matters, which the branch above already handles.
  if (!isTimedTaskDuration(task)) return false;

  // Active but already partially burned: carry progress over only when it was
  // logged on an earlier day. Time logged today must never be reset.
  const worked = remainingMinutesOf(task) < plannedMinutesOf(task);
  return worked && !loggedToday;
}

/**
 * Remaining minutes for a task as of a specific local calendar day.
 *
 * Rollover-aware: recurring work whose completion or partial progress belongs
 * to an earlier day reports its full estimate again, so "is anything left
 * today?" answers correctly even before the day rollover is persisted.
 */
export function remainingOn(task: Task, key: string, loggedToday = false): number {
  if (task.status === "accomplished") return 0;
  if (needsNewDayReset(task, key, loggedToday)) return plannedMinutesOf(task);
  return remainingMinutesOf(task);
}

export interface RolloverResult {
  /** The task list after the rollover (identical reference when nothing changed). */
  tasks: Task[];
  /** Only the tasks whose live state changed — for a minimal database write. */
  changed: Task[];
}

/**
 * Pure day rollover.
 *
 * Reopens recurring work whose completion / partial progress belongs to an
 * earlier local calendar day, so a Daily task completed on September 13 is
 * available again on September 14 with the full estimate remaining. Partial
 * time is date-scoped too: yesterday's 20 minutes never carry into today.
 *
 * Idempotent: running it twice on the same day is a no-op, and it never
 * deletes or rewrites history (time logs, performance rows).
 */
export function rolloverTasks(
  tasks: Task[],
  loggedToday: Iterable<string> = [],
  today: string = todayKey(),
): RolloverResult {
  const logged = loggedToday instanceof Set ? loggedToday : new Set(loggedToday);
  const changed: Task[] = [];

  const next = tasks.map((task) => {
    if (!needsNewDayReset(task, today, logged.has(task.id))) return task;
    const reopened: Task = {
      ...task,
      status: "active",
      completedAt: undefined,
      remainingMinutes: plannedMinutesOf(task),
    };
    changed.push(reopened);
    return reopened;
  });

  return { tasks: changed.length > 0 ? next : tasks, changed };
}

/** Tasks that can become accomplishments (bucket-list items cannot). */
export const canAccomplish = (t: Task): boolean =>
  (t.section === "daily" || t.section === "remainder") &&
  !isTaskAccomplished(t);

/**
 * Pure transition: permanently retire a goal into an accomplishment.
 * The record is preserved in place (title, section, description, estimate,
 * schedule, next action) — only the lifecycle fields change. Time logs keep
 * referencing the task id, so its history remains intact.
 */
export function toAccomplished(
  task: Task,
  nowIso: string = new Date().toISOString(),
): Task {
  return {
    ...task,
    status: "accomplished",
    accomplishedAt: nowIso,
    completedAt: task.completedAt ?? nowIso,
    remainingMinutes: 0,
  };
}
