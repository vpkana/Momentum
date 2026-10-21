package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;

public class NextUpWidgetProvider extends MomentumWidgetProvider {
    @Override
    protected void render(Context context, AppWidgetManager manager, int widgetId) {
        WidgetRenderer.renderNext(context, manager, widgetId);
    }
}
