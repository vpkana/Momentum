import { describe, expect, it } from "vitest";
import { isSectionActiveOnDate } from "../schedule";
import type { CustomSection, Task, TimeLog } from "../types";
import {
  CATCH_UP_LEAD_MINUTES,
  MAX_NATIVE_RECORDS,
  MAX_REMINDER_RECORDS,
  NATIVE_HORIZON_HOURS,
  evaluateReminder,
  evaluateTaskDay,
  isQuietHours,
  reminderTimeFor,
  selectNativeSchedule,
  type ReminderContext,
} from "./planner";
import type { NotificationSettings } from "./types";

/**
 * The reminder philosophy, rule by rule.
 *
 * One test per product rule so a future change to the planner has to be a
 * deliberate decision rather than an accident.
 */

const settings: NotificationSettings = {
  enabled: true,
  dailyReminderTime: "09:00",
  followUpTime: "17:00",
  remainderWeekday: 6, // Saturday
  remainderTime: "10:00",
  occasionalDays: [1, 15],
  occasionalTime: "10:00",
  taskReminders: true,
  specialTaskReminders: true,
  overdueReminders: true,
  snoozeMinutes: 30,
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "07:00",
  cooldownMinutes: 60,
  completionCooldownMinutes: 30,
  morningHour: 9,
};

const at = (y: number, mo: number, d: number, h = 8, m = 0): Date =>
  new Date(y, mo - 1, d, h, m);

const MON = "2026-09-14"; // Monday
const TUE = "2026-09-15";
const SAT = "2026-09-19";

const T = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 60,
  status: "active",
  createdAt: "2026-01-01T09:00:00.000Z",
  ...o,
});

const L = (taskId: string, minutes: number, date: string): TimeLog => ({
  id: `${taskId}-${date}`,
  taskId,
  minutes,
  date,
});

const weekly = (o: Partial<NotificationSettings> = {}): NotificationSettings => ({
  ...settings,
  ...o,
});

const ctx = (o: Partial<ReminderContext> = {}): ReminderContext => ({
  now: at(2026, 9, 14),
  tasks: [],
  logs: [],
  settings,
  ...o,
});

const on = (plan: ReturnType<typeof evaluateReminder>, date: string) =>
  plan.records.filter((r) => r.date === date);

/* ------------------------------------------------------------------ */
/* Daily tasks                                                         */
/* ------------------------------------------------------------------ */

describe("daily tasks", () => {
  it("get one reminder at their time plus one later check-in — never more", () => {
    const plan = evaluateReminder(ctx({ tasks: [T({ id: "dsa", title: "DSA" })] }));
    const today = on(plan, MON);

    expect(today.map((r) => r.type)).toEqual(["daily", "follow_up"]);
    expect(today[0].priority).toBe("medium");
    expect(today[0].at.getHours()).toBe(9);
    expect(today[1].at.getHours()).toBe(17);
    expect(today[0].body).toContain("Good morning");
    // Tomorrow is by definition not scheduled here, so nothing twice.
    expect(on(plan, MON).filter((r) => r.type === "daily")).toHaveLength(1);
  });

  it("stay silent once completed today", () => {
    const done = T({
      id: "dsa",
      title: "DSA",
      status: "completed",
      completedAt: at(2026, 9, 14, 7, 30).toISOString(),
      remainingMinutes: 0,
    });
    const plan = evaluateReminder(ctx({ tasks: [done] }));

    expect(on(plan, MON)).toHaveLength(0);
    // Recurring work reopens the next day.
    expect(on(plan, TUE).some((r) => r.type === "daily")).toBe(true);
  });

  it("stay silent when minutes are already logged today", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "dsa", title: "DSA" })], logs: [L("dsa", 30, MON)] }),
    );
    expect(on(plan, MON)).toHaveLength(0);
    expect(plan.skipped.some((s) => s.reason === "logged_today")).toBe(true);
  });

  it("never remind about an accomplished task", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "old", title: "Old goal", status: "accomplished" })] }),
    );
    expect(plan.records).toHaveLength(0);
    expect(plan.skipped.every((s) => s.reason === "accomplished")).toBe(true);
  });

  it("collapse into one notification when they share a time (no barrage)", () => {
    const tasks = [
      T({ id: "a", title: "DSA" }),
      T({ id: "b", title: "ML" }),
      T({ id: "c", title: "Reading" }),
    ];
    const plan = evaluateReminder(ctx({ tasks }));
    const today = on(plan, MON).filter((r) => r.type === "daily");

    expect(today).toHaveLength(1);
    expect(today[0].taskIds).toHaveLength(3);
    expect(today[0].title).toBe("Today's plan");
    expect(today[0].body).toContain("3 tasks planned");
  });

  it("stay separate when the user gives them different times", () => {
    const tasks = [
      T({ id: "a", title: "DSA", notifyTime: "09:00" }),
      T({ id: "b", title: "ML", notifyTime: "11:00" }),
    ];
    const plan = evaluateReminder(ctx({ tasks }));
    const today = on(plan, MON).filter((r) => r.type === "daily");
    expect(today.map((r) => r.at.getHours())).toEqual([9, 11]);
  });
});

