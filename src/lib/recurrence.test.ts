import { describe, expect, it } from "vitest";
import { rolloverTasks, isTaskDoneOn, needsNewDayReset, remainingOn, completionDayOf } from "./task-state";
import { liveDayRec } from "./performance";
import { scheduleOccursOn } from "./schedule";
import { pickNextTask, planNotifications } from "./notifications/engine";
import { evaluateReminder } from "./notifications/planner";
import type { NotificationSettings } from "./notifications/types";
import type { CustomSection, Task, TimeLog } from "./types";

/**
 * Daily recurrence + lifecycle.
 *
 * These are the product rules behind "a Daily task completed on September 13
 * must be available again on September 14", expressed as deterministic tests:
 * the task *definition* recurs, the *live state* is date-scoped, and the
 * *history* (logs + daily performance rows) is never destroyed.
 */

const DAY1 = "2026-09-13"; // Sunday
const DAY2 = "2026-09-14"; // Monday
const DAY3 = "2026-09-15"; // Tuesday

/** Local timestamp helper — keeps completion days timezone-honest. */
const at = (key: string, h: number, m = 0): string => {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).toISOString();
};

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: at("2026-01-01", 9),
  ...o,
});

const L = (taskId: string, minutes: number, date: string): TimeLog => ({
  id: `${taskId}-${date}-${minutes}`,
  taskId,
  minutes,
  date,
});

const settings: NotificationSettings = {
  enabled: true,
  dailyReminderTime: "09:00",
  followUpTime: "17:00",
  remainderWeekday: 6,
  remainderTime: "10:00",
  occasionalDays: [1, 15],
  occasionalTime: "10:00",
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  snoozeMinutes: 30,
  cooldownMinutes: 60,
  completionCooldownMinutes: 30,
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "07:00",
  morningHour: 9,
};

/** A task completed on `key`, as the stores would persist it. */
const completedOn = (id: string, title: string, key: string, estimated = 60): Task =>
  T({
    id,
    title,
    status: "completed",
    completedAt: at(key, 18),
    remainingMinutes: 0,
    estimatedMinutes: estimated,
  });

describe("date-scoped completion", () => {
  it("a recurring task completed yesterday is NOT done today", () => {
    const done = completedOn("dsa", "DSA Practice", DAY1);
    expect(isTaskDoneOn(done, DAY1)).toBe(true);
    expect(isTaskDoneOn(done, DAY2)).toBe(false);
  });

  it("resolves the completion day from a UTC ISO timestamp using local time", () => {
    // 23:30 local on Sep 13 must stay Sep 13, never roll into the next UTC day.
    const task = completedOn("late", "Late Night Work", DAY1);
    expect(completionDayOf(task)).toBe(DAY1);
  });

  it("one-off deadline work keeps its completion permanently", () => {
    const task = T({
      id: "report",
      title: "Finish the report",
      section: "remainder",
      dueDate: DAY1,
      status: "completed",
      completedAt: at(DAY1, 18),
      remainingMinutes: 0,
    });
    expect(isTaskDoneOn(task, DAY2)).toBe(true);
    expect(needsNewDayReset(task, DAY2, false)).toBe(false);
    expect(rolloverTasks([task], [], DAY2).changed).toHaveLength(0);
  });

  it("occasional (bucket-list) work is never reopened", () => {
    const task = T({
      id: "hampi",
      title: "Visit Hampi",
      section: "occasional",
      status: "completed",
      completedAt: at(DAY1, 18),
      remainingMinutes: 0,
    });
    expect(needsNewDayReset(task, DAY2, false)).toBe(false);
    expect(rolloverTasks([task], [], DAY2).changed).toHaveLength(0);
  });

  it("a dated task keeps its completion even inside a recurring section", () => {
    const task = T({
      id: "thesis",
      title: "Submit thesis",
      section: "custom",
      customSectionId: "research",
      dueDate: DAY1,
      status: "completed",
      completedAt: at(DAY1, 18),
      remainingMinutes: 0,
    });
    expect(isTaskDoneOn(task, DAY2)).toBe(true);
    expect(needsNewDayReset(task, DAY2, false)).toBe(false);
    expect(rolloverTasks([task], [], DAY2).changed).toHaveLength(0);
  });

  it("reports remaining minutes against a given day", () => {
    const done = completedOn("dsa", "DSA Practice", DAY1);
    expect(remainingOn(done, DAY1)).toBe(0);
    expect(remainingOn(done, DAY2)).toBe(60);
  });
});

