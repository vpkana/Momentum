package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;

public class TodayWidgetProvider extends MomentumWidgetProvider {
    @Override
    protected void render(Context context, AppWidgetManager manager, int widgetId) {
        WidgetRenderer.renderToday(context, manager, widgetId);
    }
}
