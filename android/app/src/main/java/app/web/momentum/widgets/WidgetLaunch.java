package app.web.momentum.widgets;

import android.content.Context;
import android.content.Intent;

/** Moves a widget deep-link from the launch Intent into the plugin's store. */
public final class WidgetLaunch {

    private WidgetLaunch() {}

    public static void capture(Context context, Intent intent) {
        if (intent == null) return;
        String type = intent.getStringExtra(WidgetData.EXTRA_LAUNCH_ACTION);
        if (type == null) return;
        String taskId = intent.getStringExtra(WidgetData.EXTRA_LAUNCH_TASK);
        WidgetData.saveLaunch(context, type, taskId);
        // Consumed once: activity recreation must not replay the action.
        intent.removeExtra(WidgetData.EXTRA_LAUNCH_ACTION);
        intent.removeExtra(WidgetData.EXTRA_LAUNCH_TASK);
    }
}
