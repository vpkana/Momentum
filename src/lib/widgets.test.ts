import { describe, expect, it } from "vitest";
import { buildWidgetSnapshot, MAX_WIDGET_TASKS } from "./widgets";
import type { DailyPerformance, Task, TimeLog } from "./types";

const NOW = new Date(2026, 9, 22, 10, 0); // Thursday, 22 Oct 2026 (local)
const DAY = "2026-10-22";
const YESTERDAY = "2026-10-21";

const T = (o: Partial<Task> & { id: string; title: string }): Task => {
  const planned = o.estimatedMinutes === undefined ? 30 : o.estimatedMinutes;
  return {
    section: "daily",
    estimatedMinutes: planned,
    remainingMinutes: planned ?? 0,
    status: "active",
    createdAt: "2026-01-01T09:00:00.000Z",
    ...o,
  };
};

const H = (date: string, percentage: number): DailyPerformance => ({
  date,
  plannedMinutes: 60,
  completedMinutes: Math.round((percentage / 100) * 60),
  percentage,
});

const snapshot = (tasks: Task[], history: DailyPerformance[] = [], logs: TimeLog[] = []) =>
  buildWidgetSnapshot({ tasks, history, logs, sections: [], now: NOW });

describe("buildWidgetSnapshot", () => {
  it("counts today's work, prefers an actionable next task, and splits done from open", () => {
    const tasks = [
      T({ id: "a", title: "Read", estimatedMinutes: 30, remainingMinutes: 30 }),
      T({
        id: "b",
        title: "Write report",
        estimatedMinutes: 60,
        remainingMinutes: 0,
        status: "completed",
        nextAction: "Draft the introduction",
      }),
      T({ id: "c", title: "Stretch", estimatedMinutes: null }),
    ];

    const result = snapshot(tasks);

    expect(result.total).toBe(3);
    expect(result.done).toBe(1);
    expect(result.taskPercent).toBe(33);
    // Mixed timed + untimed work is measured in tasks, like Home.
    expect(result.timeBased).toBe(false);
    expect(result.percent).toBe(33);
    expect(result.plannedMinutes).toBe(90);
    expect(result.remainingMinutes).toBe(30);
    expect(result.tasks.map((task) => task.id)).toEqual(["a", "c", "b"]);
    expect(result.next?.id).toBe("a");
  });

  it("moves the task with a next action to the front and makes it Up next", () => {
    const tasks = [
      T({ id: "a", title: "Alpha" }),
      T({ id: "b", title: "Beta", nextAction: "Open the editor" }),
    ];

    const result = snapshot(tasks);

    expect(result.tasks[0].id).toBe("b");
    expect(result.next).toMatchObject({ id: "b", title: "Beta", timed: true });
  });

  it("treats a recurring completion from yesterday as open today", () => {
    const tasks = [
      T({
        id: "a",
        title: "Practice",
        status: "completed",
        completedAt: new Date(2026, 9, 21, 18).toISOString(),
        remainingMinutes: 0,
      }),
    ];

    const result = snapshot(tasks);

    expect(result.done).toBe(0);
    expect(result.tasks[0]).toMatchObject({ id: "a", done: false });
    expect(result.next?.id).toBe("a");
  });

  it("keeps a completed dated task done regardless of its section", () => {
    const tasks = [
      T({
        id: "a",
        title: "Submit thesis",
        dueDate: DAY,
        status: "completed",
        completedAt: new Date(2026, 9, 21, 18).toISOString(),
        remainingMinutes: 0,
      }),
    ];

    const result = snapshot(tasks);

    expect(result.done).toBe(1);
    expect(result.tasks[0]).toMatchObject({ id: "a", done: true });
  });

  it("includes one-offs due today and excludes work that does not occur today", () => {
    const tasks = [
      T({ id: "daily", title: "Daily" }),
      T({
        id: "today",
        title: "Deadline today",
        section: "remainder",
        estimatedMinutes: null,
        dueDate: DAY,
      }),
      T({
        id: "tomorrow",
        title: "Deadline tomorrow",
        section: "remainder",
        estimatedMinutes: null,
        dueDate: "2026-10-23",
      }),
      T({ id: "done-goal", title: "Retired", status: "accomplished" }),
    ];

    const result = snapshot(tasks);

    expect(result.tasks.map((task) => task.id).sort()).toEqual(["daily", "today"]);
    expect(result.total).toBe(2);
    expect(result.tasks.find((task) => task.id === "today")?.meta).toBe("Due today");
  });

  it("caps the rendered rows while still reporting the full day count", () => {
    const tasks = Array.from({ length: MAX_WIDGET_TASKS + 3 }, (_, index) =>
      T({ id: `t${index}`, title: `Task ${index}` }),
    );

    const result = snapshot(tasks);

    expect(result.tasks).toHaveLength(MAX_WIDGET_TASKS);
    expect(result.total).toBe(MAX_WIDGET_TASKS + 3);
  });

  it("uses minutes for the bar when every task is timed", () => {
    const tasks = [
      T({ id: "a", title: "A", estimatedMinutes: 30, remainingMinutes: 0, status: "completed" }),
      T({ id: "b", title: "B", estimatedMinutes: 90, remainingMinutes: 90 }),
    ];
    const logs: TimeLog[] = [{ id: "l1", taskId: "a", minutes: 30, date: DAY }];

    const result = snapshot(tasks, [], logs);

    expect(result.timeBased).toBe(true);
    expect(result.percent).toBe(25); // 30 of 120 planned minutes
    expect(result.taskPercent).toBe(50);
    expect(result.streak).toBe(0); // 25% is below the 70% threshold
  });

  it("derives the streak from history plus today's live record", () => {
    const tasks = [
      T({ id: "a", title: "A", estimatedMinutes: 60, remainingMinutes: 0, status: "completed" }),
    ];
    const logs: TimeLog[] = [{ id: "l1", taskId: "a", minutes: 60, date: DAY }];
    const history = [H(YESTERDAY, 100), H("2026-10-20", 100)];

    const result = snapshot(tasks, history, logs);

    expect(result.percent).toBe(100);
    expect(result.streak).toBe(3);
  });

  it("describes an empty day without inventing progress", () => {
    const result = snapshot([]);

    expect(result.total).toBe(0);
    expect(result.done).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.taskPercent).toBe(0);
    expect(result.next).toBeNull();
    expect(result.tasks).toEqual([]);
  });
});