describe("TEST 1 — Daily recurrence: complete day 1, pending day 2", () => {
  it("reopens the task with the full estimate on the next day", () => {
    const day1 = [completedOn("dsa", "DSA Practice", DAY1)];

    // Day 1: the task reads as done.
    expect(isTaskDoneOn(day1[0], DAY1)).toBe(true);

    // Day 2, after the rollover: the identical task definition is pending again.
    const { tasks, changed } = rolloverTasks(day1, [], DAY2);
    expect(changed).toHaveLength(1);
    expect(tasks[0].status).toBe("active");
    expect(tasks[0].remainingMinutes).toBe(60);
    expect(tasks[0].completedAt).toBeUndefined();
    // The definition itself is untouched.
    expect(tasks[0].id).toBe("dsa");
    expect(tasks[0].title).toBe("DSA Practice");
    expect(tasks[0].estimatedMinutes).toBe(60);
  });

  it("is idempotent — a second rollover on the same day changes nothing", () => {
    const day2 = rolloverTasks([completedOn("dsa", "DSA", DAY1)], [], DAY2).tasks;
    const again = rolloverTasks(day2, [], DAY2);
    expect(again.changed).toHaveLength(0);
    expect(again.tasks).toBe(day2);
  });

  it("TEST 3 — survives an app that was closed overnight", () => {
    // Simulates a cold boot: read yesterday's persisted row, roll over for today.
    const persisted = [completedOn("dsa", "DSA Practice", DAY1)];
    const onBoot = rolloverTasks(persisted, [], DAY2);
    expect(onBoot.tasks[0].status).toBe("active");
    expect(onBoot.tasks[0].remainingMinutes).toBe(60);
  });
});

describe("TEST 2 — history preservation", () => {
  it("keeps each day's performance after rollovers", () => {
    const logs = [L("ml", 60, DAY1), L("ml", 20, DAY2)];
    const task = T({ id: "ml", title: "ML", estimatedMinutes: 60 });

    expect(liveDayRec([task], logs, DAY1).percentage).toBe(100);
    expect(liveDayRec([task], logs, DAY2).percentage).toBe(33);

    // Rolling over day 1 → day 2 must not disturb the logged history.
    const { changed } = rolloverTasks([completedOn("ml", "ML", DAY1)], [], DAY2);
    expect(changed).toHaveLength(1);
    expect(logs.map((l) => l.date)).toEqual([DAY1, DAY2]);
    expect(liveDayRec([task], logs, DAY1).percentage).toBe(100);
  });

  it("never rewrites time logs when reopening a task", () => {
    const logs = [L("dsa", 60, DAY1)];
    const { changed } = rolloverTasks([completedOn("dsa", "DSA", DAY1)], [], DAY2);
    // Rollover only touches the live task fields.
    expect(Object.keys(changed[0])).not.toContain("logs");
    expect(logs[0].minutes).toBe(60);
  });
});

describe("TEST 4 — partial completion is date-scoped", () => {
  it("does not carry yesterday's partial minutes into today", () => {
    // Day 1: 20 of 60 logged → 40 remaining.
    const day1 = T({ id: "ml", title: "ML", remainingMinutes: 40 });

    const { tasks, changed } = rolloverTasks([day1], [], DAY2);
    expect(changed).toHaveLength(1);
    expect(tasks[0].remainingMinutes).toBe(60);

    // ...and the same-day in-progress state is NOT reset.
    const sameDay = rolloverTasks([day1], ["ml"], DAY1);
    expect(sameDay.changed).toHaveLength(0);
    expect(sameDay.tasks[0].remainingMinutes).toBe(40);
  });

  it("keeps partial progress when time was logged today", () => {
    const partial = T({ id: "ml", title: "ML", remainingMinutes: 20 });
    expect(needsNewDayReset(partial, DAY2, true)).toBe(false);
    expect(needsNewDayReset(partial, DAY2, false)).toBe(true);
  });
});

describe("TEST 5 — multiple daily tasks", () => {
  it("reopens every daily task, not just the completed one", () => {
    const day1 = [
      completedOn("dsa", "DSA", DAY1),
      T({ id: "ml", title: "ML" }),
      T({ id: "college", title: "College Work" }),
    ];
    const { tasks, changed } = rolloverTasks(day1, [], DAY2);
    // Only DSA had day-1 state to reopen.
    expect(changed.map((t) => t.id)).toEqual(["dsa"]);
    // All three are available again.
    expect(tasks.every((t) => t.status === "active")).toBe(true);
    expect(tasks.every((t) => t.remainingMinutes === t.estimatedMinutes)).toBe(true);
  });
});

