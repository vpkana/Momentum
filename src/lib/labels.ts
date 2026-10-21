import type { CustomSection, Schedule, Task } from "./types";
import { WEEKDAYS_MON_FIRST } from "./date";

export function sectionLabel(task: Task, sections: CustomSection[]): {
  title: string;
  icon?: string;
} {
  if (task.section === "daily") return { title: "Daily" };
  if (task.section === "remainder") return { title: "Deadline" };
  if (task.section === "occasional") return { title: "Bucket list" };
  const s = sections.find((x) => x.id === task.customSectionId);
  return { title: s?.name ?? "Custom", icon: s?.icon };
}

export function scheduleSummary(schedule: Schedule): string {
  switch (schedule.type) {
    case "daily":
      return "Every day";
    case "weekly":
    case "custom": {
      const days = schedule.days ?? [];
      if (days.length === 0) return schedule.type === "weekly" ? "Weekly" : "Custom days";
      if (days.length === 7) return "Every day";
      const map = new Map<number, string>();
      WEEKDAYS_MON_FIRST.forEach((d, i) => map.set((i + 1) % 7, d));
      const labels = [...days]
        .sort((a, b) => (a + 6) % 7 - ((b + 6) % 7))
        .map((d) => map.get(d) ?? "");
      if (schedule.type === "weekly") {
        return `Every week on ${labels.join(" · ")}`;
      }
      return labels.join(" · ");
    }
    case "monthly-date":
      return schedule.dayOfMonth === "last"
        ? "Every month on the last day"
        : schedule.dayOfMonth ? `Every month on the ${schedule.dayOfMonth}${ordinal(schedule.dayOfMonth)}` : "Monthly date";
    case "monthly-weekday": {
      const occurrence = schedule.occurrence ?? "first";
      const weekday = WEEKDAYS_MON_FIRST[((schedule.weekday ?? 1) + 6) % 7] ?? "weekday";
      return `Every ${occurrence} ${weekday}`;
    }
  }
}

function ordinal(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) return "th";
  return value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
}

export function timeRange(schedule?: Schedule): string | null {
  if (!schedule?.startTime) return null;
  return schedule.endTime
    ? `${schedule.startTime}–${schedule.endTime}`
    : schedule.startTime;
}
