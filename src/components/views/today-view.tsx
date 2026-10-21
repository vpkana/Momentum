"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleCheck,
  Flame,
  Layers,
  ListChecks,
  Plus,
  Sparkles,
} from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { breakdownForDay } from "@/lib/schedule";
import { workloadForTasks, currentStreak, liveDayRec, type DayRec } from "@/lib/performance";
import { addDays, dateKey } from "@/lib/date";
import { greetingForHour, formatMinutes } from "@/lib/format";
import { scheduleSummary } from "@/lib/labels";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { ListShell, ListSkeleton, EmptyState } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";
import { SpecialTaskBanner } from "@/components/dashboard/special-task-banner";
import { RemindersStrip } from "@/components/dashboard/reminders-strip";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

function StreakInline({ streak }: { streak: number | null }) {
  return (
    <Link
      href="/profile"
      className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
      aria-label={`${streak ?? 0} day streak — view performance`}
    >
      <Flame className="h-3.5 w-3.5 shrink-0 text-signal" fill="currentColor" strokeWidth={0} />
      <span className="text-[12px]">
        <span className="tnum font-semibold text-foreground">{streak ?? "—"}</span> day streak
      </span>
    </Link>
  );
}

/**
 * The header answers one question before anything else: what is worth doing now?
 *
 * Deliberately not a card: date, greeting, a single progress line, then the
 * concrete next task. No ring, no stat row, no decoration.
 */
