"use client";

import { Flame, Timer } from "lucide-react";
import { ProgressRing } from "@/components/ui/progress-ring";
import type { DayRec } from "@/lib/performance";
import type { Task, TimeLog } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PROFILE } from "@/lib/types";

export function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "signal";
}) {
  return (
    <div className="surface rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight",
          tone === "signal" ? "text-signal" : "text-foreground",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function TodayTile({ rec }: { rec: DayRec }) {
  const rest = rec.plannedMinutes === 0;
  const pct = rec.percentage;
  const met = pct !== null && pct >= PROFILE.streakThreshold * 100;
  return (
    <StatTile
      icon={<Timer className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />}
      label="Today"
      tone={!rest && pct !== null && !met ? "signal" : "default"}
      value={rest ? "—" : `${pct}%`}
      sub={
        rest
          ? "Nothing planned — rest day."
          : met
            ? `Streak-safe · ${formatMinutes(rec.completedMinutes)} of ${formatMinutes(rec.plannedMinutes)} done`
            : `${formatMinutes(rec.completedMinutes)} of ${formatMinutes(rec.plannedMinutes)} — keep going to hold the streak`
      }
    />
  );
}

export function StreakTile({
  current,
  best,
  todayPct,
}: {
  current: number;
  best: number;
  /** Today's completion percentage, or null on a rest day. */
  todayPct: number | null;
}) {
  // The ring is today's progress, not the streak's distance to the record. It
  // therefore resets with the day instead of sitting at 100% for as long as the
  // streak continues. Orange matches the streak flame rather than the accent.
  const pct = todayPct === null ? null : Math.max(0, Math.min(100, todayPct));
  const toBeat = Math.max(0, best - current);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-signal/30 bg-signal-soft/50 px-4 py-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-signal/15 blur-2xl"
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-signal" fill="currentColor" strokeWidth={0} />
              <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-signal-foreground/90">
                Current
              </p>
            </div>
            <p className="mt-1.5 tnum text-[30px] font-semibold leading-none tracking-tight text-signal-foreground">
              {current}
            </p>
            <p className="mt-1.5 text-[11px] leading-snug text-signal-foreground/75">
              ≥{Math.round(PROFILE.streakThreshold * 100)}% keeps it alive
            </p>
          </div>
          <ProgressRing
            value={pct}
            size={46}
            stroke={5}
            className="anim-ring-in mt-0.5"
            trackClassName="stroke-signal-foreground/20"
            progressClassName="stroke-signal"
            label={
              pct === null
                ? "Nothing planned today"
                : `${pct}% of today's plan complete`
            }
          >
            <span className="tnum text-[10.5px] font-semibold text-signal-foreground">
              {pct === null ? "—" : `${pct}%`}
            </span>
          </ProgressRing>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card/60 px-4 py-3.5">
        <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Best
        </p>
        <p className="mt-1.5 tnum text-[30px] font-semibold leading-none tracking-tight text-foreground">
          {best}
        </p>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {toBeat > 0
            ? `${toBeat} day${toBeat === 1 ? "" : "s"} to beat`
            : "all-time record"}
        </p>
      </div>
    </div>
  );
}

export function ActivityFeed({
  logs,
  tasks,
}: {
  logs: TimeLog[];
  tasks: Task[];
}) {
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const sorted = [...logs]
    .sort((a, b) => (a.date === b.date ? b.minutes - a.minutes : a.date < b.date ? 1 : -1))
    .slice(0, 12);

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Complete some activity to see your progress.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {sorted.map((l) => {
        const d = new Date(l.date + "T12:00:00");
        const title = titleOf.get(l.taskId);
        return (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
              {title ?? "Deleted task"}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] tnum text-muted-foreground">
              +{formatMinutes(l.minutes)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
