package app.web.momentum.easytouch;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The permission + lifecycle bridge for the system-wide easy touch bubble.
 *
 * "Display over other apps" cannot be requested through the normal runtime
 * permission dialog: Android only exposes the per-app switch in Settings, so
 * the app opens that screen and reads the grant back when it resumes.
 */
@CapacitorPlugin(name = "MomentumEasyTouch")
public class MomentumEasyTouchPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        Runnable openSettings = () -> {
            Context context = getContext();
            boolean granted = Settings.canDrawOverlays(context);
            boolean opened = false;
            if (!granted) {
                try {
                    Intent intent = new Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + context.getPackageName()));
                    Activity activity = getActivity();
                    if (activity != null) {
                        activity.startActivity(intent);
                    } else {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    }
                    opened = true;
                } catch (Exception ignored) {
                    // Some OEMs expose the switch only in the app's general settings.
                    try {
                        Intent fallback = new Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + context.getPackageName()));
                        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(fallback);
                        opened = true;
                    } catch (Exception ignoredAgain) {
                    }
                }
            }
            JSObject result = statusObject();
            result.put("opened", opened);
            call.resolve(result);
        };

        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(openSettings);
        } else {
            new Handler(Looper.getMainLooper()).post(openSettings);
        }
    }

    @PluginMethod
    public void enable(PluginCall call) {
        Context context = getContext();
        JSObject result = statusObject();
        if (!Settings.canDrawOverlays(context)) {
            EasyTouchService.setEnabled(context, false);
            result.put("overlay", false);
            result.put("enabled", false);
            call.resolve(result);
            return;
        }

        EasyTouchService.setEnabled(context, true);
        try {
            Intent intent = new Intent(context, EasyTouchService.class)
                    .setAction(EasyTouchService.ACTION_START);
            ContextCompat.startForegroundService(context, intent);
            result.put("enabled", true);
        } catch (Exception error) {
            EasyTouchService.setEnabled(context, false);
            result.put("enabled", false);
            result.put("error", "Android did not allow the floating bubble to start.");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Context context = getContext();
        EasyTouchService.setEnabled(context, false);
        try {
            context.stopService(new Intent(context, EasyTouchService.class));
        } catch (Exception ignored) {
        }
        JSObject result = statusObject();
        result.put("enabled", false);
        result.put("running", false);
        call.resolve(result);
    }

    private JSObject statusObject() {
        Context context = getContext();
        boolean overlay = Settings.canDrawOverlays(context);
        boolean enabled = EasyTouchService.isEnabled(context) && overlay;
        if (EasyTouchService.isEnabled(context) && !overlay) {
            EasyTouchService.setEnabled(context, false);
        }
        JSObject result = new JSObject();
        result.put("overlay", overlay);
        result.put("enabled", enabled);
        result.put("running", enabled && EasyTouchService.isRunning());
        return result;
    }
}