function TodayHero({
  now,
  profileName,
  streak,
  planned,
  remaining,
  untimedCount,
  timedCount,
  openTotal,
  doneTotal,
  upNext,
  onOpen,
  onToggle,
}: {
  now: Date;
  profileName: string;
  streak: number | null;
  planned: number;
  remaining: number;
  untimedCount: number;
  timedCount: number;
  openTotal: number;
  doneTotal: number;
  upNext: Task | null;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  const done = Math.max(0, planned - remaining);
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : null;
  const totalTasks = openTotal + doneTotal;
  const taskPct = totalTasks > 0 ? Math.round((doneTotal / totalTasks) * 100) : 0;
  // A day is either measured in minutes (every task is timed) or in tasks.
  // Mixing the two — a minute ratio beside an untimed to-do count — compares
  // incomparable things, so when untimed tasks exist we report tasks instead.
  const allTimed = timedCount > 0 && untimedCount === 0;
  const mixed = timedCount > 0 && untimedCount > 0;
  const shownPct = allTimed ? (pct ?? taskPct) : taskPct;
  const allDone = openTotal === 0 && doneTotal > 0;

  return (
    <section className="anim-fade-up mb-7">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {now.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h1 className="mt-1.5 text-[23px] font-semibold leading-tight tracking-tight text-foreground sm:text-[27px]">
        {greetingForHour(now.getHours())}
        <span className="text-muted-foreground">,</span> {profileName}
      </h1>

      {/* Simple progress: one line, one hairline bar. */}
      {totalTasks > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${shownPct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tnum text-muted-foreground">
            {allTimed
              ? `${formatMinutes(done)} / ${formatMinutes(planned)}`
              : `${doneTotal} of ${totalTasks} done`}
          </span>
        </div>
      )}

      {/*
       * One aligned line: the streak, then how many tasks are left. When the
       * day mixes timed and untimed work, the minute figure is spelled out as
       * timed work so it is never read as the whole remaining workload.
       */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <StreakInline streak={streak} />
        {openTotal > 0 && (
          <span className="font-mono text-[11.5px] tnum">
            {openTotal} to-do{openTotal === 1 ? "" : "s"} left
          </span>
        )}
        {mixed && remaining > 0 && (
          <span className="font-mono text-[11.5px] tnum">
            {formatMinutes(remaining)} timed left
          </span>
        )}
      </div>

      {/* Up next — the single most useful thing on this screen. */}
      {/* {openTotal > 0 && upNext && (
        <div className="mt-5 border-t border-border/70 pt-4">
          <p className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Up next
          </p>
          <p className="text-[16px] font-semibold tracking-tight text-foreground">
            {upNext.title}
          </p>
          {upNext.nextAction ? (
            <p className="mt-1 flex items-baseline gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                Next
              </span>
              <span className="min-w-0 break-words">{upNext.nextAction}</span>
            </p>
          ) : isTimedTask(upNext) ? (
            <p className="mt-1 font-mono text-[11.5px] tnum text-muted-foreground">
              {formatMinutes(remainingMinutesOf(upNext))} remaining
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onToggle(upNext)}
              aria-label={`Complete ${upNext.title}`}
            >
              Done
            </Button>
            {isTimedTask(upNext) && (
              <Button variant="ghost" size="sm" onClick={() => onOpen(upNext)}>
                Open
              </Button>
            )}
          </div>
        </div>
      )} */}

      {allDone && (
        <p className="mt-5 flex items-center gap-2 border-t border-border/70 pt-4 text-[13px] text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
          Everything planned for today is done.
        </p>
      )}
    </section>
  );
}

function GroupSection({
  title,
  sub,
  tasks,
  totalTasks,
  accent,
  onOpen,
  onToggle,
  onAdd,
}: {
  title: string;
  sub?: string;
  tasks: Task[];
  totalTasks: number;
  /** Optional accent hue for custom sections, so they read as distinct. */
  accent?: string;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onAdd: () => void;
}) {
  const open = tasks.filter((t) => t.status === "active").length;
  const doneCount = tasks.filter((t) => t.status === "completed").length;
  const statusLabel =
    open > 0
      ? `${open} left`
      : tasks.length > 0
        ? "done"
        : totalTasks > 0
          ? "not scheduled"
          : "empty";

  return (
    <section className="anim-rise-in">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {accent && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
          <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <span
            className={cn(
              "font-mono text-[10.5px] tnum",
              doneCount > 0 && open === 0 ? "text-success" : "text-muted-foreground",
            )}
          >
            {statusLabel}
          </span>
          {sub && (
            <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground/70 sm:block">
              · {sub}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a task to ${title}`}
          className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-border/70 px-4 py-4 text-center text-[13px] text-muted-foreground">
          {totalTasks > 0 ? "No tasks scheduled for today." : "No tasks yet — tap + to add one."}
        </div>
      ) : (
        <ListShell className="divide-y divide-border/60">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={onOpen} onToggle={onToggle} />
          ))}
        </ListShell>
      )}
    </section>
  );
}

export function TodayView() {
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const tasks = useStore((s) => s.tasks);

  const sections = useStore((s) => s.sections);
  const logs = useStore((s) => s.logs);
  const history = useStore((s) => s.history);
  const toggleTask = useStore((s) => s.toggleTask);
  const profileName = useStore((s) => s.profileName);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formSection, setFormSection] = useState<
    "daily" | "remainder" | "occasional" | `custom:${string}`
  >("daily");

  const derived = useMemo(() => {
    if (!now) return null;
    const key = dateKey(now);
    const breakdown = breakdownForDay(tasks, sections, key);
    const workload = workloadForTasks(tasks, key, sections);

    const live = liveDayRec(tasks, logs, key, sections);
    // Keep the stored kind (recovery/inactive) — a recovery day must not
    // break the streak, and rest days must stay neutral.
    const recs: DayRec[] = history.map((h) => ({
      date: h.date,
      plannedMinutes: h.plannedMinutes,
      completedMinutes: h.completedMinutes,
      percentage: h.percentage,
      kind: h.kind,
    }));
    const streak = currentStreak([...recs, live], key);

    const yesterdayKey = dateKey(addDays(now, -1));
    const recoveryYesterday = history.some(
      (h) => h.date === yesterdayKey && h.kind === "recovery",
    );

    const openTotal =
      breakdown.groups.reduce(
        (s, g) => s + g.tasks.filter((t) => t.status === "active").length,
        0,
      ) + breakdown.specials.length;
    const doneTotal =
      breakdown.groups.reduce(
        (s, g) => s + g.tasks.filter((t) => t.status === "completed").length,
        0,
      ) + breakdown.specialsDone.length;

    // "Up next": the first active task in section order, preferring one that
    // carries an explicit next action — that is the most actionable thing.
    const activeTasks = breakdown.groups.flatMap((g) =>
      g.tasks.filter((t) => t.status === "active"),
    );
    const upNext =
      activeTasks.find((t) => t.nextAction && t.nextAction.trim().length > 0) ??
      activeTasks[0] ??
      null;

    return {
      key,
      breakdown,
      workload,
      streak,
      recoveryYesterday,
      openTotal,
      doneTotal,
      upNext,
      isEmpty:
        openTotal === 0 &&
        doneTotal === 0 &&
        breakdown.specials.length === 0 &&
        breakdown.groups.length === 0,
    };
  }, [now, tasks, sections, logs, history]);

  const openTask = (id: string) => setSelectedId(id);

  const openForm = (section: "daily" | "remainder" | "occasional" | `custom:${string}`) => {
    setFormSection(section);
    setFormOpen(true);
  };

  return (
    <PageFrame className="pt-3 sm:pt-4">
      {!ready || !now || !derived ? (
        <div className="space-y-6">
          <div className="space-y-2.5">
            <div className="skeleton h-3 w-40 rounded bg-muted/60" />
            <div className="skeleton h-8 w-72 rounded bg-muted/60" />
            <div className="skeleton h-24 rounded-xl bg-muted/40" />
          </div>
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <>
          {derived.isEmpty ? (
            <>
              <div className="mb-6">
                <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {now.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <h1 className="mt-1.5 text-[23px] font-semibold leading-tight tracking-tight text-foreground sm:text-[27px]">
                  {greetingForHour(now.getHours())}
                  <span className="text-muted-foreground">,</span> {profileName}
                </h1>
              </div>
              <EmptyState
                icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
                title="Nothing planned yet"
                body="Add one thing you want to make progress on today. Small and specific beats big and vague."
                action={
                  <Button variant="primary" size="md" onClick={() => openForm("daily")}>
                    <Plus className="h-4 w-4" strokeWidth={1.75} /> Add task
                  </Button>
                }
              />
            </>
          ) : (
            <>
              <TodayHero
                now={now}
                profileName={profileName}
                streak={derived.streak}
                planned={derived.workload.planned}
                remaining={derived.workload.remaining}
                untimedCount={derived.workload.untimedCount}
                timedCount={derived.workload.timedCount}
                openTotal={derived.openTotal}
                doneTotal={derived.doneTotal}
                upNext={derived.upNext}
                onOpen={(t) => openTask(t.id)}
                onToggle={(t) => toggleTask(t.id)}
              />

              {derived.recoveryYesterday && (
                <p className="mb-5 -mt-2 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <span className="h-1 w-1 rounded-full bg-success" />
                  Yesterday counted as a recovery day — your consistency is still intact.
                </p>
              )}

              <div className="space-y-6">
                {derived.breakdown.specials.length > 0 && (
                  <SpecialTaskBanner
                    tasks={derived.breakdown.specials}
                    onOpen={(t) => openTask(t.id)}
                    onToggle={(t) => toggleTask(t.id)}
                  />
                )}

                <RemindersStrip />

                {derived.breakdown.groups.map((g) => {
                  const isCustom = g.id !== "builtin-daily";
                  const section = isCustom ? sections.find((s) => s.id === g.id) : undefined;
                  return (
                    <GroupSection
                      key={g.id}
                      title={g.title}
                      sub={g.tasks[0]?.schedule ? scheduleSummary(g.tasks[0].schedule) : undefined}
                      tasks={g.tasks}
                      accent={
                        section
                          ? section.icon
                            ? undefined
                            : "hsl(var(--primary) / 0.75)"
                          : undefined
                      }
                      totalTasks={tasks.filter((task) =>
                        g.id === "builtin-daily"
                          ? task.section === "daily"
                          : task.section === "custom" && task.customSectionId === g.id,
                      ).length}
                      onOpen={(t) => openTask(t.id)}
                      onToggle={(t) => toggleTask(t.id)}
                      onAdd={() =>
                        openForm(g.id === "builtin-daily" ? "daily" : (`custom:${g.id}` as const))
                      }
                    />
                  );
                })}

                <div className="flex justify-center pb-1">
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => openForm("daily")}
                    className="rounded-full px-5"
                  >
                  <Plus className="h-4 w-4" strokeWidth={1.75} /> Add task
                </Button>
                </div>
              </div>
            </>
          )}

          {/*
           * Other lists — quiet text links rather than a row of pills. The
           * destinations are unchanged; they simply no longer compete with
           * today's work for attention.
           */}
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-4">
            <Link
              href="/remainder"
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListChecks className="h-3.5 w-3.5" strokeWidth={1.75} />
              Deadlines
            </Link>
            <Link
              href="/occasional"
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              Bucket list
            </Link>
            {sections.map((section) => (
              <Link
                key={section.id}
                href={`/section?sectionId=${encodeURIComponent(section.id)}`}
                className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate">
                  {section.icon ? `${section.icon} ` : ""}
                  {section.name}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection={formSection}
      />
    </PageFrame>
  );
}
