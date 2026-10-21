"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Plus,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { useModalStack } from "@/lib/modal-stack";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildTaskInput,
  canContinue,
  defaultWizardState,
  durationMinutes,
  durationSummary,
  isRecurringKey,
  scheduleContextFor,
  sectionOptions,
  summaryLines,
  toLocalInput,
  wizardSteps,
  type SectionKey,
  type WizardState,
  type WizardStep,
} from "@/lib/task-wizard";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pass a task to edit; otherwise creates through the wizard. */
  task?: Task;
  defaultSection?: SectionKey;
}

export function TaskFormModal({ open, onClose, task, defaultSection = "daily" }: Props) {
  const isEdit = Boolean(task);
  const id = isEdit ? `modal:edit:${task!.id}` : "modal:create-task";
  useModalStack(id, isEdit ? "Edit task" : "Create task", onClose, open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? "Edit task" : "New task"}
      title={isEdit ? task?.title : undefined}
      className="sm:max-w-140"
      stackId={id}
    >
      {open &&
        (task ? (
          <EditForm key={task.id} task={task} onClose={onClose} />
        ) : (
          <CreateWizard key="create" defaultSection={defaultSection} onClose={onClose} />
        ))}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function StepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h3>
      {hint && <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Subtle progress: a dot row plus "2 of 6" — never the loudest thing here. */
function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200",
              i === index
                ? "w-4 bg-foreground/55"
                : i < index
                  ? "w-1.5 bg-foreground/28"
                  : "w-1.5 bg-foreground/12",
            )}
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {index + 1} of {total}
      </span>
    </div>
  );
}

/**
 * The step footer. It sticks to the bottom of the scroll area so the primary
 * action stays above the mobile keyboard instead of hiding behind it.
 */
