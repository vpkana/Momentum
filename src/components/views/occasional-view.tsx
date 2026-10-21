"use client";

import { useMemo, useState } from "react";
import { Compass, Plus } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/layout/page-frame";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";

export function OccasionalView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const tasks = useStore((s) => s.tasks);
  const toggleTask = useStore((s) => s.toggleTask);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const open = useMemo(
    () => tasks.filter((t) => t.section === "occasional" && t.status === "active"),
    [tasks],
  );
  const done = useMemo(
    () => tasks.filter((t) => t.section === "occasional" && t.status === "completed"),
    [tasks],
  );

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Someday"
        title="Bucket list"
        sub="Your someday list — none of it counts against today's load."
        aside={
          <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Task
          </Button>
        }
      />

      {!mounted || !ready ? (
        <ListSkeleton rows={4} />
      ) : open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<Compass className="h-4 w-4" strokeWidth={1.75} />}
          title="Your bucket list is empty"
          body="Movies, books, places, skills — for when the moment is right."
          action={
            <Button variant="soft" size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add something fun
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <ListShell>
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onOpen={(x) => setSelectedId(x.id)}
                onToggle={(x) => toggleTask(x.id)}
              />
            ))}
          </ListShell>
          {done.length > 0 && (
            <ListShell>
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onOpen={(x) => setSelectedId(x.id)}
                  onToggle={(x) => toggleTask(x.id)}
                />
              ))}
            </ListShell>
          )}
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection="occasional"
      />
    </PageFrame>
  );
}
