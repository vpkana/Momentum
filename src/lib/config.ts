import { PROFILE } from "./types";

/**
 * Recovery-day rules. Centralized so behavior can be tuned without touching
 * the streak/analytics logic.
 *
 * A day with planned work that fell below the performance threshold can be
 * marked as a recovery day — keeping the streak intact — when the user earned
 * it through recent consistency. Recovery days are neutral in analytics:
 * they neither extend the streak nor count as productive time.
 */
export const RECOVERY_RULES = {
  /** How many qualifying days must precede a missed day to earn a recovery. */
  minimumConsistencyDays: 5,
  /** Qualifying day = planned work at/above this threshold. */
  minimumPerformanceThreshold: PROFILE.streakThreshold,
  /** Cap on recovery days per calendar month. */
  maximumRecoveryDaysPerMonth: 2,
  /** Look back this many calendar days when counting the qualifying run. */
  lookbackWindowDays: 7,
} as const;

/**
 * Notification defaults. Values here back the settings UI; the scheduler
 * reads the persisted settings and falls back to these.
 *
 * Delivery is deliberately explicit: every reminder fires at a concrete local
 * time (see lib/notifications/planner.ts). The legacy scoring/quiet-hour
 * fields remain only so old stored settings and backups stay valid.
 */
export const NOTIFICATION_DEFAULTS = {
  /** Master switch for all in-app task reminders. */
  enabled: true,
  /** Default time for daily/custom tasks that carry no time of their own. */
  dailyReminderTime: "09:00",
  /** One calm later check-in when the day's plan is still open. */
  followUpTime: "17:00",
  /** Weekend day (0 = Sunday … 6 = Saturday) for undated deadline work. */
  remainderWeekday: 6,
  /** Local "HH:MM" — when that weekly reminder fires. */
  remainderTime: "10:00",
  /** Days of the month for bucket-list items with no date. */
  occasionalDays: [1, 15] as number[],
  /** Local "HH:MM" — when that monthly reminder fires. */
  occasionalTime: "10:00",
  /** Reminders for scheduled daily/custom tasks. */
  taskReminders: true,
  /** Reminders for due-today special tasks. */
  specialTaskReminders: true,
  /** Daily nudge for overdue deadline tasks. */
  overdueReminders: true,
  /** Minutes a snooze pushes a notification back by. */
  snoozeMinutes: 30,
  /** Quiet hours of 22:30 → 07:00 — ordinary reminders never land inside. */
  quietHoursEnabled: true,
  quietStart: "22:30",
  quietEnd: "07:00",
  /* ---- Legacy fields (stored values remain readable) ---- */
  cooldownMinutes: 60,
  morningHour: 9,
  completionCooldownMinutes: 30,
} as const;

export const COOLDOWN_OPTIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
] as const;

export const QUIET_HOUR_STEP = 15; // minutes — time inputs snap to 15m

export const WEEKEND_DAYS = [
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
] as const;

export const NOTIFICATION_TYPES = [
  "task_start",
  "task_reminder",
  "overdue",
  "special_task",
  "next_task",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = [
  "scheduled",
  "delivered",
  "dismissed",
  "snoozed",
  "cancelled",
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
