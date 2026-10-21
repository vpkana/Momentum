"use client";

import { useState } from "react";
import { Flame, LayoutGrid, ListChecks, Plus, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pinWidget, widgetsSupported, type WidgetKind } from "@/lib/widgets";

const WIDGETS: {
  kind: WidgetKind;
  title: string;
  description: string;
  icon: typeof Flame;
}[] = [
  {
    kind: "today",
    title: "Today",
    description: "Today's list with checkboxes, progress and a quick-add button.",
    icon: ListChecks,
  },
  {
    kind: "next",
    title: "Up next",
    description: "The single next task, with a button to start a focus session.",
    icon: Timer,
  },
  {
    kind: "streak",
    title: "Streak",
    description: "Your streak and today's progress at a glance.",
    icon: Flame,
  },
  {
    kind: "quick-add",
    title: "Quick add",
    description: "A 2×2 tile to capture a task or tick one off.",
    icon: Plus,
  },
];

/**
 * Widget pinning lives here because it is a device action, not an in-app
 * preference: Android owns the placement UI, and the launcher may or may not
 * support requesting a pin from inside an app.
 */
export function WidgetSettings() {
  const supported = widgetsSupported();
  const [busy, setBusy] = useState<WidgetKind | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const add = async (kind: WidgetKind) => {
    setBusy(kind);
    setNote(null);
    try {
      const result = await pinWidget(kind);
      if (!result.supported) {
        setNote(
          "This Android version can't pin a widget from inside an app. Long-press your home screen, choose Widgets, then pick Momentum.",
        );
      } else if (!result.requested) {
        setNote(
          "Your launcher didn't open the pin prompt. Long-press your home screen, choose Widgets, then pick Momentum.",
        );
      } else {
        setNote("Accept the system prompt to place the widget on your home screen.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Home screen</h2>
      </div>

      {!supported ? (
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
          <p className="text-[13.5px] font-medium text-foreground">Widgets</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Today, Up next, Streak and Quick add are available in Momentum for Android.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/60 px-4">
          {WIDGETS.map((widget) => {
            const Icon = widget.icon;
            return (
              <div key={widget.kind} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 text-foreground">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-foreground">{widget.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {widget.description}
                  </p>
                </div>
                <Button
                  variant="soft"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void add(widget.kind)}
                  aria-label={`Add the ${widget.title} widget`}
                >
                  {busy === widget.kind ? "Adding…" : "Add"}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {note && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {note}
        </p>
      )}

      <p className="mt-2 px-0.5 text-xs leading-relaxed text-muted-foreground">
        Widgets follow today&apos;s plan and refresh whenever you use Momentum. Ticking a task
        from a widget is applied the next time the app opens.
      </p>
    </section>
  );
}
