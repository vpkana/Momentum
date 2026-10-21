package app.web.momentum.widgets;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Shared storage for the widget bridge.
 *
 * Task data belongs to the web app (IndexedDB). The app pushes a compact
 * snapshot here; widgets render it without the WebView, and taps are queued
 * back until the app resumes. Every write is guarded by a single lock so a
 * widget tap racing a plugin sync cannot corrupt the stored JSON.
 */
public final class WidgetData {

    public static final String ACTION_COMPLETE = "app.web.momentum.widget.COMPLETE";
    public static final String EXTRA_COMPLETE_TASK = "momentum_widget_task_id";
    public static final String EXTRA_COMPLETE_DATE = "momentum_widget_date";

    public static final String LAUNCH_QUICK_ADD = "quick-add";
    public static final String LAUNCH_QUICK_TICK = "quick-tick";
    public static final String LAUNCH_OPEN_PROFILE = "open-profile";
    public static final String LAUNCH_FOCUS_TASK = "focus-task";
    public static final String EXTRA_LAUNCH_ACTION = "momentum_widget_action";
    public static final String EXTRA_LAUNCH_TASK = "momentum_widget_launch_task_id";

    private static final String PREFS = "momentum_widgets";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_PENDING = "pending_actions";
    private static final String KEY_LAUNCH = "launch_action";
    private static final Object LOCK = new Object();

    private WidgetData() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public static void saveSnapshot(Context context, String json) {
        if (json == null) return;
        try {
            new JSONObject(json);
        } catch (JSONException e) {
            return;
        }
        synchronized (LOCK) {
            prefs(context).edit().putString(KEY_SNAPSHOT, json).apply();
        }
    }

    /** The stored snapshot, or null when it describes another day. */
    public static JSONObject snapshotForToday(Context context) {
        synchronized (LOCK) {
            String raw = prefs(context).getString(KEY_SNAPSHOT, null);
            if (raw == null) return null;
            try {
                JSONObject snapshot = new JSONObject(raw);
                return todayKey().equals(snapshot.optString("date", "")) ? snapshot : null;
            } catch (JSONException e) {
                return null;
            }
        }
    }

    /**
     * Tick a task from a widget.
     *
     * The snapshot is updated immediately so the widget responds without
     * waiting for the app, and the tap is queued for IndexedDB. A tap that was
     * rendered on a previous day is ignored rather than completing today's
     * occurrence of a recurring task.
     */
    public static boolean completeTask(Context context, String taskId, String date) {
        if (taskId == null || taskId.isEmpty()) return false;
        synchronized (LOCK) {
            JSONObject snapshot = snapshotForToday(context);
            if (snapshot == null) return false;

            String snapshotDate = snapshot.optString("date", "");
            if (date != null && !date.isEmpty() && !date.equals(snapshotDate)) return false;

            JSONArray tasks = snapshot.optJSONArray("tasks");
            if (tasks == null) return false;

            JSONObject task = null;
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject candidate = tasks.optJSONObject(i);
                if (candidate != null && taskId.equals(candidate.optString("id"))) {
                    task = candidate;
                    break;
                }
            }
            if (task == null || task.optBoolean("done", false)) return false;

            try {
                task.put("done", true);

                int total = snapshot.optInt("total", 0);
                int done = snapshot.optInt("done", 0) + 1;
                if (total > 0 && done > total) done = total;
                int taskPercent = total > 0 ? Math.round(done * 100f / total) : 0;

                int planned = snapshot.optInt("plannedMinutes", 0);
                int remaining = Math.max(
                        0,
                        snapshot.optInt("remainingMinutes", 0) - task.optInt("minutes", 0));
                int percent = taskPercent;
                if (snapshot.optBoolean("timeBased", false) && planned > 0) {
                    int completed = Math.max(0, planned - remaining);
                    percent = Math.min(100, Math.round(completed * 100f / planned));
                }

                snapshot.put("done", done);
                snapshot.put("taskPercent", taskPercent);
                snapshot.put("remainingMinutes", remaining);
                snapshot.put("percent", percent);

                JSONObject next = null;
                for (int i = 0; i < tasks.length(); i++) {
                    JSONObject candidate = tasks.optJSONObject(i);
                    if (candidate == null || candidate.optBoolean("done", false)) continue;
                    next = new JSONObject()
                            .put("id", candidate.optString("id"))
                            .put("title", candidate.optString("title"))
                            .put("meta", candidate.optString("meta", ""))
                            .put("timed", candidate.optBoolean("timed", false));
                    break;
                }
                snapshot.put("next", next == null ? JSONObject.NULL : next);

                prefs(context).edit().putString(KEY_SNAPSHOT, snapshot.toString()).apply();
            } catch (JSONException e) {
                return false;
            }

            queueCompletion(context, taskId, snapshotDate);
            return true;
        }
    }

    private static void queueCompletion(Context context, String taskId, String date) {
        JSONArray pending = pendingActions(context);
        for (int i = 0; i < pending.length(); i++) {
            JSONObject existing = pending.optJSONObject(i);
            if (existing == null) continue;
            if (taskId.equals(existing.optString("taskId"))
                    && date.equals(existing.optString("date"))) {
                return;
            }
        }
        try {
            pending.put(new JSONObject()
                    .put("type", "complete")
                    .put("taskId", taskId)
                    .put("date", date));
            prefs(context).edit().putString(KEY_PENDING, pending.toString()).apply();
        } catch (JSONException ignored) {
            // Plain string values; serialization cannot realistically fail.
        }
    }

    private static JSONArray pendingActions(Context context) {
        String raw = prefs(context).getString(KEY_PENDING, null);
        if (raw == null) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public static String consumePendingActions(Context context) {
        synchronized (LOCK) {
            String raw = prefs(context).getString(KEY_PENDING, null);
            if (raw == null) return "[]";
            prefs(context).edit().remove(KEY_PENDING).apply();
            return raw;
        }
    }

    public static void saveLaunch(Context context, String type, String taskId) {
        if (type == null || type.isEmpty()) return;
        try {
            JSONObject action = new JSONObject().put("type", type);
            if (taskId != null && !taskId.isEmpty()) action.put("taskId", taskId);
            synchronized (LOCK) {
                prefs(context).edit().putString(KEY_LAUNCH, action.toString()).apply();
            }
        } catch (JSONException ignored) {
        }
    }

    public static String consumeLaunch(Context context) {
        synchronized (LOCK) {
            String raw = prefs(context).getString(KEY_LAUNCH, null);
            if (raw == null) return null;
            prefs(context).edit().remove(KEY_LAUNCH).apply();
            return raw;
        }
    }
}