describe("TEST 6 — custom section schedules are untouched", () => {
  const mondayOnly: CustomSection = {
    id: "sec-research",
    name: "Research",
    schedule: { type: "weekly", days: [1] }, // Monday
    createdAt: at("2026-01-01", 9),
  };

  it("a Monday-only section is active Monday and inactive Tuesday", () => {
    const monday = new Date(2026, 8, 14); // 2026-09-14 is a Monday
    const tuesday = new Date(2026, 8, 15);
    expect(scheduleOccursOn(mondayOnly.schedule, monday)).toBe(true);
    expect(scheduleOccursOn(mondayOnly.schedule, tuesday)).toBe(false);
  });

  it("rollover reopens a custom-section task without changing its schedule", () => {
    const task = T({
      id: "r1",
      title: "Read paper",
      section: "custom",
      customSectionId: "sec-research",
      status: "completed",
      completedAt: at(DAY1, 18),
      remainingMinutes: 0,
    });
    // Custom sections are recurring, so their work reopens too.
    const { tasks } = rolloverTasks([task], [], DAY2);
    expect(tasks[0].status).toBe("active");
    expect(tasks[0].section).toBe("custom");
    expect(tasks[0].customSectionId).toBe("sec-research");
  });
});

describe("TEST 11-13 — the reminder engine reads today's activity", () => {
  const now = (key: string, h: number) => {
    const [y, mo, d] = key.split("-").map(Number);
    return new Date(y, mo - 1, d, h, 0);
  };

  it("TEST 12 — a task completed for today gets no reminder today", () => {
    const done = completedOn("ml", "ML", DAY2, 60);
    expect(pickNextTask(DAY2, [done])).toBeNull();

    const plan = evaluateReminder({
      now: new Date(2026, 8, 14, 15, 0), // DAY2 15:00 local
      tasks: [done],
      logs: [L("ml", 60, DAY2)],
      settings,
    });
    // Today's moment is spent; the planner arms nothing for DAY2 but does arm
    // the following days, because recurring work reopens.
    expect(plan.records.filter((r) => r.date === DAY2)).toHaveLength(0);
    expect(plan.records.some((r) => r.date === DAY3 && r.taskIds.includes("ml"))).toBe(true);
  });

  it("TEST 13 — the same task is a reminder candidate again the next day", () => {
    // Completed on day 2, never touched on day 3: momentum must see pending work.
    const stale = completedOn("ml", "ML", DAY2, 60);

    expect(pickNextTask(DAY3, [stale])?.id).toBe("ml");
    expect(remainingOn(stale, DAY3)).toBe(60);

    // DAY3 15:00 is after the 09:00 default, so today's reminder is a catch-up.
    const plan = evaluateReminder({
      now: new Date(2026, 8, 15, 15, 0),
      tasks: [stale],
      logs: [L("ml", 60, DAY2)],
      settings,
    });
    const today = plan.records.find((r) => r.date === DAY3);
    expect(today?.taskIds).toContain("ml");
    expect(today?.catchUp).toBe(true);
  });

  it("TEST 11 — plans a native cue for a pending daily task with a start time", () => {
    const task = T({
      id: "ml",
      title: "ML",
      schedule: { type: "daily", startTime: "19:00", endTime: "20:00" },
    });
    const { creates } = planNotifications({
      now: now(DAY2, 8),
      tasks: [task],
      logs: [],
      existing: [],
      settings,
    });
    const types = creates.map((c) => c.type);
    expect(types).toContain("task_start");
    expect(creates.find((c) => c.type === "task_start")?.scheduledAt).toBe(at(DAY2, 19));
  });
});

describe("rollover only reopens what belongs to an earlier day", () => {
  it("leaves a task completed today alone", () => {
    const task = completedOn("dsa", "DSA", DAY2);
    expect(needsNewDayReset(task, DAY2, false)).toBe(false);
    expect(rolloverTasks([task], [], DAY2).changed).toHaveLength(0);
  });

  it("reopens a completed recurring task with no trustworthy timestamp", () => {
    const legacy = T({ id: "legacy", title: "Legacy routine", status: "completed", remainingMinutes: 0 });
    expect(needsNewDayReset(legacy, DAY3, false)).toBe(true);
  });

  it("never reopens an accomplished goal", () => {
    const done = T({
      id: "goal",
      title: "M.Tech",
      status: "accomplished",
      accomplishedAt: at(DAY1, 12),
      completedAt: at(DAY1, 12),
      remainingMinutes: 0,
    });
    expect(needsNewDayReset(done, DAY2, false)).toBe(false);
    expect(rolloverTasks([done], [], DAY2).changed).toHaveLength(0);
  });

  it("handles a missing / malformed completion timestamp safely", () => {
    const broken = T({
      id: "broken",
      title: "Broken",
      status: "completed",
      completedAt: "not-a-date",
      remainingMinutes: 0,
    });
    expect(completionDayOf(broken)).toBeNull();
    expect(rolloverTasks([broken], [], DAY2).changed).toHaveLength(1);
  });
});
