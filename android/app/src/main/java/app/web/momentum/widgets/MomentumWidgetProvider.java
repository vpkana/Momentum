package app.web.momentum.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Shared update/resize plumbing; subclasses only describe how to draw. */
public abstract class MomentumWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            render(context, appWidgetManager, widgetId);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId,
            Bundle newOptions) {
        render(context, appWidgetManager, appWidgetId);
    }

    protected abstract void render(Context context, AppWidgetManager manager, int widgetId);
}
