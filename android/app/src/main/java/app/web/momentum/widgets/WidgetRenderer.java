package app.web.momentum.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import app.web.momentum.MainActivity;
import app.web.momentum.R;

/**
 * Turns the stored snapshot into RemoteViews.
 *
 * All widgets are fixed row slots rather than collection views: the snapshot
 * is tiny (at most five rows), so adapting rows to the widget's height is
 * simpler and more reliable across launchers than a RemoteViewsService.
 */
public final class WidgetRenderer {

    private static final int MAX_ROWS = 5;
    /** Height budget of the Today chrome above the rows, in dp. */
    private static final int TODAY_CHROME_DP = 72;
    private static final int ROW_HEIGHT_DP = 36;

    private static final int[] TODAY_ROWS = {
            R.id.today_row_1, R.id.today_row_2, R.id.today_row_3, R.id.today_row_4, R.id.today_row_5,
    };
    private static final int[] TODAY_CHECKS = {
            R.id.today_check_1, R.id.today_check_2, R.id.today_check_3, R.id.today_check_4, R.id.today_check_5,
    };
    private static final int[] TODAY_TITLES = {
            R.id.today_title_1, R.id.today_title_2, R.id.today_title_3, R.id.today_title_4, R.id.today_title_5,
    };
    private static final int[] TODAY_METAS = {
            R.id.today_meta_1, R.id.today_meta_2, R.id.today_meta_3, R.id.today_meta_4, R.id.today_meta_5,
    };

    private WidgetRenderer() {}

    public static void renderToday(Context context, AppWidgetManager manager, int widgetId) {
        JSONObject snapshot = WidgetData.snapshotForToday(context);
        if (snapshot == null) {
            manager.updateAppWidget(widgetId, stale(context));
            return;
        }

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        int total = snapshot.optInt("total", 0);
        int done = snapshot.optInt("done", 0);
        int percent = snapshot.optInt("percent", 0);

        views.setTextViewText(R.id.today_date, snapshot.optString("dateLabel", ""));
        views.setTextViewText(R.id.today_streak, String.valueOf(snapshot.optInt("streak", 0)));
        views.setViewVisibility(R.id.today_summary, total > 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.today_empty, total > 0 ? View.GONE : View.VISIBLE);
        if (total > 0) {
            views.setTextViewText(
                    R.id.today_summary,
                    context.getString(R.string.widget_today_summary, done, total, percent));
        }
        views.setProgressBar(R.id.today_progress, 100, percent, false);

        JSONArray tasks = snapshot.optJSONArray("tasks");
        int capacity = todayCapacity(manager, widgetId);
        for (int i = 0; i < MAX_ROWS; i++) {
            JSONObject task = tasks != null && i < tasks.length() ? tasks.optJSONObject(i) : null;
            if (task == null || i >= capacity) {
                views.setViewVisibility(TODAY_ROWS[i], View.GONE);
                continue;
            }

            boolean completed = task.optBoolean("done", false);
            String taskId = task.optString("id", "");
            views.setViewVisibility(TODAY_ROWS[i], View.VISIBLE);
            views.setTextViewText(TODAY_TITLES[i], task.optString("title", ""));
            views.setTextViewText(TODAY_METAS[i], task.optString("meta", ""));
            views.setImageViewResource(
                    TODAY_CHECKS[i],
                    completed ? R.drawable.ic_widget_check : R.drawable.ic_widget_circle);
            views.setFloat(TODAY_TITLES[i], "setAlpha", completed ? 0.5f : 1f);
            views.setFloat(TODAY_METAS[i], "setAlpha", completed ? 0.45f : 1f);

            PendingIntent open = openIntent(context, WidgetData.LAUNCH_FOCUS_TASK, taskId);
            views.setOnClickPendingIntent(TODAY_ROWS[i], open);
            views.setOnClickPendingIntent(
                    TODAY_CHECKS[i],
                    completed
                            ? open
                            : completeIntent(context, taskId, snapshot.optString("date", "")));
        }

        views.setOnClickPendingIntent(R.id.today_header, openIntent(context, null, null));
        views.setOnClickPendingIntent(
                R.id.today_streak_group,
                openIntent(context, WidgetData.LAUNCH_OPEN_PROFILE, null));
        views.setOnClickPendingIntent(
                R.id.today_add,
                openIntent(context, WidgetData.LAUNCH_QUICK_ADD, null));

        manager.updateAppWidget(widgetId, views);
    }

    public static void renderNext(Context context, AppWidgetManager manager, int widgetId) {
        JSONObject snapshot = WidgetData.snapshotForToday(context);
        if (snapshot == null) {
            manager.updateAppWidget(widgetId, stale(context));
            return;
        }

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_next);
        JSONObject next = snapshot.optJSONObject("next");
        int total = snapshot.optInt("total", 0);
        int done = snapshot.optInt("done", 0);

        views.setTextViewText(
                R.id.next_count,
                total > 0 ? context.getString(R.string.widget_next_count, done, total) : "");