function StepFooter({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">{left}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Create wizard                                                       */
/* ------------------------------------------------------------------ */

function CreateWizard({
  defaultSection,
  onClose,
}: {
  defaultSection: SectionKey;
  onClose: () => void;
}) {
  const sections = useStore((s) => s.sections);
  const addTask = useStore((s) => s.addTask);

  const [state, setState] = useState(() => defaultWizardState(defaultSection));
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);

  const steps = useMemo(() => wizardSteps(state), [state]);
  // Steps can shrink when the section changes (7 → 6): clamp instead of
  // remounting, so every value the user already typed survives.
  const position = Math.min(index, steps.length);
  const step: WizardStep | null = position < steps.length ? steps[position] : null;

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const goNext = () => setIndex(Math.min(position + 1, steps.length));
  const goBack = () => setIndex(Math.max(0, position - 1));
  const skip = () => goNext();

  const create = () => {
    addTask(buildTaskInput(state));
    setDone(true);
  };

  // Subtle confirmation rather than a modal that snaps shut.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 1100);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  if (done) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2.5 px-4 py-12 text-center"
      >
        <CheckCircle2 className="h-9 w-9 text-success" strokeWidth={1.75} />
        <p className="text-[15px] font-semibold text-foreground">Task added</p>
        <p className="text-xs text-muted-foreground">
          {state.sectionKey === "daily"
            ? "It's waiting in Daily."
            : state.sectionKey.startsWith("custom:")
              ? "It's waiting in its section."
              : state.sectionKey === "remainder"
                ? "It's waiting in Deadlines."
                : "It's waiting in your Bucket list."}
        </p>
      </div>
    );
  }

  if (step === null) {
    // Final review — a compact summary, never the whole form again.
    const lines = summaryLines(state, sections);
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="space-y-0"
      >
        <Progress index={steps.length - 1} total={steps.length} />
        <div className="space-y-3">
          <p className="text-[17px] font-semibold leading-snug tracking-tight text-foreground">
            {state.title.trim()}
          </p>
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/60 px-3.5">
            {lines.map((line) => (
              <div
                key={line.label}
                className="flex items-start justify-between gap-4 py-2 text-[13px]"
              >
                <span className="shrink-0 text-muted-foreground">{line.label}</span>
                <span className="min-w-0 break-words text-right font-medium text-foreground">
                  {line.value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <StepFooter
          left={
            <Button variant="ghost" type="button" onClick={goBack}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          }
          right={
            <Button variant="primary" type="submit">
              <Plus className="h-4 w-4" /> Create task
            </Button>
          }
        />
      </form>
    );
  }

  const optional = step !== "what" && step !== "where";
  const ready = canContinue(state, step);

  const footer = (
    <StepFooter
      left={
        <>
          {position > 0 && (
            <Button variant="ghost" type="button" onClick={goBack}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
          {optional && step !== "time" && (
            <Button variant="ghost" type="button" onClick={skip}>
              Skip
            </Button>
          )}
        </>
      }
      right={
        <Button variant="primary" type="submit" disabled={!ready}>
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      }
    />
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) goNext();
      }}
      className="space-y-0"
    >
      <Progress index={position} total={steps.length} />

      {step === "what" && (
        <div className="space-y-4">
          <StepHeading
            title="What do you want to accomplish?"
            hint="One clear thing Momentum can help you with."
          />
          <Input
            id="tw-title"
            autoFocus
            value={state.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Practice Binary Search"
            maxLength={120}
            aria-label="Task name"
            className="h-12 text-base"
          />
          <p className="text-xs text-muted-foreground">
            e.g. Study Machine Learning · Submit assignment
          </p>
        </div>
      )}

      {step === "where" && (
        <div className="space-y-3">
          <StepHeading
            title="Where should this live?"
            hint="Momentum only shows lists that exist in your workspace."
          />
          <div role="radiogroup" aria-label="Section" className="space-y-2">
            {sectionOptions(sections).map((option) => {
              const selected = option.key === state.sectionKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => patch({ sectionKey: option.key })}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    selected
                      ? "border-primary/55 bg-primary/[0.06]"
                      : "border-border bg-card/60 hover:bg-muted/40",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors",
                      selected ? "border-primary bg-primary" : "border-foreground/30",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-foreground">
                      {option.icon ? `${option.icon} ` : ""}
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "when" && (
        <div className="space-y-4">
          <StepHeading
            title="When?"
            hint={
              state.sectionKey === "remainder"
                ? "Optional — reminders count down as this date approaches. Without one, it gets a weekly check-in."
                : "Optional — give it a date and Momentum will count down as it approaches."
            }
          />
          <Field label="Due date" hint="optional" htmlFor="tw-due">
            <Input
              id="tw-due"
              type="date"
              value={state.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </Field>
        </div>
      )}

      {step === "time" && (
        <div className="space-y-4">
          <StepHeading
            title="How much time do you expect this to take?"
            hint="Optional — tasks without a duration are tracked by completion."
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Duration">
            {[
              { label: "15 min", hours: "", mins: "15" },
              { label: "30 min", hours: "", mins: "30" },
              { label: "1 hour", hours: "1", mins: "0" },
            ].map((chip) => {
              const selected = state.hours === chip.hours && state.mins === chip.mins;
              return (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ hours: chip.hours, mins: chip.mins })}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    selected
                      ? "border-primary/55 bg-primary/[0.06] text-foreground"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => patch({ hours: "", mins: "" })}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                durationMinutes(state) === null
                  ? "border-primary/55 bg-primary/[0.06] text-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
              )}
            >
              Skip
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={24}
              value={state.hours}
              placeholder="–"
              onChange={(e) => patch({ hours: e.target.value })}
              aria-label="Hours"
              className="min-w-0 flex-1 px-2 text-center font-mono tnum"
            />
            <span className="font-mono text-[11px] text-muted-foreground">hr</span>
            <Input
              type="number"
              min={0}
              max={59}
              step={5}
              value={state.mins}
              placeholder="–"
              onChange={(e) => patch({ mins: e.target.value })}
              aria-label="Minutes"
              className="min-w-0 flex-1 px-2 text-center font-mono tnum"
            />
            <span className="font-mono text-[11px] text-muted-foreground">min</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {durationMinutes(state) === null
              ? "No duration — fine for deadlines and bucket-list work."
              : `${formatMinutes(durationMinutes(state)!)} planned for this task.`}
          </p>
        </div>
      )}

      {step === "details" && (
        <div className="space-y-4">
          <StepHeading
            title="Anything else?"
            hint="Optional — a note only if it helps."
          />
          <Field label="Description" hint="optional" htmlFor="tw-desc">
            <Textarea
              id="tw-desc"
              value={state.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="What does this involve? Topics, resources, steps…"
              rows={3}
            />
          </Field>
        </div>
      )}

      {footer}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Edit — progressive sections, no wizard                              */
/* ------------------------------------------------------------------ */

interface EditDraft {
  title: string;
  sectionKey: SectionKey;
  dueDate: string;
  hours: string;
  mins: string;
  nextAction: string;
  reminderOn: boolean;
  reminderCustom: string;
  reminderTime: string;
  description: string;
}

function draftFromTask(task: Task, dailyTime: string): EditDraft {
  const planned = typeof task.estimatedMinutes === "number" && task.estimatedMinutes > 0
    ? task.estimatedMinutes
    : null;
  const sectionKey: SectionKey =
    task.section === "custom" && task.customSectionId
      ? `custom:${task.customSectionId}`
      : (task.section as SectionKey);
  const oneShot = Boolean(task.remindAt);
  return {
    title: task.title,
    sectionKey,
    dueDate: task.dueDate ?? "",
    hours: planned !== null ? String(Math.floor(planned / 60)) : "",
    mins: planned !== null ? String(planned % 60) : "",
    nextAction: task.nextAction ?? "",
    reminderOn: oneShot || Boolean(task.notifyTime),
    reminderCustom: oneShot ? toLocalInput(task.remindAt) : "",
    reminderTime: task.notifyTime ?? dailyTime,
    description: task.description ?? "",
  };
}

/** Friendly "Oct 3, 7:00 PM" for a datetime-local value. */
function formatMoment(local: string): string {
  const d = new Date(local);
  if (!Number.isFinite(d.getTime())) return "On";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EditForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const sections = useStore((s) => s.sections);
  const updateTask = useStore((s) => s.updateTask);
  const dailyTime = useStore((s) => s.notificationSettings.dailyReminderTime);

  // The snapshot the save action diffs against — computed once at mount, so
  // opening one section and saving commits nothing for the untouched ones.
  const [initial] = useState(() => draftFromTask(task, dailyTime));
  const [draft, setDraft] = useState<EditDraft>(initial);
  const [openSection, setOpenSection] = useState<string | null>("basics");

  const patch = (p: Partial<EditDraft>) => setDraft((d) => ({ ...d, ...p }));
  const recurring = isRecurringKey(draft.sectionKey);
  const scheduleContext = scheduleContextFor(draft.sectionKey, sections);

  const rows: { id: string; label: string; sub: string }[] = [
    { id: "basics", label: "Basics", sub: draft.title || "Title" },
    {
      id: "schedule",
      label: "Schedule",
      sub: scheduleContext ?? (draft.dueDate ? `Due ${draft.dueDate}` : "No due date"),
    },
    { id: "time", label: "Time", sub: durationSummary(draft) },
    {
      id: "reminder",
      label: "Reminder",
      sub: draft.reminderOn
        ? recurring
          ? `Daily at ${draft.reminderTime}`
          : draft.reminderCustom
            ? formatMoment(draft.reminderCustom)
            : "On"
        : "Automatic",
    },
    { id: "details", label: "Details", sub: draft.description ? "Has notes" : "No notes" },
  ];

  const save = () => {
    const before = initial;
    const nextMinutes = durationMinutes(draft);
    const beforeMinutes = durationMinutes(before);
    const nextSection: Task["section"] = draft.sectionKey.startsWith("custom:")
      ? "custom"
      : (draft.sectionKey as "daily" | "remainder" | "occasional");
    const beforeSection: Task["section"] = before.sectionKey.startsWith("custom:")
      ? "custom"
      : (before.sectionKey as "daily" | "remainder" | "occasional");

    const changes: Partial<Task> = {};
    if (draft.title.trim() && draft.title.trim() !== before.title.trim()) {
      changes.title = draft.title.trim();
    }
    if (nextSection !== beforeSection || draft.sectionKey !== before.sectionKey) {
      changes.section = nextSection;
      changes.customSectionId = draft.sectionKey.startsWith("custom:")
        ? draft.sectionKey.slice("custom:".length)
        : undefined;
    }
    if (nextMinutes !== beforeMinutes) changes.estimatedMinutes = nextMinutes;
    if (draft.dueDate !== before.dueDate) changes.dueDate = draft.dueDate || undefined;
    if (draft.nextAction.trim() !== before.nextAction.trim()) {
      changes.nextAction = draft.nextAction.trim() || undefined;
    }
    if (draft.description.trim() !== before.description.trim()) {
      changes.description = draft.description.trim() || undefined;
    }

    const nextNotify = draft.reminderOn && recurring ? draft.reminderTime.trim() || undefined : undefined;
    const beforeNotify = before.reminderOn && isRecurringKey(before.sectionKey)
      ? before.reminderTime.trim() || undefined
      : undefined;
    if (nextNotify !== beforeNotify) changes.notifyTime = nextNotify;

    const nextAt =
      draft.reminderOn && !recurring && draft.reminderCustom
        ? new Date(draft.reminderCustom).toISOString()
        : undefined;
    const beforeAt =
      before.reminderOn && !isRecurringKey(before.sectionKey) && before.reminderCustom
        ? new Date(before.reminderCustom).toISOString()
        : undefined;
    if (nextAt !== beforeAt) changes.remindAt = nextAt;

    if (Object.keys(changes).length > 0) updateTask(task.id, changes);
    onClose();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-0"
    >
      <div className="space-y-2">
        {rows.map((row) => {
          const expanded = openSection === row.id;
          return (
            <div key={row.id} className="rounded-xl border border-border bg-card/60">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenSection(expanded ? null : row.id)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 rounded-xl"
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-foreground">
                    {row.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{row.sub}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                  strokeWidth={2}
                />
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-border/60 px-3.5 py-3.5">
                  {row.id === "basics" && (
                    <>
                      <Field label="Task name" htmlFor="te-title">
                        <Input
                          id="te-title"
                          autoFocus
                          value={draft.title}
                          onChange={(e) => patch({ title: e.target.value })}
                          maxLength={120}
                          aria-label="Task name"
                        />
                      </Field>
                      <Field label="Section" htmlFor="te-section">
                        <select
                          id="te-section"
                          value={draft.sectionKey}
                          onChange={(e) => patch({ sectionKey: e.target.value as SectionKey })}
                          className="h-9 w-full cursor-pointer rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60"
                        >
                          {sectionOptions(sections).map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.icon ? `${option.icon} ` : ""}
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Next action" hint="optional" htmlFor="te-next">
                        <Input
                          id="te-next"
                          value={draft.nextAction}
                          onChange={(e) => patch({ nextAction: e.target.value })}
                          placeholder="The concrete next step"
                          maxLength={160}
                        />
                      </Field>
                    </>
                  )}

                  {row.id === "schedule" && (
                    <>
                      {scheduleContext && (
                        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          {draft.sectionKey.startsWith("custom:")
                            ? `Repeats with this section: ${scheduleContext}`
                            : "Daily work comes back every day."}
                        </p>
                      )}
                      <Field label="Due date" hint="optional" htmlFor="te-due">
                        <Input
                          id="te-due"
                          type="date"
                          value={draft.dueDate}
                          onChange={(e) => patch({ dueDate: e.target.value })}
                        />
                      </Field>
                    </>
                  )}

                  {row.id === "time" && (
                    <>
                      <Field label="Estimated time" hint="optional">
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={24}
                            value={draft.hours}
                            placeholder="–"
                            onChange={(e) => patch({ hours: e.target.value })}
                            aria-label="Hours"
                            className="min-w-0 flex-1 px-2 text-center font-mono tnum"
                          />
                          <span className="font-mono text-[11px] text-muted-foreground">hr</span>
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            step={5}
                            value={draft.mins}
                            placeholder="–"
                            onChange={(e) => patch({ mins: e.target.value })}
                            aria-label="Minutes"
                            className="min-w-0 flex-1 px-2 text-center font-mono tnum"
                          />
                          <span className="font-mono text-[11px] text-muted-foreground">min</span>
                        </div>
                      </Field>
                      <p className="text-xs text-muted-foreground">
                        Empty means completion-based — no duration, no time tracking.
                      </p>
                    </>
                  )}

                  {row.id === "reminder" && (
                    <>
                      {/* Secondary, opt-in override. Ordinary reminders are
                          automatic — this only exists for the rare task where
                          the user wants an exact moment. */}
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {draft.reminderOn
                          ? "Momentum will use this exact time instead of the automatic reminder."
                          : "Momentum reminds you automatically based on this task's type and schedule."}
                      </p>
                      <Segmented<"off" | "on">
                        className="w-48"
                        options={[
                          { value: "off", label: "Automatic" },
                          { value: "on", label: "Custom" },
                        ]}
                        value={draft.reminderOn ? "on" : "off"}
                        onChange={(v) => patch({ reminderOn: v === "on" })}
                      />
                      {draft.reminderOn && recurring && (
                        <Field label="Time" htmlFor="te-remind-time">
                          <Input
                            id="te-remind-time"
                            type="time"
                            value={draft.reminderTime}
                            onChange={(e) => patch({ reminderTime: e.target.value })}
                          />
                        </Field>
                      )}
                      {draft.reminderOn && !recurring && (
                        <Field label="Reminder moment" htmlFor="te-remind-at">
                          <Input
                            id="te-remind-at"
                            type="datetime-local"
                            value={draft.reminderCustom}
                            onChange={(e) => patch({ reminderCustom: e.target.value })}
                          />
                        </Field>
                      )}
                    </>
                  )}

                  {row.id === "details" && (
                    <Field label="Description" hint="optional" htmlFor="te-desc">
                      <Textarea
                        id="te-desc"
                        value={draft.description}
                        onChange={(e) => patch({ description: e.target.value })}
                        rows={3}
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <StepFooter
        left={
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
        }
        right={
          <Button variant="primary" type="submit">
            <CheckCircle2 className="h-4 w-4" /> Save changes
          </Button>
        }
      />
    </form>
  );
}
