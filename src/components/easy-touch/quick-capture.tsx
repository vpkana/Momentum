"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useModalStack } from "@/lib/modal-stack";
import { useStore } from "@/lib/store";
import {
  customSectionIdOf,
  isRecurringKey,
  sectionKindOf,
  sectionOptions,
  type SectionKey,
} from "@/lib/task-wizard";
import { cn } from "@/lib/utils";

const STACK_ID = "easy-touch-capture";

const DURATIONS: { label: string; value: number | null }[] = [
  { label: "No timer", value: null },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "2h", value: 120 },
];

function defaultDuration(section: SectionKey): number | null {
  return isRecurringKey(section) ? 30 : null;
}

/**
 * One-line capture: a title, a list, and a time.
 *
 * Deliberately not a smaller copy of the full wizard. Everything optional is
 * pre-decided (today's section, a 30-minute estimate for recurring work) so
 * the common case is "type and press Enter". Repeated entries keep the sheet
 * open, which is what a brain-dump actually looks like. Anything richer is one
 * tap away through More options.
 */
export function QuickCapture({
  open,
  onClose,
  onMore,
}: {
  open: boolean;
  onClose: () => void;
  onMore: (section: SectionKey) => void;
}) {
  useModalStack(STACK_ID, "Quick capture", onClose, open);

  const sections = useStore((s) => s.sections);
  const addTask = useStore((s) => s.addTask);
  const options = sectionOptions(sections);

  const [title, setTitle] = useState("");
  const [sectionKey, setSectionKey] = useState<SectionKey>("daily");
  const [duration, setDuration] = useState<number | null>(30);
  const [durationTouched, setDurationTouched] = useState(false);
  const [added, setAdded] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each opening starts a fresh entry, but the list and time preferences are
  // kept — the second capture of a session should need even fewer taps.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAdded(0);
    if (!durationTouched) setDuration(defaultDuration(sectionKey));
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
    // `durationTouched` and `sectionKey` are read at open time, not watched:
    // changing them inside the sheet must not reset the input or refocus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickSection = (key: SectionKey) => {
    setSectionKey(key);
    if (!durationTouched) setDuration(defaultDuration(key));
  };

  const pickDuration = (value: number | null) => {
    setDurationTouched(true);
    setDuration(value);
  };

  const submit = () => {
    const clean = title.trim();
    if (!clean) return;
    addTask({
      title: clean,
      section: sectionKindOf(sectionKey),
      customSectionId: customSectionIdOf(sectionKey),
      estimatedMinutes: duration,
    });
    setTitle("");
    setAdded((count) => count + 1);
    inputRef.current?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Quick capture"
      title="Add a task"
      stackId={STACK_ID}
      className="sm:max-w-lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <Input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          aria-label="Task name"
          maxLength={120}
          autoComplete="off"
          enterKeyHint="done"
          className="h-12 text-base"
        />

        <div>
          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            List
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="List">
            {options.map((option) => {
              const selected = option.key === sectionKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickSection(option.key)}
                  className={cn(
                    "press h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    selected
                      ? "border-primary/55 bg-primary/[0.08] text-foreground"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.icon ? `${option.icon} ` : ""}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Time
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Time estimate">
            {DURATIONS.map((option) => {
              const selected = duration === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickDuration(option.value)}
                  className={cn(
                    "press h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    selected
                      ? "border-primary/55 bg-primary/[0.08] text-foreground"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {added > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2 text-[12.5px] text-foreground"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
            Added {added === 1 ? "one task" : `${added} tasks`}. Keep going, or close when done.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4">
          <button
            type="button"
            onClick={() => onMore(sectionKey)}
            className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            More options
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={title.trim().length === 0}
            className="min-w-[104px]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
