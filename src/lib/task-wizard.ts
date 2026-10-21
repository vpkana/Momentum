/**
 * The task-creation wizard — pure logic, no React, no DOM.
 *
 * The wizard is a short conversation ("What? Where? When? How much time?"),
 * not a database form. This module owns the rules that keep it short:
 *
 * 1. **Steps adapt to the task type.** Daily and custom-section work inherits
 *    its schedule from the section, so the "When?" step disappears entirely.
 *    Only one-off work (Deadlines / Bucket list) is ever asked for a date.
 * 2. **Optional stays optional.** Every value except the title has a default of
 *    "nothing", and skipped values are omitted from the input rather than
 *    written as empty rows.
 * 3. **No configuration the user should not have to make.** Creation never asks
 *    about next action, priority or reminders. Reminder behaviour is decided
 *    automatically from the task type and section (see the notification
 *    planner); an explicit reminder is an optional extra on the task itself.
 *
 * Because everything here is pure, the component stays thin and every rule is
 * covered by task-wizard.test.ts.
 */

import { normalizeDuration } from "./duration";
import { formatMinutes } from "./format";
import type { CustomSection } from "./types";
import type { TaskInput } from "./store";
import { scheduleSummary } from "./labels";

export type SectionKey = "daily" | "remainder" | "occasional" | `custom:${string}`;

/** Creation steps. "when" is only inserted for one-off work. */
export type WizardStep = "what" | "where" | "when" | "time" | "details";

export interface WizardState {
  title: string;
  sectionKey: SectionKey;
  /** "YYYY-MM-DD" for one-off work, or "" when the user skipped it. */
  dueDate: string;
  /** Duration inputs, kept as strings so "empty" is representable. */
  hours: string;
  mins: string;
  description: string;
}

/* ------------------------------------------------------------------ */
/* Section helpers                                                     */
/* ------------------------------------------------------------------ */

export function sectionKindOf(key: SectionKey): TaskInput["section"] {
  if (key.startsWith("custom:")) return "custom";
  return key as TaskInput["section"];
}

export function customSectionIdOf(key: SectionKey): string | undefined {
  return key.startsWith("custom:") ? key.slice("custom:".length) : undefined;
}

/** Recurring work (daily + custom sections) — its schedule comes from the section. */
export function isRecurringKey(key: SectionKey): boolean {
  return key === "daily" || key.startsWith("custom:");
}

export interface SectionOption {
  key: SectionKey;
  label: string;
  /** The brief explanation the picker shows under the choice. */
  hint: string;
  icon?: string;
}

/**
 * The choices offered in the "Where?" step. Built-in lists are always present;
 * custom sections are only offered when they actually exist.
 */
export function sectionOptions(sections: CustomSection[]): SectionOption[] {
  const options: SectionOption[] = [
    { key: "daily", label: "Daily", hint: "Every day — habits and routines." },
    {
      key: "remainder",
      label: "Deadlines",
      hint: "One-off work with a date — reminders increase as the deadline nears.",
    },
    {
      key: "occasional",
      label: "Bucket list",
      hint: "Someday work — a gentle check-in twice a month if it has no date.",
    },
  ];
  for (const s of sections) {
    options.push({
      key: `custom:${s.id}`,
      label: s.name,
      icon: s.icon,
      hint: `Runs on this section's schedule: ${scheduleSummary(s.schedule)}.`,
    });
  }
  return options;
}

/** The schedule context shown when a custom section is selected, if any. */
export function scheduleContextFor(
  key: SectionKey,
  sections: CustomSection[],
): string | null {
  if (key === "daily") return "Every day";
  const id = customSectionIdOf(key);
  if (!id) return null;
  const section = sections.find((s) => s.id === id);
  return section ? scheduleSummary(section.schedule) : null;
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/**
 * The wizard's steps for the current draft — the smart-reduction rule.
 *
 * Daily tasks are every day and custom sections already own their recurrence,
 * so those drafts never see a "When?" question. One-off work is asked for a
 * date because nothing else defines one. Everything after "Where?" is optional
 * and skippable.
 */
export function wizardSteps(state: WizardState): WizardStep[] {
  const steps: WizardStep[] = ["what", "where"];
  if (state.sectionKey === "remainder" || state.sectionKey === "occasional") {
    steps.push("when");
  }
  steps.push("time", "details");
  return steps;
}

export function canContinue(state: WizardState, step: WizardStep): boolean {
  if (step === "what") return state.title.trim().length > 0;
  return true;
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export function defaultWizardState(sectionKey: SectionKey = "daily"): WizardState {
  return {
    title: "",
    sectionKey,
    dueDate: "",
    hours: "",
    mins: "",
    description: "",
  };
}

/* ------------------------------------------------------------------ */
/* Duration                                                            */
/* ------------------------------------------------------------------ */

/** Planned minutes, or null for a durationless task. Never a fake 0. */
export function durationMinutes(state: Pick<WizardState, "hours" | "mins">): number | null {
  const h = Number(state.hours) || 0;
  const m = Number(state.mins) || 0;
  return normalizeDuration(h * 60 + m);
}

export function durationSummary(state: Pick<WizardState, "hours" | "mins">): string {
  const minutes = durationMinutes(state);
  return minutes === null ? "No duration" : formatMinutes(minutes);
}

/** "YYYY-MM-DDTHH:mm" (local, what `datetime-local` inputs want) from an ISO string. */
export function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Summary + submission                                                */
/* ------------------------------------------------------------------ */

export interface SummaryLine {
  label: string;
  value: string;
}

/** The compact review: one line per fact the user actually filled in. */
export function summaryLines(state: WizardState, sections: CustomSection[]): SummaryLine[] {
  const lines: SummaryLine[] = [];

  const sectionLabel = state.sectionKey.startsWith("custom:")
    ? sections.find((s) => s.id === customSectionIdOf(state.sectionKey))?.name ?? "Custom"
    : state.sectionKey === "remainder"
      ? "Deadlines"
      : state.sectionKey === "occasional"
        ? "Bucket list"
        : "Daily";
  lines.push({ label: "Section", value: sectionLabel });

  // Only custom sections need their schedule spelled out — "Daily" already
  // answers itself, and repeating it would be noise.
  if (state.sectionKey.startsWith("custom:")) {
    const schedule = scheduleContextFor(state.sectionKey, sections);
    if (schedule) lines.push({ label: "Schedule", value: schedule });
  }
  if (state.dueDate) lines.push({ label: "Due", value: state.dueDate });

  lines.push({ label: "Time", value: durationSummary(state) });
  if (state.description.trim()) {
    lines.push({ label: "Notes", value: state.description.trim() });
  }
  return lines;
}

/**
 * The draft → the store's `TaskInput`.
 *
 * Optional values that were skipped are omitted entirely (undefined), never
 * written as empty strings, so the task model stays clean. Reminders are not
 * set here: the notification planner derives them from the task type and
 * section. An explicit reminder is added later, from the task itself.
 */
export function buildTaskInput(state: WizardState): TaskInput {
  const kind = sectionKindOf(state.sectionKey);
  const customSectionId = customSectionIdOf(state.sectionKey);

  return {
    title: state.title.trim(),
    section: kind,
    customSectionId: kind === "custom" ? customSectionId : undefined,
    estimatedMinutes: durationMinutes(state),
    description: state.description.trim() || undefined,
    dueDate: state.dueDate || undefined,
  };
}