/* ------------------------------------------------------------------ */
/* Reminder tasks                                                      */
/* ------------------------------------------------------------------ */

describe("Reminder-section tasks", () => {
  it("remind weekly while incomplete, on the chosen weekend day", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "call", title: "Call grandmother", section: "remainder" })] }),
    );

    expect(plan.records.map((r) => r.date)).toEqual([SAT]);
    expect(plan.records[0].type).toBe("weekly");
    expect(plan.records[0].priority).toBe("medium");
    expect(plan.records[0].at.getHours()).toBe(10);
  });

  it("stop for good once completed — no invented recurrence", () => {
    const done = T({
      id: "call",
      title: "Call grandmother",
      section: "remainder",
      status: "completed",
      completedAt: at(2026, 9, 14, 12).toISOString(),
      remainingMinutes: 0,
    });
    expect(evaluateReminder(ctx({ tasks: [done] })).records).toHaveLength(0);
  });

  it("are not treated as daily tasks", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "call", title: "Call", section: "remainder" })] }),
    );
    expect(plan.records.every((r) => r.type === "weekly")).toBe(true);
  });

  it("use their due date when they have one, then stay overdue", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [
          T({ id: "form", title: "Form", section: "remainder", dueDate: "2026-09-16" }),
        ],
      }),
    );

    expect(plan.records.map((r) => r.date)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    // One day before, the deadline countdown begins.
    expect(plan.records[0].type).toBe("deadline");
    expect(plan.records[0].priority).toBe("high");
    expect(plan.records[0].body).toContain("1 day left");
    expect(plan.records[1].type).toBe("due");
    expect(plan.records[1].priority).toBe("high");
    expect(plan.records[2].type).toBe("overdue");
    expect(plan.records[2].body).toContain("1 day overdue");
  });

  it("counts down a week out, at 3 days and the day before — then stays on it", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [
          T({ id: "thesis", title: "Thesis", section: "remainder", dueDate: "2026-09-21" }),
        ],
      }),
    );
    const countdowns = plan.records.filter((r) => r.type === "deadline");

    expect(countdowns.map((r) => r.date)).toEqual(["2026-09-14", "2026-09-18", "2026-09-20"]);
    expect(countdowns.map((r) => r.body)).toEqual([
      "7 days left — Thesis is due soon.",
      "3 days left — Thesis is due soon.",
      "1 day left — Thesis is due tomorrow.",
    ]);
    // The due day itself is HIGH; it sits just beyond this horizon, while the
    // previous test covers it inside the window.
    expect(plan.records.every((r) => r.date !== "2026-09-21")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Occasional tasks                                                    */
/* ------------------------------------------------------------------ */

describe("Occasional (bucket list) tasks", () => {
  it("get a calm check-in twice a month when they have no date", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "trip", title: "Plan trip", section: "occasional" })] }),
    );

    expect(plan.records.map((r) => r.date)).toEqual(["2026-09-15"]);
    expect(plan.records[0].type).toBe("monthly");
    expect(plan.records[0].priority).toBe("low");
    expect(plan.records[0].body).toContain("Bucket list check-in");
  });

  it("never become a recurring nag — a missed check-in is not chased", () => {
    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 15, 12),
        tasks: [T({ id: "trip", title: "Plan trip", section: "occasional" })],
      }),
    );
    // The 15th's 10:00 check-in has passed; nothing is re-armed the same day.
    expect(plan.records).toHaveLength(0);
    expect(plan.skipped.some((s) => s.reason === "moment_passed")).toBe(true);
  });

  it("use a due date when one exists", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [
          T({ id: "trip", title: "Plan trip", section: "occasional", dueDate: "2026-09-18" }),
        ],
      }),
    );
    expect(plan.records.find((r) => r.type === "due")?.date).toBe("2026-09-18");
    // Dated items count down instead of getting the twice-monthly check-in.
    expect(plan.records.filter((r) => r.type === "deadline").map((r) => r.date)).toEqual([
      "2026-09-15",
      "2026-09-17",
    ]);
    expect(plan.records.some((r) => r.type === "monthly")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Custom sections                                                     */
/* ------------------------------------------------------------------ */

describe("custom sections", () => {
  const mondaySection: CustomSection = {
    id: "sec-research",
    name: "Research",
    schedule: { type: "weekly", days: [1], startTime: "19:00" },
    createdAt: "2026-01-01T09:00:00.000Z",
  };

  it("own recurrence — tasks only fire on active days", () => {
    const task = T({
      id: "paper",
      title: "Paper",
      section: "custom",
      customSectionId: "sec-research",
    });
    const plan = evaluateReminder(ctx({ tasks: [task], sections: [mondaySection] }));
    const scheduled = plan.records.filter((r) => r.type === "daily");

    // Only the Monday inside the 7-day horizon.
    expect(scheduled.map((r) => r.date)).toEqual([MON]);
    expect(scheduled[0].at.getHours()).toBe(19);
    expect(scheduled[0].priority).toBe("medium");
  });

  it("ask the section whether it is active, not the task", () => {
    const monthly: CustomSection = {
      id: "s",
      name: "Monthly",
      schedule: { type: "monthly-date", dayOfMonth: "last" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    expect(isSectionActiveOnDate(monthly, at(2026, 9, 30))).toBe(true);
    expect(isSectionActiveOnDate(monthly, at(2026, 9, 29))).toBe(false);

    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 28),
        tasks: [T({ id: "t", title: "Report", section: "custom", customSectionId: "s" })],
        sections: [monthly],
      }),
    );
    expect(plan.records.map((r) => r.date)).toContain("2026-09-30");
  });

  it("say nothing when the section is inactive", () => {
    const task = T({
      id: "paper",
      title: "Paper",
      section: "custom",
      customSectionId: "sec-research",
    });
    const plan = evaluateReminder(ctx({ now: at(2026, 9, 15), tasks: [task], sections: [mondaySection] }));
    // Tuesday 15th is not a Monday; the next active day is the 21st.
    expect(on(plan, TUE)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Explicit user reminders                                             */
/* ------------------------------------------------------------------ */

describe("explicit user reminders", () => {
  const remindAt = at(2026, 9, 14, 23, 30).toISOString();

  it("fire exactly when asked, even inside quiet hours", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "hw", title: "Submit assignment", remindAt })] }),
    );
    const today = on(plan, MON).filter((r) => r.type === "explicit");

    expect(today).toHaveLength(1);
    expect(today[0].priority).toBe("high");
    expect(today[0].at.getHours()).toBe(23);
    expect(today[0].at.getMinutes()).toBe(30);
    expect(today[0].body).toContain("Reminder");
  });

  it("outrank the routine reminder for the same day (one notification)", () => {
    const task = T({ id: "hw", title: "Submit assignment", dueDate: MON, remindAt });
    const today = on(evaluateReminder(ctx({ tasks: [task] })), MON);
    expect(today.filter((r) => r.type === "explicit")).toHaveLength(1);
    expect(today.some((r) => r.type === "due")).toBe(false);
  });

  it("do not repeat on other days", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "hw", title: "Submit assignment", remindAt })] }),
    );
    expect(plan.records.filter((r) => r.type === "explicit").map((r) => r.date)).toEqual([MON]);
  });
});

