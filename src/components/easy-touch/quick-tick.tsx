"use client";

import { useMemo } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useModalStack } from "@/lib/modal-stack";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { breakdownForDay } from "@/lib/schedule";
import { dateKey, todayKey } from "@/lib/date";
import { isTaskDoneOn } from "@/lib/task-state";
import { isTimedTask, remainingMinutesOf } from "@/lib/duration";
import { formatMinutes } from "@/lib/format";
import { sectionLabel } from "@/lib/labels";
import type { Task } from "@/lib/types";

const STACK_ID = "easy-touch-tick";

/**
 * A flat "what is left today" list with oversized tap targets.
 *
 * This is the opposite of opening a task: no detail, no schedule, no fields.
 * One tap finishes one thing, and the list simply gets shorter.
 */
export function QuickTick({
  open,
  onClose,
  onAddTask,
}: {
  open: boolean;
  onClose: () => void;
  onAddTask: () => void;
}) {
  useModalStack(STACK_ID, "Tick off tasks", onClose, open);

  const tasks = useStore((s) => s.tasks);
  const sections = useStore((s) => s.sections);
  const toggleTask = useStore((s) => s.toggleTask);
  const now = useNow(60_000);

  const key = now ? dateKey(now) : todayKey();
  const openTasks = useMemo(() => {
    const day = breakdownForDay(tasks, sections, key);
    const seen = new Set<string>();
    const items: Task[] = [];
    for (const task of [
      ...day.specials,
      ...day.specialsDone,
      ...day.groups.flatMap((group) => group.tasks),
    ]) {
      if (seen.has(task.id) || isTaskDoneOn(task, key)) continue;
      seen.add(task.id);
      items.push(task);
    }
    return items;
  }, [tasks, sections, key]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Today"
      title="Tick off"
      stackId={STACK_ID}
      className="sm:max-w-lg"
    >
      {openTasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <CheckCircle2 className="h-9 w-9 text-success" strokeWidth={1.5} />
          <div>
            <p className="text-[15px] font-semibold text-foreground">Nothing left for today</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Either everything is done or the day has no tasks yet.
            </p>
          </div>
          <Button variant="soft" size="md" onClick={onAddTask}>
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a task
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              {openTasks.length} task{openTasks.length === 1 ? "" : "s"} left
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Tap to complete
            </span>
          </div>

          <div className="-mx-1 max-h-[56dvh] space-y-2 overflow-y-auto px-1 pb-1">
            {openTasks.map((task) => {
              const label = sectionLabel(task, sections).title;
              const remaining = isTimedTask(task) ? remainingMinutesOf(task) : 0;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => toggleTask(task.id, true)}
                  className={cnRow}
                >
                  <span
                    aria-hidden
                    className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/35 transition-colors group-hover:border-primary group-active:border-primary"
                  />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[14.5px] font-medium text-foreground">
                      {task.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                      {label}
                      {remaining > 0 && ` · ${formatMinutes(remaining)} left`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-border/70 pt-3">
            <Button variant="ghost" size="sm" onClick={onAddTask}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add another task
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

const cnRow =
  "press group flex w-full items-start gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-3 text-left " +
  "transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70";
