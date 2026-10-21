package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.content.Context;

public class QuickAddWidgetProvider extends MomentumWidgetProvider {
    @Override
    protected void render(Context context, AppWidgetManager manager, int widgetId) {
        WidgetRenderer.renderQuickAdd(context, manager, widgetId);
    }
}
