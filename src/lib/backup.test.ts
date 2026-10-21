import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  parseBackup,
  serializeBackup,
  backupFilename,
  type BackupSource,
  type MomentumBackup,
} from "./backup";
import type {
  CustomSection,
  DailyPerformance,
  GeneralNote,
  Hobby,
  HobbyNote,
  Schedule,
  Task,
  TimeLog,
} from "./types";
import { liveDayRec, currentStreak, weeklyAggregate, longestStreak } from "./performance";
import { applyRecoveryKinds } from "./activity";
import { scheduleOccursOn, taskOccursOn } from "./schedule";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "DSA Practice",
    section: "daily",
    estimatedMinutes: 60,
    remainingMinutes: 60,
    status: "active",
    createdAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

function log(over: Partial<TimeLog> = {}): TimeLog {
  return { id: "l1", taskId: "t1", minutes: 60, date: "2026-09-10", ...over };
}

function section(over: Partial<CustomSection> = {}): CustomSection {
  return {
    id: "s1",
    name: "Research",
    schedule: { type: "weekly", days: [1, 3, 5] },
    createdAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

function perf(over: Partial<DailyPerformance> = {}): DailyPerformance {
  return {
    date: "2026-09-10",
    plannedMinutes: 60,
    completedMinutes: 60,
    percentage: 100,
    ...over,
  };
}

function hobby(over: Partial<Hobby> = {}): Hobby {
  return {
    id: "h1",
    name: "Photography",
    icon: "📷",
    accent: "blue",
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...over,
  };
}

function generalNote(over: Partial<GeneralNote> = {}): GeneralNote {
  return {
    id: "n1",
    title: "Golden hour",
    content: "Shoot 20 minutes before sunset.",
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...over,
  };
}

function hobbyNote(over: Partial<HobbyNote> = {}): HobbyNote {
  return { ...generalNote(), id: "hn1", hobbyId: "h1", ...over };
}

function source(over: Partial<BackupSource> = {}): BackupSource {
  return {
    tasks: [],
    logs: [],
    sections: [],
    performance: [],
    hobbies: [],
    generalNotes: [],
    hobbyNotes: [],
    meta: [],
    theme: null,
    ...over,
  };
}

/** Round-trip a source through the real file format. */
function roundTrip(src: BackupSource): MomentumBackup {
  const parsed = parseBackup(serializeBackup(buildBackup(src, new Date("2026-09-13T12:00:00.000Z"))));
  if (!parsed.ok) throw new Error(`expected a valid backup: ${parsed.error}`);
  return parsed.backup;
}

/* ------------------------------------------------------------------ */
/* 1–2. Export shape                                                   */
/* ------------------------------------------------------------------ */

describe("export", () => {
  it("1. exports an empty database without inventing data", () => {
    const backup = buildBackup(source(), new Date("2026-09-13T12:00:00.000Z"), "9.9.9");
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe("2026-09-13T12:00:00.000Z");
    expect(backup.appVersion).toBe("9.9.9");
    expect(backup.counts).toEqual({
      tasks: 0,
      logs: 0,
      sections: 0,
      performance: 0,
      hobbies: 0,
      generalNotes: 0,
      hobbyNotes: 0,
    });
    expect(backup.data.tasks).toEqual([]);
    expect(backup.data.settings.meta).toEqual({});
  });

  it("2. exports every user-owned table from a populated database", () => {
    const backup = roundTrip(
      source({
        tasks: [task(), task({ id: "t2", section: "remainder", estimatedMinutes: null })],
        logs: [log()],
        sections: [section()],
        performance: [perf()],
        hobbies: [hobby()],
        generalNotes: [generalNote({ id: "g2" })],
        hobbyNotes: [hobbyNote({ hobbyId: "h1" })],
        theme: "dark",
      }),
    );
    expect(backup.data.tasks).toHaveLength(2);
    expect(backup.data.logs).toHaveLength(1);
    expect(backup.data.sections).toHaveLength(1);
    expect(backup.data.performance).toHaveLength(1);
    expect(backup.data.hobbies).toHaveLength(1);
    expect(backup.data.generalNotes).toHaveLength(1);
    expect(backup.data.hobbyNotes).toHaveLength(1);
    expect(backup.data.settings.theme).toBe("dark");
  });

  it("names the file after the date so exports sort and never collide", () => {
    expect(backupFilename("momentum-backup", new Date("2026-09-13T09:00:00"))).toBe(
      "momentum-backup-2026-09-13.json",
    );
    expect(backupFilename("momentum-pre-import-backup", new Date("2026-01-02T09:00:00"))).toBe(
      "momentum-pre-import-backup-2026-01-02.json",
    );
  });

  it("exports only allowlisted settings and never device facts", () => {
    const backup = buildBackup(
      source({
        meta: [
          { key: "notificationSettings", value: { cooldownMinutes: 30, enabled: true } },
          { key: "profileName", value: "Aditi" },
          { key: "firstRunAt", value: "2026-09-01T00:00:00.000Z" },
          { key: "accentColor", value: "purple" },
          { key: "lastBackupAt", value: "2026-09-12T00:00:00.000Z" },
          { key: "lastNotificationAt", value: "2026-09-12T09:00:00.000Z" },
          // Device facts — these describe the phone, not the user's data.
          { key: "notificationPermissionState", value: "granted" },
          { key: "scheduledNotificationIds", value: [{ id: 7 }] },
          { key: "lastRolloverDate", value: "2026-09-13" },
        ],
      }),
    );
    const meta = backup.data.settings.meta;
    expect(meta.profileName).toBe("Aditi");
    expect(meta.accentColor).toBe("purple");
    expect(meta.lastBackupAt).toBe("2026-09-12T00:00:00.000Z");
    expect(meta.lastNotificationAt).toBe("2026-09-12T09:00:00.000Z");
    expect(meta.notificationPermissionState).toBeUndefined();
    expect(meta.scheduledNotificationIds).toBeUndefined();
    expect(meta.lastRolloverDate).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 3–12. History survives the round trip                               */
/* ------------------------------------------------------------------ */

describe("history preservation", () => {
  it("3. preserves Daily task history with one log per date", () => {
    const backup = roundTrip(
      source({
        tasks: [task()],
        logs: [
          log({ id: "l1", date: "2026-09-10", minutes: 60 }),
          log({ id: "l2", date: "2026-09-11", minutes: 20 }),
          log({ id: "l3", date: "2026-09-11", minutes: 40 }),
        ],
      }),
    );
    expect(backup.data.logs.map((l) => l.date)).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-11",
    ]);
    expect(backup.data.tasks[0].title).toBe("DSA Practice");
  });

  it("4. preserves a recurring custom section's task history", () => {
    const backup = roundTrip(
      source({
        sections: [section()],
        tasks: [task({ id: "t9", section: "custom", customSectionId: "s1" })],
        logs: [log({ id: "l9", taskId: "t9", date: "2026-09-07", minutes: 60 })],
      }),
    );
    expect(backup.data.sections[0].schedule).toEqual({ type: "weekly", days: [1, 3, 5] });
    expect(backup.data.tasks[0].customSectionId).toBe("s1");
  });

  it("5–6. preserves Reminder and Occasional tasks with their own semantics", () => {
    const backup = roundTrip(
      source({
        tasks: [
          task({ id: "r1", section: "remainder", title: "Submit form", estimatedMinutes: null }),
          task({ id: "o1", section: "occasional", title: "Watch Interstellar", estimatedMinutes: null }),
        ],
      }),
    );
    const bySection = Object.fromEntries(backup.data.tasks.map((t) => [t.id, t.section]));
    expect(bySection).toEqual({ r1: "remainder", o1: "occasional" });
  });

  it("7. keeps durationless tasks durationless — never converts null into 0", () => {
    const backup = roundTrip(
      source({
        tasks: [
          task({ id: "u1", estimatedMinutes: null, remainingMinutes: 0 }),
          // Legacy rows may carry 0 or a missing field; both mean "no duration".
          task({ id: "u2", section: "remainder", estimatedMinutes: 0 }),
          task({
            id: "u3",
            section: "occasional",
            estimatedMinutes: undefined as unknown as null,
          }),
        ],
      }),
    );
    for (const t of backup.data.tasks) {
      expect(t.estimatedMinutes).toBeNull();
    }
  });

  it("8. preserves timed tasks, including their remaining minutes", () => {
    const backup = roundTrip(
      source({ tasks: [task({ estimatedMinutes: 90, remainingMinutes: 35 })] }),
    );
    expect(backup.data.tasks[0].estimatedMinutes).toBe(90);
    expect(backup.data.tasks[0].remainingMinutes).toBe(35);
  });

  it("9. preserves time logs exactly", () => {
    const backup = roundTrip(
      source({
        tasks: [task({ id: "t1" })],
        logs: [log({ id: "l7", minutes: 25, date: "2026-08-31" })],
      }),
    );
    expect(backup.data.logs).toEqual([
      { id: "l7", taskId: "t1", minutes: 25, date: "2026-08-31" },
    ]);
  });

  it("10–11. preserves the historical performance rows that back streaks", () => {
    const backup = roundTrip(
      source({
        performance: [
          perf({ date: "2026-09-01", plannedMinutes: 100, completedMinutes: 80, percentage: 80 }),
          perf({ date: "2026-09-02", plannedMinutes: 100, completedMinutes: 75, percentage: 75 }),
          perf({ date: "2026-09-03", plannedMinutes: 100, completedMinutes: 90, percentage: 90 }),
        ],
      }),
    );
    expect(backup.data.performance.map((p) => p.percentage)).toEqual([80, 75, 90]);
  });

  it("12. preserves recovery-day classification", () => {
    const rows = applyRecoveryKinds(
      [
        ...[1, 2, 3, 4, 5].map((d) =>
          perf({
            date: `2026-08-0${d}`,
            plannedMinutes: 100,
            completedMinutes: 100,
            percentage: 100,
          }),
        ),
        perf({ date: "2026-08-06", plannedMinutes: 100, completedMinutes: 20, percentage: 20 }),
      ],
      "2026-09-01",
    );
    const earned = rows.find((r) => r.date === "2026-08-06");
    expect(earned?.kind).toBe("recovery");

    const backup = roundTrip(source({ performance: rows }));
    const restored = backup.data.performance.find((p) => p.date === "2026-08-06");
    expect(restored?.kind).toBe("recovery");

    // And it is reproducible: reclassifying the restored rows reaches the same
    // conclusion without trusting the cached `kind`.
    const recomputed = applyRecoveryKinds(
      backup.data.performance.map((r) => ({ ...r, kind: undefined })),
      "2026-09-01",
    );
    expect(recomputed.find((r) => r.date === "2026-08-06")?.kind).toBe("recovery");
  });

  it("13–15. preserves hobbies, hobby notes and general notes as separate tables", () => {
    const backup = roundTrip(
      source({
        hobbies: [hobby()],
        generalNotes: [generalNote({ id: "n2", title: "Loose thought" })],
        hobbyNotes: [hobbyNote({ id: "n1", hobbyId: "h1" })],
      }),
    );
    expect(backup.data.hobbies[0]).toMatchObject({ name: "Photography", icon: "📷", accent: "blue" });
    expect(backup.data.hobbyNotes.find((n) => n.id === "n1")?.hobbyId).toBe("h1");
    expect(backup.data.generalNotes.find((n) => n.id === "n2")?.title).toBe("Loose thought");
    // The two collections never bleed into each other.
    expect(backup.data.generalNotes).toHaveLength(1);
    expect(backup.data.hobbyNotes).toHaveLength(1);
  });

  it("24–25. leaves historical date keys byte-identical", () => {
    const backup = roundTrip(
      source({
        tasks: [task({ id: "t1" })],
        logs: [log({ date: "2026-01-01" }), log({ id: "l2", date: "2026-12-31" })],
        performance: [perf({ date: "2026-02-28" })],
      }),
    );
    expect(backup.data.logs.map((l) => l.date).sort()).toEqual([
      "2026-01-01",
      "2026-12-31",
    ]);
    expect(backup.data.performance[0].date).toBe("2026-02-28");
  });
});

/* ------------------------------------------------------------------ */
/* 26–30. Derived data is reconstructed, not trusted                   */
/* ------------------------------------------------------------------ */

describe("reconstruction after import", () => {
  it("26. rebuilds daily performance from the restored logs", () => {
    const restored = roundTrip(
      source({
        tasks: [task({ estimatedMinutes: 60 })],
        logs: [log({ date: "2026-09-10", minutes: 30 })],
      }),
    );
    const rec = liveDayRec(restored.data.tasks, restored.data.logs, "2026-09-10", restored.data.sections);
    expect(rec.plannedMinutes).toBe(60);
    expect(rec.completedMinutes).toBe(30);
    expect(rec.percentage).toBe(50);
  });

  it("27. reconstructs the streak as 3 from three qualifying restored days", () => {
    const restored = roundTrip(
      source({
        tasks: [task({ estimatedMinutes: 60 })],
        logs: [
          log({ id: "l1", date: "2026-09-01", minutes: 60 }),
          log({ id: "l2", date: "2026-09-02", minutes: 60 }),
          log({ id: "l3", date: "2026-09-03", minutes: 60 }),
        ],
        performance: [
          perf({ date: "2026-09-01", plannedMinutes: 60, completedMinutes: 60, percentage: 100 }),
          perf({ date: "2026-09-02", plannedMinutes: 60, completedMinutes: 60, percentage: 100 }),
          perf({ date: "2026-09-03", plannedMinutes: 60, completedMinutes: 60, percentage: 100 }),
        ],
      }),
    );
    expect(currentStreak(restored.data.performance, "2026-09-03")).toBe(3);
    expect(longestStreak(restored.data.performance)).toBe(3);
    expect(
      weeklyAggregate(restored.data.performance, "2026-09-03"),
    ).toMatchObject({ plannedMinutes: 180, completedMinutes: 180, percentage: 100 });
  });

  it("28. keeps custom section schedules intact and still firing on the right days", () => {
    const restored = roundTrip(
      source({
        sections: [section({ schedule: { type: "weekly", days: [1, 3, 5] } })],
        tasks: [task({ id: "t9", section: "custom", customSectionId: "s1" })],
      }),
    );
    const [sec] = restored.data.sections;
    const [t] = restored.data.tasks;
    // Monday, Wednesday, Friday only.
    expect(scheduleOccursOn(sec.schedule, new Date(2026, 8, 7))).toBe(true); // Mon
    expect(scheduleOccursOn(sec.schedule, new Date(2026, 8, 8))).toBe(false); // Tue
    expect(taskOccursOn(t, "2026-09-09", restored.data.sections)).toBe(true); // Wed
    expect(taskOccursOn(t, "2026-09-10", restored.data.sections)).toBe(false); // Thu
  });

  it("28b. preserves monthly-date, last-day and weekday-occurrence schedules", () => {
    const schedules: Schedule[] = [
      { type: "monthly-date", dayOfMonth: 1 },
      { type: "monthly-date", dayOfMonth: "last" },
      { type: "monthly-weekday", occurrence: "first", weekday: 1 },
    ];
    const restored = roundTrip(
      source({
        sections: schedules.map((s, i) => section({ id: `s${i}`, schedule: s })),
      }),
    );
    expect(restored.data.sections.map((s) => s.schedule)).toEqual(schedules);

    const [first, last, firstMonday] = restored.data.sections;
    expect(scheduleOccursOn(first.schedule, new Date(2026, 9, 1))).toBe(true); // 1 Oct
    expect(scheduleOccursOn(first.schedule, new Date(2026, 9, 2))).toBe(false);
    expect(scheduleOccursOn(last.schedule, new Date(2026, 9, 31))).toBe(true); // 31 Oct
    expect(scheduleOccursOn(last.schedule, new Date(2026, 10, 30))).toBe(true); // 30 Nov
    expect(scheduleOccursOn(firstMonday.schedule, new Date(2026, 9, 5))).toBe(true); // Mon 5 Oct
    expect(scheduleOccursOn(firstMonday.schedule, new Date(2026, 9, 12))).toBe(false);
  });

  it("29. keeps current task state (status, completion, next action) intact", () => {
    const restored = roundTrip(
      source({
        tasks: [
          task({ id: "a", status: "active" }),
          task({
            id: "b",
            status: "completed",
            remainingMinutes: 0,
            completedAt: "2026-09-12T18:00:00.000Z",
          }),
          task({
            id: "c",
            status: "accomplished",
            accomplishedAt: "2026-09-11T18:00:00.000Z",
            nextAction: "Archive the repo",
            description: "A real description",
          }),
        ],
      }),
    );
    expect(restored.data.tasks.map((t) => t.status)).toEqual([
      "active",
      "completed",
      "accomplished",
    ]);
    const c = restored.data.tasks[2];
    expect(c.nextAction).toBe("Archive the repo");
    expect(c.description).toBe("A real description");
    expect(restored.data.tasks[1].completedAt).toBe("2026-09-12T18:00:00.000Z");
  });

  it("30. keeps Hobby & Notes relationships correct", () => {
    const restored = roundTrip(
      source({
        hobbies: [hobby(), hobby({ id: "h2", name: "Reading", accent: "sand" })],
        generalNotes: [generalNote({ id: "n3", title: "A stray thought" })],
        hobbyNotes: [
          hobbyNote({ id: "n1", hobbyId: "h1" }),
          hobbyNote({ id: "n2", hobbyId: "h2", title: "Book list" }),
        ],
      }),
    );
    const hobbyIds = new Set(restored.data.hobbies.map((h) => h.id));
    expect(restored.data.hobbyNotes).toHaveLength(2);
    for (const n of restored.data.hobbyNotes) expect(hobbyIds.has(n.hobbyId)).toBe(true);
    // The stray thought stays general — it never acquires a hobby.
    expect(restored.data.generalNotes.map((n) => n.id)).toEqual(["n3"]);
  });
});

/* ------------------------------------------------------------------ */
/* 16–20. Parsing, rejection and migration                             */
/* ------------------------------------------------------------------ */

describe("parse and validate", () => {
  it("16. accepts a valid backup", () => {
    const text = serializeBackup(
      buildBackup(source({ tasks: [task()], logs: [log()] }), new Date("2026-09-13T12:00:00.000Z")),
    );
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.tasks).toHaveLength(1);
    expect(parsed.summary.counts).toMatchObject({ tasks: 1, logs: 1 });
    expect(parsed.summary.bytes).toBeGreaterThan(0);
  });

  it("17. rejects invalid JSON without throwing", () => {
    const parsed = parseBackup("{not json at all");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/isn't valid JSON/i);
  });

  it("18. rejects valid JSON that isn't a Momentum backup", () => {
    const parsed = parseBackup(JSON.stringify({ hello: "world", items: [1, 2, 3] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/isn't a Momentum backup/i);
  });

  it("19. rejects a backup from a newer Momentum than this build", () => {
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 5, data: {} }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/newer version of Momentum/i);
  });

  it("20. migrates an older, unversioned backup up to the current format", () => {
    // A v0 export: no `version`, no `settings`, and none of the newer tables.
    const legacy = {
      format: BACKUP_FORMAT,
      exportedAt: "2026-08-01T10:00:00.000Z",
      data: { tasks: [task()], logs: [log()] },
    };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.version).toBe(BACKUP_VERSION);
    expect(parsed.backup.data.tasks).toHaveLength(1);
    expect(parsed.backup.data.hobbies).toEqual([]);
    expect(parsed.backup.data.generalNotes).toEqual([]);
    expect(parsed.backup.data.hobbyNotes).toEqual([]);
    expect(parsed.backup.data.settings).toEqual({ meta: {}, theme: null });
    expect(parsed.summary.repairs.join(" ")).toMatch(/unversioned/i);
  });

  it("20b. splits a legacy single `notes` list into general and hobby notes", () => {
    // An older export carried one flat `notes` array. Restoring must route each
    // note by whether it had a hobby, keeping ids and content — no duplication.
    const legacy = {
      format: BACKUP_FORMAT,
      version: 0,
      data: {
        hobbies: [hobby({ id: "h1" })],
        notes: [
          { id: "n1", title: "Filed", content: "Filed under a hobby", hobbyId: "h1", createdAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-06T10:00:00.000Z" },
          { id: "n2", title: "Scratch", content: "A loose thought", createdAt: "2026-09-07T10:00:00.000Z", updatedAt: "2026-09-08T10:00:00.000Z" },
        ],
      },
    };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.hobbyNotes.map((n) => n.id)).toEqual(["n1"]);
    expect(parsed.backup.data.hobbyNotes[0].hobbyId).toBe("h1");
    expect(parsed.backup.data.generalNotes.map((n) => n.id)).toEqual(["n2"]);
    expect(parsed.backup.data.generalNotes[0].content).toBe("A loose thought");
    // Nothing is duplicated across the two lists.
    expect(parsed.backup.data.hobbyNotes.length + parsed.backup.data.generalNotes.length).toBe(2);
    expect(parsed.summary.repairs.join(" ")).toMatch(/separated general notes/i);
  });

  it("rejects a structurally damaged backup instead of importing part of it", () => {
    const damaged = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      data: {
        tasks: [task(), { title: "no id here" }],
        logs: [log()],
        sections: [],          performance: [],
          hobbies: [],
          generalNotes: [],
          hobbyNotes: [],
          settings: { meta: {}, theme: null },
      },
    };
    const parsed = parseBackup(JSON.stringify(damaged));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/task #2 has no id/i);
  });

  it.each([
    ["a task without a title", { tasks: [{ id: "x" }] }, /has no title/i],
    ["a task with an unknown section", { tasks: [{ id: "x", title: "T", section: "nope" }] }, /unknown section/i],
    ["a log with a bad date", { logs: [{ id: "l", taskId: "t", minutes: 5, date: "10/09/2026" }] }, /invalid date/i],
    ["a log with negative minutes", { logs: [{ id: "l", taskId: "t", minutes: -5, date: "2026-09-10" }] }, /invalid minutes/i],
    ["a performance row with no date", { performance: [{ plannedMinutes: 1, completedMinutes: 1 }] }, /invalid date/i],
    ["a section with a bad schedule", { sections: [{ id: "s", name: "N", schedule: { type: "hourly" } }] }, /unknown type/i],
    ["a hobby with an unknown accent", { hobbies: [{ id: "h", name: "H", accent: "chartreuse" }] }, /invalid accent/i],
    ["a list that isn't a list", { tasks: {} }, /not an array/i],
  ])("rejects %s", (_label, data, pattern) => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: { settings: { meta: {}, theme: null }, ...data },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(pattern);
  });

  it("rejects a backup whose data section is missing", () => {
    const parsed = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/missing its data/i);
  });
});