/* ------------------------------------------------------------------ */
/* Quiet hours                                                         */
/* ------------------------------------------------------------------ */

describe("quiet hours", () => {
  it("suppress ordinary reminders whose time lands inside the window", () => {
    const section: CustomSection = {
      id: "sec-early",
      name: "Early",
      schedule: { type: "daily", startTime: "06:00" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        tasks: [T({ id: "run", title: "Run", section: "custom", customSectionId: "sec-early" })],
        sections: [section],
      }),
    );
    expect(plan.records.some((r) => r.at.getHours() === 6)).toBe(false);
    expect(plan.skipped.some((s) => s.reason === "quiet_hours")).toBe(true);
  });

  it("never silence an important due reminder", () => {
    const section: CustomSection = {
      id: "sec-early",
      name: "Early",
      schedule: { type: "daily", startTime: "06:00" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 14, 5, 0),
        tasks: [
          T({
            id: "bill",
            title: "Pay bill",
            section: "custom",
            customSectionId: "sec-early",
            dueDate: MON,
          }),
        ],
        sections: [section],
      }),
    );
    const due = plan.records.find((r) => r.type === "due");
    expect(due?.at.getHours()).toBe(6);
  });

  it("never silence a time the user typed on the task", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "read", title: "Read", notifyTime: "23:00" })] }),
    );
    expect(on(plan, MON).some((r) => r.at.getHours() === 23)).toBe(true);
  });

  it("wrap across midnight and can be switched off", () => {
    expect(isQuietHours(at(2026, 9, 14, 23, 0), settings)).toBe(true);
    expect(isQuietHours(at(2026, 9, 14, 6, 0), settings)).toBe(true);
    expect(isQuietHours(at(2026, 9, 14, 9, 0), settings)).toBe(false);
    expect(isQuietHours(at(2026, 9, 14, 23, 0), weekly({ quietHoursEnabled: false }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Later check-in (motivational)                                       */
/* ------------------------------------------------------------------ */

describe("the later check-in", () => {
  it("appears once a day while planned work is open", () => {
    const plan = evaluateReminder(ctx({ tasks: [T({ id: "a", title: "DSA" })] }));
    const checkins = on(plan, MON).filter((r) => r.type === "follow_up");
    expect(checkins).toHaveLength(1);
    expect(checkins[0].priority).toBe("medium");
    expect(checkins[0].body).toContain("planned today");
  });

  it("disappears when the day is finished", () => {
    const done = T({
      id: "a",
      title: "DSA",
      status: "completed",
      completedAt: at(2026, 9, 14, 12).toISOString(),
      remainingMinutes: 0,
    });
    const plan = evaluateReminder(ctx({ tasks: [done] }));
    expect(on(plan, MON).filter((r) => r.type === "follow_up")).toHaveLength(0);
  });

  it("never stacks on another reminder", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "a", title: "DSA", notifyTime: "17:30" })] }),
    );
    expect(on(plan, MON).filter((r) => r.type === "follow_up")).toHaveLength(0);
  });

  it("stays quiet right after real activity", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [T({ id: "a", title: "DSA" })],
        lastMeaningfulActivityAt: at(2026, 9, 14, 16, 45).toISOString(),
      }),
    );
    expect(on(plan, MON).filter((r) => r.type === "follow_up")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Priority, suppression, snooze, toggles                              */
/* ------------------------------------------------------------------ */

describe("priority and single delivery", () => {
  it("never repeats the same reminder reason in one day", () => {
    const plan = evaluateReminder(ctx({ tasks: [T({ id: "a", title: "DSA" })] }));
    for (const date of new Set(plan.records.map((r) => r.date))) {
      const day = on(plan, date);
      expect(day.map((r) => r.type).length).toBe(new Set(day.map((r) => r.type)).size);
      // A daily task may be mentioned at most twice: its time + the check-in.
      const mentions = day.flatMap((r) => r.taskIds).filter((id) => id === "a");
      expect(mentions.length).toBeLessThanOrEqual(2);
    }
  });

  it("replaces a snoozed task's reminder with the snooze moment", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [T({ id: "a", title: "DSA" })],
        snoozes: [{ taskId: "a", at: at(2026, 9, 14, 15, 0) }],
      }),
    );
    const today = on(plan, MON);
    expect(today.some((r) => r.type === "daily")).toBe(false);
    const snoozed = today.find((r) => r.reason === "snoozed");
    expect(snoozed?.priority).toBe("high");
    expect(snoozed?.at.getHours()).toBe(15);
  });

  it("skips reminders already delivered today", () => {
    const key = evaluateReminder(
      ctx({ tasks: [T({ id: "a", title: "DSA" })], now: at(2026, 9, 14, 10) }),
    ).records.find((r) => r.type === "daily")!.key;

    const plan = evaluateReminder(
      ctx({
        tasks: [T({ id: "a", title: "DSA" })],
        now: at(2026, 9, 14, 10),
        firedKeys: new Set([key]),
      }),
    );
    expect(on(plan, MON).some((r) => r.type === "daily")).toBe(false);
  });

  it("honours the per-section switches", () => {
    const tasks = [
      T({ id: "daily", title: "Daily" }),
      T({ id: "due", title: "Due", section: "remainder", dueDate: MON }),
    ];
    const off = evaluateReminder(
      ctx({
        tasks,
        settings: weekly({
          taskReminders: false,
          specialTaskReminders: false,
          overdueReminders: false,
        }),
      }),
    );
    expect(off.records).toHaveLength(0);

    // Switching off routine reminders leaves the important ones alone.
    const overdueOnly = evaluateReminder(
      ctx({ tasks, settings: weekly({ taskReminders: false }) }),
    );
    expect(overdueOnly.records.every((r) => r.type === "due" || r.type === "overdue")).toBe(true);
    expect(overdueOnly.records.some((r) => r.type === "daily")).toBe(false);
  });

  it("caps the queue, keeping the earliest alarms", () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      T({ id: `t${i}`, title: `Task ${i}`, notifyTime: `${String(6 + i).padStart(2, "0")}:00` }),
    );
    const plan = evaluateReminder(ctx({ tasks, settings: weekly({ quietHoursEnabled: false }) }));

    expect(plan.records).toHaveLength(MAX_REMINDER_RECORDS);
    expect(plan.records[0].date).toBe(MON);
    expect(plan.records[plan.records.length - 1].date < "2026-09-20").toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Time resolution and the public decision shape                       */
