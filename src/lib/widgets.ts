import { Capacitor, registerPlugin } from "@capacitor/core";
import { dateKey } from "./date";
import { breakdownForDay, scheduleForTask } from "./schedule";
import { currentStreak, liveDayRec, workloadForTasks } from "./performance";
import { isTimedTask, remainingMinutesOf } from "./duration";
import { formatMinutes } from "./format";
import { sectionLabel } from "./labels";
import { isTaskDoneOn } from "./task-state";
import type { CustomSection, DailyPerformance, Task, TimeLog } from "./types";

/**
 * Home-screen widgets, web side.
 *
 * The task data lives in IndexedDB, which Android cannot read. The app is the
 * only writer, so it computes a compact, self-contained snapshot and hands it
 * to the native layer; widgets render that snapshot and never query the store.
 *
 * Taps that change data (ticking a task) are queued natively and applied by the
 * app on its next resume. The native side updates its copy immediately so the
 * widget responds at once, but IndexedDB remains the source of truth.
 */

/** Row slots in the Today widget layout. Keep in sync with widget_today.xml. */
export const MAX_WIDGET_TASKS = 5;

export type WidgetKind = "today" | "next" | "streak" | "quick-add";

export type WidgetLaunchType =
  | "quick-add"
  | "quick-tick"
  | "open-profile"
  | "focus-task";

export interface WidgetLaunchAction {
  type: WidgetLaunchType;
  taskId?: string;
}

export interface WidgetCompletionAction {
  type: "complete";
  taskId: string;
  /** Local day the widget showed when the tap happened (YYYY-MM-DD). */
  date: string;
}

export interface WidgetTaskSummary {
  id: string;
  title: string;
  done: boolean;
  /** Compact line shown under the title, e.g. "09:00 · 25m left". */
  meta: string;
  timed: boolean;
  /** Remaining minutes at snapshot time; 0 for completion-based work. */
  minutes: number;
}

export interface WidgetNextSummary {
  id: string;
  title: string;
  meta: string;
  timed: boolean;
}

export interface WidgetSnapshot {
  version: 1;
  /** Local calendar day this snapshot describes. */
  date: string;
  /** Pre-formatted, e.g. "Thu, Oct 22". */
  dateLabel: string;
  updatedAt: string;
  streak: number;
  /** Today's task counts across every list, not just the rows included below. */
  done: number;
  total: number;
  /**
   * The same progress Home shows: time-based when every task is timed,
   * otherwise task-count based.
   */
  percent: number;
  /** True when `percent` is measured in minutes and can be adjusted natively. */
  timeBased: boolean;
  taskPercent: number;
  plannedMinutes: number;
  remainingMinutes: number;
  next: WidgetNextSummary | null;
  /** At most MAX_WIDGET_TASKS, open work first, then finished work. */
  tasks: WidgetTaskSummary[];
}

export interface WidgetSnapshotInput {
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  history: DailyPerformance[];
  now: Date;
}

function metaFor(task: Task, key: string, sections: CustomSection[]): string {
  const schedule = scheduleForTask(task, sections);
  const time = schedule?.startTime ?? task.notifyTime ?? null;
  const timed = isTimedTask(task);
  const remaining = timed ? remainingMinutesOf(task) : 0;
  const parts: string[] = [];

  if (time) parts.push(time);
  if (task.dueDate) {
    parts.push(task.dueDate === key ? "Due today" : `Due ${shortDate(task.dueDate)}`);
  }
  if (!time && timed) parts.push(`${formatMinutes(remaining)} left`);
  if (parts.length === 0) parts.push(sectionLabel(task, sections).title);

  return parts.join(" · ");
}

