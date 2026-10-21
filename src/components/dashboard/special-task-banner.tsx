"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Star } from "lucide-react";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { CheckboxBox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Special (due-today) tasks. With several, they rotate quietly — one at a
 * time, understated, never dominating the screen. Each can be ticked off
 * directly, so deadline work counts toward today's progress like any other
 * task.
 */
export function SpecialTaskBanner({
  tasks,
  onOpen,
  onToggle,
}: {
  tasks: Task[];
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (tasks.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % tasks.length),
      4500,
    );
    return () => window.clearInterval(id);
  }, [tasks.length]);

  if (tasks.length === 0) return null;
  // Clamp so a shrinking list never leaves the index out of range.
  const current = tasks[Math.min(index, tasks.length - 1)];

  return (
    <div className="anim-rise-in overflow-hidden rounded-2xl border border-signal/25 bg-signal-soft/45 shadow-soft">
      <div
        key={current.id}
        className="anim-fade-up flex items-center gap-2 py-3 pl-3 pr-4"
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Complete ${current.title}`}
          onClick={() => onToggle(current)}
          className="shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <CheckboxBox checked={false} />
        </button>
        <button
          type="button"
          onClick={() => onOpen(current)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        >
          <Star
            className="h-[15px] w-[15px] shrink-0 text-signal"
            fill="currentColor"
            strokeWidth={0}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-signal/90">
              Due today
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                {current.title}
              </span>
              {isTimedTask(current) && (
                <span className="shrink-0 font-mono text-[11.5px] tnum text-muted-foreground">
                  {formatMinutes(remainingMinutesOf(current))}
                </span>
              )}
            </span>
            {current.nextAction && (
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowRight className="h-3 w-3 shrink-0 text-signal/80" strokeWidth={1.75} />
                <span className="truncate">{current.nextAction}</span>
              </span>
            )}
          </span>
        </button>
      </div>
      {tasks.length > 1 && (
        <div
          className="flex items-center justify-center gap-1 pb-2"
          aria-label={`${tasks.length} special tasks, showing ${index + 1} of ${tasks.length}`}
        >
          {tasks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              aria-label={`Show special task: ${t.title}`}
              onClick={() => setIndex(i)}
              className="group flex h-5 w-5 items-center justify-center rounded-full"
            >
              <span
                className={cn(
                  "h-1 rounded-full transition-all duration-300 group-hover:bg-muted-foreground/50",
                  i === index ? "w-4 bg-signal/70" : "w-1 bg-muted-foreground/25",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
