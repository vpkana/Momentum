package app.web.momentum.widgets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles the "tick" target inside widgets.
 *
 * A tap updates the native snapshot first (instant feedback) and enters a
 * small queue that the web app drains on resume, which is where IndexedDB is
 * actually written.
 */
public class WidgetActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !WidgetData.ACTION_COMPLETE.equals(intent.getAction())) return;

        String taskId = intent.getStringExtra(WidgetData.EXTRA_COMPLETE_TASK);
        String date = intent.getStringExtra(WidgetData.EXTRA_COMPLETE_DATE);
        if (WidgetData.completeTask(context, taskId, date)) {
            MomentumWidgetUpdater.updateAll(context);
        }
    }
}
