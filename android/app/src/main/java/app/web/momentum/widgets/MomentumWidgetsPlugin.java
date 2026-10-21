package app.web.momentum.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "MomentumWidgets")
public class MomentumWidgetsPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("Missing widget snapshot");
            return;
        }
        WidgetData.saveSnapshot(getContext(), snapshot.toString());
        MomentumWidgetUpdater.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void consumeActions(PluginCall call) {
        JSObject result = new JSObject();
        JSArray actions = new JSArray();
        String raw = WidgetData.consumePendingActions(getContext());
        try {
            JSONArray stored = new JSONArray(raw);
            for (int i = 0; i < stored.length(); i++) {
                JSONObject action = stored.optJSONObject(i);
                if (action != null) actions.put(new JSObject(action.toString()));
            }
        } catch (JSONException ignored) {
        }
        result.put("actions", actions);
        call.resolve(result);
    }

    @PluginMethod
    public void consumeLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        String raw = WidgetData.consumeLaunch(getContext());
        if (raw != null) {
            try {
                result.put("action", new JSObject(raw));
            } catch (JSONException ignored) {
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void pinWidget(PluginCall call) {
        String kind = call.getString("kind", "today");
        Class<? extends AppWidgetProvider> providerClass = providerFor(kind);
        if (providerClass == null) {
            call.reject("Unknown widget type");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            resolvePin(call, false, false);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            resolvePin(call, false, false);
            return;
        }
        activity.runOnUiThread(() -> {
            boolean supported = false;
            boolean requested = false;
            try {
                AppWidgetManager manager = AppWidgetManager.getInstance(activity);
                supported = manager.isRequestPinAppWidgetSupported();
                if (supported) {
                    ComponentName provider = new ComponentName(activity, providerClass);
                    requested = manager.requestPinAppWidget(provider, null, null);
                }
            } catch (Exception ignored) {
            }
            resolvePin(call, supported, requested);
        });
    }

    private void resolvePin(PluginCall call, boolean supported, boolean requested) {
        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("requested", requested);
        call.resolve(result);
    }

    private Class<? extends AppWidgetProvider> providerFor(String kind) {
        if ("today".equals(kind)) return TodayWidgetProvider.class;
        if ("next".equals(kind)) return NextUpWidgetProvider.class;
        if ("streak".equals(kind)) return StreakWidgetProvider.class;
        if ("quick-add".equals(kind)) return QuickAddWidgetProvider.class;
        return null;
    }
}
