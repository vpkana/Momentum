import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * System-wide easy touch, web side.
 *
 * The bubble itself is a native Android overlay; the app only owns the
 * permission flow and the on/off switch. Android does not expose "display over
 * other apps" as a runtime permission dialog — the plugin opens the matching
 * Settings screen and the status is read back when the app resumes.
 */

export interface EasyTouchStatus {
  supported: boolean;
  /** "Display over other apps" is granted. */
  overlay: boolean;
  /** The user wants the bubble running. */
  enabled: boolean;
  /** The foreground service is alive right now. */
  running: boolean;
}

interface NativeStatus {
  overlay: boolean;
  enabled: boolean;
  running: boolean;
}

interface MomentumEasyTouchPlugin {
  status(): Promise<NativeStatus>;
  requestPermission(): Promise<NativeStatus & { opened: boolean }>;
  enable(): Promise<NativeStatus & { error?: string }>;
  disable(): Promise<NativeStatus>;
}

const NativeEasyTouch = registerPlugin<MomentumEasyTouchPlugin>("MomentumEasyTouch");

export function easyTouchSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android"
  );
}

const unsupported = (): EasyTouchStatus => ({
  supported: false,
  overlay: false,
  enabled: false,
  running: false,
});

const normalize = (result: NativeStatus | null | undefined): EasyTouchStatus => ({
  supported: true,
  overlay: Boolean(result?.overlay),
  enabled: Boolean(result?.enabled),
  running: Boolean(result?.running),
});

export async function getEasyTouchStatus(): Promise<EasyTouchStatus> {
  if (!easyTouchSupported()) return unsupported();
  try {
    return normalize(await NativeEasyTouch.status());
  } catch {
    return normalize(null);
  }
}

export interface EasyTouchPermissionResult {
  opened: boolean;
  granted: boolean;
}

export async function requestEasyTouchPermission(): Promise<EasyTouchPermissionResult> {
  if (!easyTouchSupported()) return { opened: false, granted: false };
  try {
    const result = await NativeEasyTouch.requestPermission();
    return { opened: Boolean(result?.opened), granted: Boolean(result?.overlay) };
  } catch {
    return { opened: false, granted: false };
  }
}

export async function enableEasyTouch(): Promise<EasyTouchStatus> {
  if (!easyTouchSupported()) return unsupported();
  try {
    return normalize(await NativeEasyTouch.enable());
  } catch {
    return normalize(null);
  }
}

export async function disableEasyTouch(): Promise<EasyTouchStatus> {
  if (!easyTouchSupported()) return unsupported();
  try {
    return normalize(await NativeEasyTouch.disable());
  } catch {
    return normalize(null);
  }
}