/* ------------------------------------------------------------------ */

describe("time resolution and decisions", () => {
  it("prefers the task's time, then the section's, then the default", () => {
    expect(reminderTimeFor(T({ id: "a", title: "A", notifyTime: "07:15" }), settings)).toEqual({
      hhmm: "07:15",
      explicit: true,
    });
    const custom = T({
      id: "b",
      title: "B",
      section: "custom",
      customSectionId: "s",
      schedule: { type: "daily", startTime: "19:00" },
    });
    expect(reminderTimeFor(custom, settings)).toEqual({ hhmm: "19:00", explicit: false });
    expect(reminderTimeFor(T({ id: "c", title: "C" }), settings)).toEqual({
      hhmm: "09:00",
      explicit: false,
    });
  });

  it("answers the product's decision shape for one task and day", () => {
    const daily = evaluateTaskDay(
      ctx(),
      T({ id: "dsa", title: "DSA" }),
      at(2026, 9, 15),
    );
    expect(daily).toMatchObject({
      shouldNotify: true,
      type: "daily",
      priority: "medium",
      taskId: "dsa",
      sectionId: null,
      suggestedFireTime: at(2026, 9, 15, 9),
    });

    const archived = evaluateTaskDay(
      ctx(),
      T({ id: "old", title: "Old", status: "accomplished" }),
      at(2026, 9, 15),
    );
    expect(archived.shouldNotify).toBe(false);
    expect(archived.reason).toBe("accomplished");
  });

  it("re-arms a passed meaningful moment once, later today", () => {
    const plan = evaluateReminder(
      ctx({ now: at(2026, 9, 14, 15, 0), tasks: [T({ id: "a", title: "DSA" })] }),
    );
    const daily = on(plan, MON).find((r) => r.type === "daily");
    expect(daily?.catchUp).toBe(true);
    expect(daily?.at.getTime()).toBe(at(2026, 9, 14, 15, 0).getTime() + CATCH_UP_LEAD_MINUTES * 60_000);
  });

  it("keeps passed moments at their real time when the caller delivers them late", () => {
    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 14, 15, 0),
        tasks: [T({ id: "a", title: "DSA" })],
        includePast: true,
      }),
    );
    const daily = on(plan, MON).find((r) => r.type === "daily");
    expect(daily?.catchUp).toBe(false);
    expect(daily?.at.getTime()).toBe(at(2026, 9, 14, 9, 0).getTime());
  });

  it("produces nothing when reminders are switched off", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "a", title: "DSA" })], settings: weekly({ enabled: false }) }),
    );
    expect(plan.records).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The native queue                                                    */