        PendingIntent action;
        if (next != null) {
            views.setTextViewText(R.id.next_title, next.optString("title", ""));
            String meta = next.optString("meta", "");
            views.setTextViewText(
                    R.id.next_meta,
                    meta.isEmpty() ? context.getString(R.string.widget_next_ready) : meta);
            views.setImageViewResource(R.id.next_action, R.drawable.ic_widget_play);
            views.setContentDescription(
                    R.id.next_action, context.getString(R.string.widget_start_focus));
            action = openIntent(context, WidgetData.LAUNCH_FOCUS_TASK, next.optString("id", ""));
        } else {
            views.setTextViewText(
                    R.id.next_title,
                    context.getString(
                            total > 0
                                    ? R.string.widget_next_done_title
                                    : R.string.widget_next_empty_title));
            views.setTextViewText(
                    R.id.next_meta,
                    context.getString(
                            total > 0
                                    ? R.string.widget_next_done_meta
                                    : R.string.widget_next_empty_meta));
            views.setImageViewResource(R.id.next_action, R.drawable.ic_widget_plus_contrast);
            views.setContentDescription(
                    R.id.next_action, context.getString(R.string.widget_add_task));
            action = openIntent(context, WidgetData.LAUNCH_QUICK_ADD, null);
        }

        views.setOnClickPendingIntent(R.id.next_root, action);
        views.setOnClickPendingIntent(R.id.next_action, action);
        manager.updateAppWidget(widgetId, views);
    }

    public static void renderStreak(Context context, AppWidgetManager manager, int widgetId) {
        JSONObject snapshot = WidgetData.snapshotForToday(context);
        if (snapshot == null) {
            manager.updateAppWidget(widgetId, stale(context));
            return;
        }

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_streak);
        int total = snapshot.optInt("total", 0);
        int done = snapshot.optInt("done", 0);

        views.setTextViewText(
                R.id.streak_number,
                String.valueOf(snapshot.optInt("streak", 0)));
        views.setTextViewText(
                R.id.streak_today,
                total > 0
                        ? context.getString(R.string.widget_streak_today, done, total)
                        : context.getString(R.string.widget_streak_no_tasks));
        views.setProgressBar(R.id.streak_progress, 100, snapshot.optInt("percent", 0), false);
        views.setOnClickPendingIntent(
                R.id.streak_root,
                openIntent(context, WidgetData.LAUNCH_OPEN_PROFILE, null));
        manager.updateAppWidget(widgetId, views);
    }

    public static void renderQuickAdd(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_add);
        JSONObject snapshot = WidgetData.snapshotForToday(context);
        int open = snapshot == null
                ? -1
                : Math.max(0, snapshot.optInt("total", 0) - snapshot.optInt("done", 0));

        views.setTextViewText(
                R.id.quick_tick,
                open > 0
                        ? context.getString(R.string.widget_quick_tick_count, open)
                        : context.getString(R.string.widget_quick_tick));
        PendingIntent add = openIntent(context, WidgetData.LAUNCH_QUICK_ADD, null);
        views.setOnClickPendingIntent(R.id.quick_add_root, add);
        views.setOnClickPendingIntent(R.id.quick_add_button, add);
        views.setOnClickPendingIntent(
                R.id.quick_tick,
                openIntent(context, WidgetData.LAUNCH_QUICK_TICK, null));
        manager.updateAppWidget(widgetId, views);
    }

    private static int todayCapacity(AppWidgetManager manager, int widgetId) {
        Bundle options = manager.getAppWidgetOptions(widgetId);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180);
        int rows = Math.round((height - TODAY_CHROME_DP) / (float) ROW_HEIGHT_DP);
        return Math.max(1, Math.min(MAX_ROWS, rows));
    }

    private static RemoteViews stale(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_stale);
        PendingIntent open = openIntent(context, null, null);
        views.setOnClickPendingIntent(R.id.stale_root, open);
        views.setOnClickPendingIntent(R.id.stale_button, open);
        return views;
    }

    private static PendingIntent openIntent(Context context, String type, String taskId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (type != null) intent.putExtra(WidgetData.EXTRA_LAUNCH_ACTION, type);
        if (taskId != null && !taskId.isEmpty()) {
            intent.putExtra(WidgetData.EXTRA_LAUNCH_TASK, taskId);
        }
        return PendingIntent.getActivity(
                context,
                requestCode("open|" + type + "|" + taskId),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent completeIntent(Context context, String taskId, String date) {
        Intent intent = new Intent(context, WidgetActionReceiver.class);
        intent.setAction(WidgetData.ACTION_COMPLETE);
        intent.putExtra(WidgetData.EXTRA_COMPLETE_TASK, taskId);
        intent.putExtra(WidgetData.EXTRA_COMPLETE_DATE, date);
        return PendingIntent.getBroadcast(
                context,
                requestCode("complete|" + taskId + "|" + date),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int requestCode(String key) {
        int code = key.hashCode();
        return code == Integer.MIN_VALUE ? 0 : Math.abs(code);
    }
}
