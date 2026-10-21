"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/lib/hooks";
import { onAppResume } from "@/lib/lifecycle";
import {
  disableEasyTouch,
  easyTouchSupported,
  enableEasyTouch,
  getEasyTouchStatus,
  requestEasyTouchPermission,
  type EasyTouchStatus,
} from "@/lib/easy-touch-native";

/**
 * On/off and permission card for the Android system-wide edge handle.
 *
 * The handle lives outside the WebView, so the copy describes its docked,
 * dimmed state rather than the web-only in-app bubble. "Display over other
 * apps" is the one special access Android will not show as a normal dialog.
 */
export function EasyTouchSettings() {
  const supported = easyTouchSupported();
  const mounted = useMounted();
  const [status, setStatus] = useState<EasyTouchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const awaitingPermission = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getEasyTouchStatus();
    if (!alive.current) return;
    setStatus(next);

    // Returning from the Android settings screen is the grant moment: switch
    // the bubble on without making the user find the toggle again.
    if (awaitingPermission.current && next.overlay) {
      awaitingPermission.current = false;
      setBusy(true);
      const enabled = await enableEasyTouch();
      if (!alive.current) return;
      setStatus(enabled);
      setBusy(false);
      setNote(
        enabled.enabled
          ? "Easy touch is on. Unlock the phone and the handle will be at the screen edge, dimmed until you tap it."
          : "Android still blocks the bubble. Check the switch for Momentum, then try again.",
      );
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!supported) return;
    void refresh();
    const offResume = onAppResume(() => {
      void refresh();
    });
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      offResume();
      window.removeEventListener("focus", onFocus);
    };
  }, [supported, refresh]);

  const allow = async () => {
    setBusy(true);
    setNote(null);
    // Set before the intent launches: the resume event can beat the plugin's
    // promise when the settings screen opens or closes quickly.
    awaitingPermission.current = true;
    try {
      const result = await requestEasyTouchPermission();
      if (result.granted) {
        awaitingPermission.current = false;
        const enabled = await enableEasyTouch();
        if (alive.current) setStatus(enabled);
      } else if (result.opened) {
        setNote(
          "Turn on “Display over other apps” for Momentum, then come back. Easy touch will switch on automatically.",
        );
      } else {
        awaitingPermission.current = false;
        setNote(
          "Android could not open that screen. Open Settings → Apps → Momentum → Special app access → Display over other apps.",
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    const next = await enableEasyTouch();
    if (!alive.current) return;
    setStatus(next);
    setBusy(false);
    setNote(
      next.enabled
        ? "Easy touch is on. Unlock the phone and the handle will be at the screen edge, dimmed until you tap it."
        : "Android did not allow the bubble to start. Check the permission switch and try again.",
    );
  };

  const turnOff = async () => {
    setBusy(true);
    setNote(null);
    const next = await disableEasyTouch();
    if (!alive.current) return;
    setStatus(next);
    setBusy(false);
  };

  const loading = supported && (!mounted || status === null);
  const overlay = status?.overlay ?? false;
  const enabled = status?.enabled ?? false;

  const description = !supported
    ? "The floating system bubble is available in Momentum for Android."
    : loading
      ? "Checking Android permission…"
      : !overlay
        ? "Android needs permission before a handle can follow you outside Momentum."
        : !enabled
          ? "Permission granted. Turn it on to park a handle at the screen edge."
          : "On. The handle stays at the edge of every app, even after Momentum is closed.";

  const hint = !supported
    ? "Inside the web app, the orange bubble already gives you quick capture and tick-off without any permission."
    : enabled
      ? "Tap the handle once to pull it out, tap again for Add task, Tick off or Today. Drag it to either edge; it tucks itself away after a moment."
      : "Turn it on to capture or tick off tasks without opening Momentum, at any time after you unlock the phone.";

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Hand className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Easy touch</h2>
      </div>

      <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal/[0.08] text-signal">
            <Hand className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-foreground">Floating bubble</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          {supported && (
            <Button
              variant="soft"
              size="sm"
              disabled={loading || busy}
              onClick={() => {
                if (!overlay) {
                  void allow();
                } else if (enabled) {
                  void turnOff();
                } else {
                  void turnOn();
                }
              }}
            >
              {loading
                ? "Checking…"
                : busy
                  ? "Working…"
                  : !overlay
                    ? "Allow access"
                    : enabled
                      ? "Turn off"
                      : "Turn on"}
            </Button>
          )}
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>

      {note && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {note}
        </p>
      )}

      {supported && (
        <p className="mt-2 px-0.5 text-xs leading-relaxed text-muted-foreground">
          Some phones call this access “Appear on top” or “Display pop-up windows”. Android may show
          “Restricted setting” for sideloaded apps; allow it once in the app&apos;s system settings.
        </p>
      )}
    </section>
  );
}
