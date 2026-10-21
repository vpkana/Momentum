package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;

/** Repaints every placed widget after a snapshot sync or a widget tap. */
public final class MomentumWidgetUpdater {

    private static final Class<?>[] PROVIDERS = {
            TodayWidgetProvider.class,
            NextUpWidgetProvider.class,
            StreakWidgetProvider.class,
            QuickAddWidgetProvider.class,
    };

    private MomentumWidgetUpdater() {}

    public static void updateAll(Context context) {
        Context app = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        for (Class<?> type : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(app, type));
            if (ids.length == 0) continue;
            try {
                MomentumWidgetProvider provider =
                        (MomentumWidgetProvider) type.getDeclaredConstructor().newInstance();
                provider.onUpdate(app, manager, ids);
            } catch (Exception ignored) {
            }
        }
    }
}