/* ------------------------------------------------------------------ */

describe("the native queue", () => {
  it("arms only the next meaningful reminders — never a week-long stream", () => {
    const plan = evaluateReminder(ctx({ tasks: [T({ id: "a", title: "DSA" })] }));
    const now = at(2026, 9, 14, 8);
    const armed = selectNativeSchedule(plan.records, now);

    expect(armed.length).toBeLessThanOrEqual(MAX_NATIVE_RECORDS);
    const limit = now.getTime() + NATIVE_HORIZON_HOURS * 60 * 60_000;
    for (const r of armed) expect(r.at.getTime()).toBeLessThanOrEqual(limit);
    // The evaluator still reasons across the full week; only the arming is short.
    expect(plan.records.length).toBeGreaterThan(armed.length);
    expect(armed[0].at.getTime()).toBe(plan.records[0].at.getTime());
  });

  it("carries task, section and fire-time metadata for every armed reminder", () => {
    const section: CustomSection = {
      id: "sec-research",
      name: "Research",
      schedule: { type: "daily", startTime: "19:00" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        tasks: [T({ id: "paper", title: "Paper", section: "custom", customSectionId: "sec-research" })],
        sections: [section],
      }),
    );
    const armed = selectNativeSchedule(plan.records, at(2026, 9, 14, 8));
    const scheduled = armed.find((r) => r.type === "daily")!;
    expect(scheduled.taskIds).toEqual(["paper"]);
    expect(scheduled.sectionIds).toEqual(["sec-research"]);
    expect(scheduled.reason).toBe("scheduled_task");
    expect(scheduled.priority).toBe("medium");
  });
});