/* ------------------------------------------------------------------ */
/* 21–23. Repair without data loss                                     */
/* ------------------------------------------------------------------ */

describe("relational repair", () => {
  it("22. dedupes duplicate ids so a write can never fail on a repeated key", () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: {
          tasks: [task({ title: "First" }), task({ title: "Second" })],
          logs: [log({ minutes: 10 }), log({ minutes: 30 })],
          sections: [section({ name: "A" }), section({ name: "B" })],
          performance: [perf({ percentage: 10 }), perf({ percentage: 90 })],
          hobbies: [hobby({ name: "A" }), hobby({ name: "B" })],
          generalNotes: [generalNote({ title: "A" }), generalNote({ title: "B" })],
          hobbyNotes: [hobbyNote({ title: "A" }), hobbyNote({ title: "B" })],
          settings: { meta: {}, theme: null },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const d = parsed.backup.data;
    expect(d.tasks).toHaveLength(1);
    expect(d.logs).toHaveLength(1);
    expect(d.sections).toHaveLength(1);
    expect(d.performance).toHaveLength(1);
    expect(d.hobbies).toHaveLength(1);
    expect(d.generalNotes).toHaveLength(1);
    expect(d.hobbyNotes).toHaveLength(1);
    // Last one wins — the later row is the more recent state.
    expect(d.tasks[0].title).toBe("Second");
    expect(d.performance[0].percentage).toBe(90);
    expect(parsed.summary.repairs.length).toBeGreaterThan(0);
  });

  it("23. drops orphaned time logs and reports it", () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: {
          tasks: [task({ id: "t1" })],
          logs: [log({ id: "keep", taskId: "t1" }), log({ id: "orphan", taskId: "gone" })],
          settings: { meta: {}, theme: null },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.logs.map((l) => l.id)).toEqual(["keep"]);
    expect(parsed.summary.repairs.join(" ")).toMatch(/task no longer exists/i);
  });

  it("23b. moves a hobby note whose hobby is missing to General Notes rather than deleting it", () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: {
          hobbyNotes: [hobbyNote({ id: "n1", hobbyId: "missing" })],
          generalNotes: [],
          settings: { meta: {}, theme: null },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.hobbyNotes).toHaveLength(0);
    expect(parsed.backup.data.generalNotes).toHaveLength(1);
    expect(parsed.backup.data.generalNotes[0].id).toBe("n1");
    expect(parsed.summary.repairs.join(" ")).toMatch(/missing hobby/i);
  });

  it("23c. returns custom tasks with an unresolvable section to Reminder", () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: {
          tasks: [
            task({ id: "ok", section: "custom", customSectionId: "s1" }),
            task({ id: "dangling", section: "custom", customSectionId: "gone" }),
            task({ id: "empty", section: "custom" }),
          ],
          sections: [section({ id: "s1" })],
          settings: { meta: {}, theme: null },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const byId = Object.fromEntries(parsed.backup.data.tasks.map((t) => [t.id, t]));
    expect(byId.ok.section).toBe("custom");
    expect(byId.dangling.section).toBe("remainder");
    expect(byId.dangling.customSectionId).toBeUndefined();
    expect(byId.empty.section).toBe("remainder");
    expect(parsed.summary.repairs.join(" ")).toMatch(/Moved custom tasks back to Deadlines/i);
  });

  it("never reports repairs for a healthy backup", () => {
    const parsed = parseBackup(
      serializeBackup(
        buildBackup(
          source({
            tasks: [task({ id: "t1" }), task({ id: "t9", section: "custom", customSectionId: "s1" })],
            logs: [log({ taskId: "t1" })],
            sections: [section({ id: "s1" })],
            hobbies: [hobby()],
            generalNotes: [generalNote({ id: "n2" })],
            hobbyNotes: [hobbyNote({ hobbyId: "h1" })],
          }),
        ),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.summary.repairs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Settings round trip                                                 */
/* ------------------------------------------------------------------ */

describe("settings", () => {
  it("carries notification settings, profile name, accent and theme", () => {
    const settings = {
      enabled: true,
      cooldownMinutes: 30,
      taskReminders: true,
      specialTaskReminders: false,
      overdueReminders: true,
      quietHoursEnabled: true,
      quietStart: "23:00",
      quietEnd: "06:30",
      morningHour: 9,
      snoozeMinutes: 30,
      completionCooldownMinutes: 30,
    };
    const restored = roundTrip(
      source({
        meta: [
          { key: "notificationSettings", value: settings },
          { key: "profileName", value: "Aditi" },
          { key: "accentColor", value: "purple" },
          { key: "firstRunAt", value: "2026-01-15T00:00:00.000Z" },
        ],
        theme: "system",
      }),
    );
    expect(restored.data.settings.meta.notificationSettings).toEqual(settings);
    expect(restored.data.settings.meta.profileName).toBe("Aditi");
    expect(restored.data.settings.meta.accentColor).toBe("purple");
    expect(restored.data.settings.meta.firstRunAt).toBe("2026-01-15T00:00:00.000Z");
    expect(restored.data.settings.theme).toBe("system");
  });

  it("ignores an unrecognised theme instead of importing a broken one", () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        data: { settings: { meta: {}, theme: "neon" } },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.settings.theme).toBeNull();
  });
});
