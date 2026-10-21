"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { CheckCheck, Home, Plus, type LucideIcon } from "lucide-react";
import { TaskFormModal } from "@/components/tasks/task-form";
import { QuickCapture } from "@/components/easy-touch/quick-capture";
import { QuickTick } from "@/components/easy-touch/quick-tick";
import { useMounted } from "@/lib/hooks";
import { useModalStack } from "@/lib/modal-stack";
import { onAppResume } from "@/lib/lifecycle";
import { useStore } from "@/lib/store";
import { isTimedTask } from "@/lib/duration";
import {
  consumeWidgetLaunch,
  WIDGET_LAUNCH_EVENT,
  type WidgetLaunchAction,
} from "@/lib/widgets";
import type { SectionKey } from "@/lib/task-wizard";
import { cn } from "@/lib/utils";

const POSITION_KEY = "momentum.easyTouch.position.v1";
const BUBBLE = 52;
const EDGE = 14;
const TOP_RESERVE = 72;
const BOTTOM_RESERVE = 96;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 174;

interface Point {
  x: number;
  y: number;
}

function clampPosition(point: Point): Point {
  const maxX = Math.max(EDGE, window.innerWidth - BUBBLE - EDGE);
  const maxY = Math.max(TOP_RESERVE, window.innerHeight - BUBBLE - BOTTOM_RESERVE);
  return {
    x: Math.min(Math.max(point.x, EDGE), maxX),
    y: Math.min(Math.max(point.y, TOP_RESERVE), maxY),
  };
}

function defaultPosition(): Point {
  return clampPosition({
    x: window.innerWidth - BUBBLE - 16,
    y: window.innerHeight * 0.62,
  });
}

function readPosition(): Point | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point> | null;
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    return clampPosition({ x: parsed.x, y: parsed.y });
  } catch {
    return null;
  }
}

function rememberPosition(point: Point) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(point));
  } catch {
    // Private mode / storage disabled — the position simply resets next launch.
  }
}

/**
 * "Easy touch": quick capture and completion from anywhere.
 *
 * On Android the bubble itself is the native system overlay (EasyTouchService);
 * this component deliberately renders no in-app bubble there, but it still owns
 * the deep links the overlay and widgets send into the app. On the web the
 * bubble is rendered here, following the same edge-docking rules.
 */