/* ------------------------------------------------------------------ */
/* Task type → reminder matrix                                         */
/* ------------------------------------------------------------------ */

/**
 * The centralized, deterministic policy. One row per task type, asserting the
 * type of reminder it is eligible for — and, just as importantly, the ones it
 * is NOT. Nothing here is a score; the mapping is predictable by construction.
 */
describe("task type → reminder matrix", () => {
  const dayOf = (plan: ReturnType<typeof evaluateReminder>, date: string) =>
    plan.records.filter((r) => r.date === date).map((r) => r.type);

  it("Daily → daily eligibility, on every local day", () => {
    const plan = evaluateReminder(ctx({ tasks: [T({ id: "a", title: "Habit" })] }));
    expect(dayOf(plan, MON)).toContain("daily");
    expect(dayOf(plan, TUE)).toContain("daily");
  });

  it("Reminder → weekly eligibility only, never daily", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "a", title: "Essay", section: "remainder" })] }),
    );
    expect(dayOf(plan, SAT)).toContain("weekly");
    // Monday and Tuesday are not the check-in day.
    expect(dayOf(plan, MON)).toHaveLength(0);
    expect(dayOf(plan, TUE)).toHaveLength(0);
  });

  it("Occasional with a date → date-based reminder", () => {
    const plan = evaluateReminder(
      ctx({
        tasks: [
          T({ id: "a", title: "Trip", section: "occasional", dueDate: "2026-09-18" }),
        ],
      }),
    );
    expect(dayOf(plan, "2026-09-18")).toContain("due");
  });

  it("Occasional without a date → twice-monthly check-in only", () => {
    const plan = evaluateReminder(
      ctx({ tasks: [T({ id: "a", title: "Trip", section: "occasional" })] }),
    );
    expect(dayOf(plan, "2026-09-15")).toContain("monthly");
    expect(dayOf(plan, MON)).toHaveLength(0);
    expect(dayOf(plan, "2026-09-16")).toHaveLength(0);
  });

  it("Custom section → eligible only on days the section is active", () => {
    const mondaySection: CustomSection = {
      id: "sec-research",
      name: "Research",
      schedule: { type: "weekly", days: [1], startTime: "19:00" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        sections: [mondaySection],
        tasks: [
          T({ id: "a", title: "Read paper", section: "custom", customSectionId: "sec-research" }),
        ],
      }),
    );
    expect(dayOf(plan, MON)).toContain("daily");
    expect(dayOf(plan, TUE)).toHaveLength(0);
    expect(plan.skipped.some((s) => s.reason === "section_inactive")).toBe(true);
  });

  it("Daily section → reminders on every day the section is active", () => {
    const dailySection: CustomSection = {
      id: "sec-focus",
      name: "Focus",
      schedule: { type: "daily", startTime: "08:00" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        sections: [dailySection],
        tasks: [
          T({ id: "a", title: "Deep work", section: "custom", customSectionId: "sec-focus" }),
        ],
      }),
    );
    expect(dayOf(plan, MON)).toContain("daily");
    expect(dayOf(plan, TUE)).toContain("daily");
  });

  it("Monthly (last day) section → reminders only on the last day", () => {
    const monthly: CustomSection = {
      id: "sec-report",
      name: "Report",
      schedule: { type: "monthly-date", dayOfMonth: "last" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    // Reasoned from the 28th, so the 30th falls inside the horizon.
    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 28),
        sections: [monthly],
        tasks: [
          T({ id: "a", title: "Monthly report", section: "custom", customSectionId: "sec-report" }),
        ],
      }),
    );
    expect(dayOf(plan, "2026-09-30")).toContain("daily");
    expect(dayOf(plan, "2026-09-28")).toHaveLength(0);
    expect(dayOf(plan, "2026-09-29")).toHaveLength(0);
  });

  it("Monthly (weekday occurrence) section → reminders only on that occurrence", () => {
    // The 4th Monday of September 2026 is the 28th; the 1st is the 7th.
    const fourthMonday: CustomSection = {
      id: "sec-review",
      name: "Review",
      schedule: { type: "monthly-weekday", weekday: 1, occurrence: "fourth" },
      createdAt: "2026-01-01T09:00:00.000Z",
    };
    const plan = evaluateReminder(
      ctx({
        now: at(2026, 9, 28),
        sections: [fourthMonday],
        tasks: [
          T({ id: "a", title: "Review", section: "custom", customSectionId: "sec-review" }),
        ],
      }),
    );
    expect(dayOf(plan, "2026-09-28")).toContain("daily");
    expect(dayOf(plan, "2026-09-29")).toHaveLength(0);
  });
});
