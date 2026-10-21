"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import logo from "@/app/momentum.png";
import { NAV_ITEMS, LIST_LINKS } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { liveDayRec, pickDayRec, currentStreak } from "@/lib/performance";
import { dateKey } from "@/lib/date";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { useAndroidBackButton, modalStackDepth } from "@/lib/modal-stack";
import { HOME_PATH, resolveBackAction } from "@/lib/back-policy";
import { onAppResume } from "@/lib/lifecycle";
import { FocusBanner } from "@/components/layout/focus-banner";
import { FocusScreen } from "@/components/focus/focus-screen";
import { EasyTouch } from "@/components/easy-touch/easy-touch";
import { applyWidgetCompletions, syncWidgetsFromStore } from "@/lib/widget-sync";
import { WIDGET_LAUNCH_EVENT } from "@/lib/widgets";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ShellInner>{children}</ShellInner>
    </ThemeProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const boot = useStore((s) => s.boot);
  const ready = useStore((s) => s.ready);
  const syncNotifications = useStore((s) => s.syncNotifications);
  const syncNative = useStore((s) => s.syncNativeNotifications);
  const markInteraction = useStore((s) => s.markInteraction);
  const rolloverIfNewDay = useStore((s) => s.rolloverIfNewDay);
  const pathname = usePathname();
  const router = useRouter();

  // The in-app half of the back policy (the modal half lives in the hook).
  // `resolveBackAction` is the single source of truth for the rule; top-level
  // tabs are peers joined with `replace`, so history never holds a tab stack.
  const handleBack = useCallback(() => {
    const action = resolveBackAction(modalStackDepth(), pathname);
    if (action === "replace_home") {
      router.replace(HOME_PATH);
      return true;
    }
    return false;
  }, [pathname, router]);

  // Intercept Android/iOS back button and browser history pop so that
  // modals (Create Task, Task Detail) close first instead of exiting the app.
  useAndroidBackButton(handleBack);

  useEffect(() => {
    boot();
  }, [boot]);

  // Keep the live day in sync with the real calendar.
  //
  // Android keeps the WebView alive across background/foreground, so the daily
  // rollover cannot depend on a page reload: it runs on boot, on every resume
  // (visibility or Capacitor resume), and on a short interval that also covers
  // the app being left open across midnight. It is idempotent, so the extra
  // calls are cheap no-ops while the date has not changed.
  useEffect(() => {
    if (!ready) return;
    void rolloverIfNewDay();

    const id = window.setInterval(() => {
      void rolloverIfNewDay();
      void syncNotifications();
      void syncNative();
    }, 60_000);

    const offResume = onAppResume(() => {
      markInteraction();
      void rolloverIfNewDay();
      void syncNotifications();
      void syncNative();
    });

    return () => {
      window.clearInterval(id);
      offResume();
    };
  }, [ready, rolloverIfNewDay, syncNotifications, syncNative, markInteraction]);

  // Home-screen widgets are a projection of the store, so they are refreshed
  // after any data change (debounced), on resume, and after a widget tap wakes
  // the app. Completions are applied after the day rollover, which also gives
  // them their date context.
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let debounce: number | null = null;

    const reconcile = async () => {
      await rolloverIfNewDay();
      if (disposed) return;
      await applyWidgetCompletions();
      if (disposed) return;
      await syncWidgetsFromStore();
    };

    void reconcile();

    const scheduleSync = () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = null;
        void syncWidgetsFromStore();
      }, 700);
    };

    const unsubscribe = useStore.subscribe(scheduleSync);
    const onWidgetLaunch = () => {
      void reconcile();
    };
    window.addEventListener(WIDGET_LAUNCH_EVENT, onWidgetLaunch);

    const offResume = onAppResume(() => {
      void reconcile();
    });
    const id = window.setInterval(() => {
      void syncWidgetsFromStore();
    }, 60_000);

    return () => {
      disposed = true;
      if (debounce !== null) window.clearTimeout(debounce);
      window.clearInterval(id);
      unsubscribe();
      window.removeEventListener(WIDGET_LAUNCH_EVENT, onWidgetLaunch);
      offResume();
    };
  }, [ready, rolloverIfNewDay]);

  return (
    <div className="min-h-dvh">
      <DesktopSidebar />
      <div className="flex min-h-dvh flex-col lg:pl-[228px]">
        <main className="w-full flex-1 min-w-0 px-5 pb-28 pt-[calc(max(env(safe-area-inset-top),var(--momentum-safe-area-inset-top,0px))+1.25rem)] sm:px-8 sm:pt-[calc(max(env(safe-area-inset-top),var(--momentum-safe-area-inset-top,0px))+1.75rem)] lg:px-10 lg:pb-16 lg:pt-[calc(max(env(safe-area-inset-top),var(--momentum-safe-area-inset-top,0px))+2rem)]">
          <FocusBanner />
          {children}
        </main>
        {/* Focus mode portals over everything, including the navigation. */}
        <FocusScreen />
        <MobileNav />
        <EasyTouch />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StreakMini() {
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const history = useStore((s) => s.history);
  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);
  const sections = useStore((s) => s.sections);

  let streak: number | null = null;
  if (ready && now) {
    const key = dateKey(now);
    const live = liveDayRec(tasks, logs, key, sections);
    // Stored history only — today comes from the live snapshot, so the
    // streak can never count today twice (see currentStreak's dedupe).
    const recs = history.map((h) => pickDayRec(history, null, h.date));
    streak = currentStreak([...recs, live], key);
  }

  return (
    <Link
      href="/profile"
      replace
      className="flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:text-foreground"
    >
      <Flame className="h-4 w-4 shrink-0 text-signal" fill="currentColor" strokeWidth={0} />
      <span className="tnum text-sm font-semibold text-foreground">
        {streak ?? "—"}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        day streak
      </span>
    </Link>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[228px] flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex items-center gap-2.5 px-5 pt-7">
        <Image
          src={logo}
          alt="Momentum"
          width={28}
          height={28}
          unoptimized
          className="h-7 w-7 rounded-lg object-cover"
        />
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Momentum
        </span>
      </div>

      <nav aria-label="Main" className="mt-7 flex-1 overflow-y-auto px-3">
        <p className="mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Focus
        </p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  replace
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                    active
                      ? "bg-muted/80 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mb-1.5 mt-5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Lists
        </p>
        <ul className="space-y-0.5">
          {LIST_LINKS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  replace
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                    active
                      ? "bg-muted/80 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-4">
        <StreakMini />
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card pb-[max(env(safe-area-inset-bottom),var(--momentum-safe-area-inset-bottom,0px),8px)] pt-1.5 lg:hidden"
    >
      <div className="grid grid-cols-4 px-1">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              replace
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-lg py-1 transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground/75 hover:text-foreground",
              )}
            >
              <span className="grid h-7 w-12 place-items-center">
                <Icon
                  className="h-[19px] w-[19px]"
                  strokeWidth={active ? 2 : 1.75}
                />
              </span>
              <span
                className={cn(
                  "text-[10.5px] tracking-tight transition-colors",
                  active ? "font-semibold text-primary" : "font-medium text-muted-foreground/80",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