function shortDate(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return key;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function summaryOf(
  task: Task,
  key: string,
  sections: CustomSection[],
  done: boolean,
): WidgetTaskSummary {
  return {
    id: task.id,
    title: task.title,
    done,
    meta: metaFor(task, key, sections),
    timed: isTimedTask(task),
    minutes: isTimedTask(task) ? remainingMinutesOf(task) : 0,
  };
}

/**
 * Build the snapshot every widget renders from.
 *
 * Pure on purpose: the rules about which tasks count as "today" (scheduled
 * recurrence plus due-today one-offs) and what "done" means are already owned
 * by schedule.ts / task-state.ts, so the widget can never disagree with Home.
 */
export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot {
  const key = dateKey(input.now);
  const day = breakdownForDay(input.tasks, input.sections, key);

  const seen = new Set<string>();
  const dayTasks: Task[] = [];
  for (const task of [
    ...day.specials,
    ...day.specialsDone,
    ...day.groups.flatMap((group) => group.tasks),
  ]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    dayTasks.push(task);
  }

  const doneTasks = dayTasks.filter((task) => isTaskDoneOn(task, key));
  const openTasks = dayTasks.filter((task) => !isTaskDoneOn(task, key));
  // Home prefers a task with a concrete next action; the widget follows the
  // same rule so "Up next" and the top of the list point at the same thing.
  const preferred =
    openTasks.find((task) => Boolean(task.nextAction?.trim())) ?? openTasks[0] ?? null;
  const ordered = preferred
    ? [preferred, ...openTasks.filter((task) => task.id !== preferred.id), ...doneTasks]
    : doneTasks;

  const tasks = ordered
    .slice(0, MAX_WIDGET_TASKS)
    .map((task) => summaryOf(task, key, input.sections, isTaskDoneOn(task, key)));

  const workload = workloadForTasks(input.tasks, key, input.sections);
  const live = liveDayRec(input.tasks, input.logs, key, input.sections);
  const history = input.history.map((row) => ({
    date: row.date,
    plannedMinutes: row.plannedMinutes,
    completedMinutes: row.completedMinutes,
    percentage: row.percentage,
    kind: row.kind,
  }));
  const streak = currentStreak([...history, live], key);

  const done = doneTasks.length;
  const total = dayTasks.length;
  const taskPercent = total > 0 ? Math.round((done / total) * 100) : 0;
  const timeBased = workload.timedCount > 0 && workload.untimedCount === 0;
  const timedPercent =
    workload.planned > 0
      ? Math.min(100, Math.round((workload.completed / workload.planned) * 100))
      : -1;
  const percent = timeBased
    ? timedPercent >= 0
      ? timedPercent
      : taskPercent
    : taskPercent;

  return {
    version: 1,
    date: key,
    dateLabel: input.now.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    updatedAt: input.now.toISOString(),
    streak,
    done,
    total,
    percent,
    timeBased,
    taskPercent,
    plannedMinutes: workload.planned,
    remainingMinutes: workload.remaining,
    next: preferred
      ? {
        id: preferred.id,
        title: preferred.title,
        meta: metaFor(preferred, key, input.sections),
        timed: isTimedTask(preferred),
      }
      : null,
    tasks,
  };
}

/* ------------------------------------------------------------------ */
/* Native bridge                                                       */
/* ------------------------------------------------------------------ */

interface MomentumWidgetsPlugin {
  sync(options: { snapshot: WidgetSnapshot }): Promise<void>;
  consumeActions(): Promise<{ actions: WidgetCompletionAction[] }>;
  consumeLaunchAction(): Promise<{ action?: WidgetLaunchAction }>;
  pinWidget(options: { kind: WidgetKind }): Promise<PinWidgetResult>;
}

export interface PinWidgetResult {
  supported: boolean;
  requested: boolean;
}

/** Fired by MainActivity when a widget deep-link arrives while the app is alive. */
export const WIDGET_LAUNCH_EVENT = "momentumWidgetLaunch";

const NativeWidgets = registerPlugin<MomentumWidgetsPlugin>("MomentumWidgets");

/** Widgets are an Android-native surface; other platforms simply opt out. */
export function widgetsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android"
  );
}

export async function pushWidgetSnapshot(snapshot: WidgetSnapshot): Promise<boolean> {
  if (!widgetsSupported()) return false;
  try {
    await NativeWidgets.sync({ snapshot });
    return true;
  } catch {
    return false;
  }
}

export async function consumeWidgetActions(): Promise<WidgetCompletionAction[]> {
  if (!widgetsSupported()) return [];
  try {
    const result = await NativeWidgets.consumeActions();
    return Array.isArray(result?.actions)
      ? result.actions.filter((action) => action?.type === "complete" && action.taskId)
      : [];
  } catch {
    return [];
  }
}

export async function consumeWidgetLaunch(): Promise<WidgetLaunchAction | null> {
  if (!widgetsSupported()) return null;
  try {
    const result = await NativeWidgets.consumeLaunchAction();
    return result?.action?.type ? result.action : null;
  } catch {
    return null;
  }
}

export async function pinWidget(kind: WidgetKind): Promise<PinWidgetResult> {
  if (!widgetsSupported()) return { supported: false, requested: false };
  try {
    return await NativeWidgets.pinWidget({ kind });
  } catch {
    return { supported: true, requested: false };
  }
}
