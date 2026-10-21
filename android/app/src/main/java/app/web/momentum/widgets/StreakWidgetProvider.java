package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;

public class StreakWidgetProvider extends MomentumWidgetProvider {
    @Override
    protected void render(Context context, AppWidgetManager manager, int widgetId) {
        WidgetRenderer.renderStreak(context, manager, widgetId);
    }
}