export function EasyTouch() {
  const mounted = useMounted();
  const router = useRouter();
  const inAppBubble = Capacitor.getPlatform() !== "android";
  const ready = useStore((state) => state.ready);

  const [pos, setPos] = useState<Point | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<"capture" | "tick" | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formSection, setFormSection] = useState<SectionKey>("daily");

  const posRef = useRef<Point | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Point;
    dragging: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const applyPosition = useCallback((next: Point) => {
    posRef.current = next;
    setPos(next);
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useModalStack("easy-touch-menu", "Quick actions", closeMenu, menuOpen);

  useEffect(() => {
    if (!mounted || !inAppBubble) return;
    applyPosition(readPosition() ?? defaultPosition());
    const onResize = () => {
      if (posRef.current) applyPosition(clampPosition(posRef.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, inAppBubble, applyPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);

  /* ------------------------- Widget launch handling ------------------------- */

  const applyLaunch = useCallback(
    (action: WidgetLaunchAction) => {
      setMenuOpen(false);
      switch (action.type) {
        case "quick-add":
          setFormOpen(false);
          setSheet("capture");
          break;
        case "quick-tick":
          setFormOpen(false);
          setSheet("tick");
          break;
        case "open-profile":
          setSheet(null);
          setFormOpen(false);
          router.replace("/profile");
          break;
        case "open-today":
          setSheet(null);
          setFormOpen(false);
          router.replace("/");
          break;
        case "focus-task": {
          setSheet(null);
          setFormOpen(false);
          const state = useStore.getState();
          const task = action.taskId
            ? state.tasks.find((candidate) => candidate.id === action.taskId)
            : undefined;
          if (task && task.status === "active" && isTimedTask(task)) {
            state.startFocus(task.id);
            state.openFocusScreen();
          } else {
            router.replace("/");
          }
          break;
        }
        default:
          break;
      }
    },
    [router],
  );

  useEffect(() => {
    if (!ready) return;
    const handle = async () => {
      const action = await consumeWidgetLaunch();
      if (action) applyLaunch(action);
    };
    void handle();
    const listener = () => {
      void handle();
    };
    window.addEventListener(WIDGET_LAUNCH_EVENT, listener);
    const offResume = onAppResume(() => {
      void handle();
    });
    return () => {
      window.removeEventListener(WIDGET_LAUNCH_EVENT, listener);
      offResume();
    };
  }, [ready, applyLaunch]);

  /* ------------------------------- Gestures -------------------------------- */

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!posRef.current) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: posRef.current,
      dragging: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the gesture still works without it.
    }
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging && Math.hypot(dx, dy) > 6) {
      gesture.dragging = true;
      setMenuOpen(false);
    }
    if (!gesture.dragging) return;
    applyPosition(
      clampPosition({ x: gesture.origin.x + dx, y: gesture.origin.y + dy }),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || !gesture.dragging) return;

    // The click that follows a drag must not toggle the menu.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 320);

    const current = posRef.current;
    if (!current) return;
    const snapped = clampPosition({
      x:
        current.x + BUBBLE / 2 < window.innerWidth / 2
          ? EDGE
          : window.innerWidth - BUBBLE - EDGE,
      y: current.y,
    });
    applyPosition(snapped);
    rememberPosition(snapped);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released by the platform.
    }
  };

  const toggleMenu = () => {
    if (suppressClickRef.current) return;
    setMenuOpen((open) => !open);
  };

  const openCapture = () => {
    setMenuOpen(false);
    setSheet("capture");
  };

  const openTick = () => {
    setMenuOpen(false);
    setSheet("tick");
  };

  const openToday = () => {
    setMenuOpen(false);
    router.replace("/");
  };

  if (!mounted) return null;

  // On Android the sheets still have to mount: the native bubble's menu opens
  // them through the widget launch bridge. Only the bubble itself is web-only.
  const menuTop = pos
    ? Math.max(
      12,
      Math.min(
        pos.y + BUBBLE + 10 + MENU_HEIGHT > window.innerHeight - 16
          ? pos.y - MENU_HEIGHT - 10
          : pos.y + BUBBLE + 10,
        window.innerHeight - MENU_HEIGHT - 12,
      ),
    )
    : 0;
  const menuLeft = pos
    ? Math.max(
      12,
      Math.min(
        pos.x + BUBBLE / 2 - MENU_WIDTH / 2,
        window.innerWidth - MENU_WIDTH - 12,
      ),
    )
    : 0;

  return (
    <>
      {inAppBubble && pos && menuOpen && (
        <>
          <div
            className="anim-fade-in fixed inset-0 z-30 bg-black/15 lg:hidden"
            aria-hidden
            onClick={closeMenu}
          />
          <div
            role="menu"
            aria-label="Quick actions"
            className="anim-pop-in fixed z-40 w-[196px] rounded-2xl border border-border/80 bg-card/95 p-1.5 shadow-lift backdrop-blur-xl lg:hidden"
            style={{ left: menuLeft, top: menuTop }}
          >
            <QuickAction icon={Plus} label="Add task" hint="Capture one line" onClick={openCapture} />
            <QuickAction icon={CheckCheck} label="Tick off" hint="Finish today's work" onClick={openTick} />
            <QuickAction icon={Home} label="Today" hint="Go to your dashboard" onClick={openToday} />
          </div>
        </>
      )}

      {inAppBubble && pos && (
        <button
          type="button"
          aria-label={menuOpen ? "Close quick actions" : "Open quick actions"}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={toggleMenu}
          onContextMenu={(event) => event.preventDefault()}
          className={cn(
            "fixed z-40 grid h-[52px] w-[52px] touch-none select-none place-items-center rounded-full",
            "border border-border/80 bg-card/95 text-signal shadow-lift backdrop-blur-xl",
            "transition-[transform,background-color,color] duration-200 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "lg:hidden",
            menuOpen && "bg-card text-foreground",
          )}
          style={{ left: pos.x, top: pos.y }}
        >
          <Plus
            className={cn(
              "h-6 w-6 transition-transform duration-200",
              menuOpen && "rotate-45",
            )}
            strokeWidth={1.9}
          />
        </button>
      )}

      <QuickCapture
        open={sheet === "capture"}
        onClose={() => setSheet(null)}
        onMore={(section) => {
          setSheet(null);
          setFormSection(section);
          setFormOpen(true);
        }}
      />
      <QuickTick
        open={sheet === "tick"}
        onClose={() => setSheet(null)}
        onAddTask={() => setSheet("capture")}
      />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection={formSection}
      />
    </>
  );
}

function QuickAction({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="press flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:bg-muted/55"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/65 text-foreground">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-foreground">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
