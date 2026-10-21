package app.web.momentum.easytouch;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import app.web.momentum.MainActivity;
import app.web.momentum.R;
import app.web.momentum.widgets.WidgetData;

/**
 * A system-wide "easy touch" handle.
 *
 * The bubble is a foreground service because an overlay that silently dies is
 * worse than no overlay. It lives docked to a screen edge, mostly tucked away
 * at low opacity; the first tap pulls it out, the second opens the quick-action
 * menu, and it tucks itself back in when idle. It stays visible over every app
 * (including Momentum) until the user turns it off.
 */
public class EasyTouchService extends Service {

    public static final String ACTION_START = "app.web.momentum.easytouch.START";
    public static final String ACTION_STOP = "app.web.momentum.easytouch.STOP";

    private static final String PREFS = "momentum_easy_touch";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_Y = "y";
    private static final String KEY_SIDE = "side";

    private static final String CHANNEL_ID = "easy_touch";
    private static final int NOTIFICATION_ID = 4201;

    private static final int BUBBLE_DP = 56;
    private static final int VISIBLE_DP = 30;
    private static final int MENU_WIDTH_DP = 180;
    private static final int EDGE_DP = 10;
    private static final int VERTICAL_RESERVE_DP = 44;

    private static final float COLLAPSED_ALPHA = 0.42f;
    private static final long EXPAND_TIMEOUT_MS = 5000;
    private static final long MENU_TIMEOUT_MS = 8000;
    private static final long COLLAPSE_DELAY_MS = 2500;
    private static final long SLIDE_DURATION_MS = 180;

    private static volatile boolean running = false;

    private WindowManager windowManager;
    private View bubbleView;
    private View menuView;
    private WindowManager.LayoutParams bubbleParams;
    private boolean overlayVisible;
    private boolean expanded;
    private boolean dragging;
    private String side = "right";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hideMenuTask = () -> {
        hideMenu();
        scheduleCollapse(COLLAPSE_DELAY_MS);
    };
    private final Runnable collapseTask = () -> {
        if (!dragging && menuView == null) setExpanded(false, true);
    };
    private BroadcastReceiver screenReceiver;
    private ValueAnimator slideAnimator;

    private int touchSlop;
    private float touchDownX;
    private float touchDownY;
    private int windowDownX;
    private int windowDownY;

    public static boolean isRunning() {
        return running;
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Restarts the bubble after a reboot, an app update, or a system restart.
     * A failed start is not treated as "off": Android can refuse a foreground
     * service temporarily, and the pref keeps the user's intent for next time.
     */
    public static void ensureRunning(Context context) {
        if (!isEnabled(context)) return;
        if (!Settings.canDrawOverlays(context)) {
            setEnabled(context, false);
            return;
        }
        try {
            Intent intent = new Intent(context, EasyTouchService.class).setAction(ACTION_START);
            ContextCompat.startForegroundService(context, intent);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        createChannel();
        registerScreenReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            setEnabled(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            startInForeground();
        } catch (Exception error) {
            // A sticky restart can be refused on newer Android versions while
            // the app is in the background. Stop cleanly instead of crashing.
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!Settings.canDrawOverlays(this)) {
            setEnabled(this, false);
            stopSelf();
            return START_NOT_STICKY;
        }

        setEnabled(this, true);
        showOverlay();
        return START_STICKY;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideMenu();
        if (bubbleView == null || bubbleParams == null) return;
        cancelSlide();
        bubbleParams.x = expanded ? expandedX() : collapsedX();
        bubbleParams.y = clampY(bubbleParams.y);
        try {
            windowManager.updateViewLayout(bubbleView, bubbleParams);
            savePosition();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        cancelSlide();
        hideMenu();
        hideOverlay();
        unregisterScreenReceiver();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------ Foreground ------------------------------ */

    private void startInForeground() {
        Intent open = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(
                this,
                90,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, EasyTouchService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
                this,
                91,
                stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_easy_touch_notification)
                .setContentTitle(getString(R.string.easy_touch_notification_title))
                .setContentText(getString(R.string.easy_touch_notification_text))
                .setContentIntent(content)
                .addAction(0, getString(R.string.easy_touch_notification_stop), stopIntent)
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.easy_touch_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.easy_touch_channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /* ------------------------------ Edge state ------------------------------ */

    private void registerScreenReceiver() {
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent == null ? null : intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    // Always come back tucked away after the phone is unlocked.
                    hideMenu();
                    cancelCollapse();
                    setExpanded(false, false);
                } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                    if (bubbleView == null) {
                        showOverlay();
                    } else {
                        hideMenu();
                        setExpanded(false, false);
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(
                this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void unregisterScreenReceiver() {
        if (screenReceiver == null) return;
        try {
            unregisterReceiver(screenReceiver);
        } catch (Exception ignored) {
        }
        screenReceiver = null;
    }

    /* -------------------------------- Overlay -------------------------------- */

    private void showOverlay() {
        if (windowManager == null) return;
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }
        if (overlayVisible) {
            // Revoking the permission makes the system drop the window without
            // telling the service; re-granting must build a fresh one.
            if (bubbleView != null && bubbleView.isAttachedToWindow()) return;
            hideOverlay();
        }

        LayoutInflater inflater = LayoutInflater.from(this);
        View bubble = inflater.inflate(R.layout.easy_touch_bubble, null);
        bubble.setClickable(true);
        bubble.setOnClickListener(v -> onBubbleTap());
        bubble.setOnTouchListener(new BubbleTouchListener());

        SharedPreferences store = prefs(this);
        side = "left".equals(store.getString(KEY_SIDE, "right")) ? "left" : "right";
        int y = store.getInt(KEY_Y, -1);
        if (y < 0) y = Math.round(screenHeight() * 0.62f);

        expanded = false;
        bubbleParams = overlayParams(
                dp(BUBBLE_DP), dp(BUBBLE_DP), collapsedX(), clampY(y));
        bubble.setAlpha(COLLAPSED_ALPHA);

        try {
            windowManager.addView(bubble, bubbleParams);
        } catch (Exception error) {
            Toast.makeText(this, R.string.easy_touch_overlay_failed, Toast.LENGTH_LONG).show();
            stopSelf();
            return;
        }
        bubbleView = bubble;
        overlayVisible = true;
    }

    private void hideOverlay() {
        hideMenu();
        cancelCollapse();
        cancelSlide();
        if (bubbleView != null && windowManager != null) {
            try {
                windowManager.removeView(bubbleView);
            } catch (Exception ignored) {
            }
        }
        bubbleView = null;
        bubbleParams = null;
        overlayVisible = false;
        expanded = false;
    }

    private void onBubbleTap() {
        if (menuView != null) {
            hideMenu();
            scheduleCollapse(COLLAPSE_DELAY_MS);
            return;
        }
        if (!expanded) {
            setExpanded(true, true);
            return;
        }
        cancelCollapse();
        showMenu();
    }

    private void setExpanded(boolean expand, boolean animate) {
        if (bubbleView == null || bubbleParams == null) return;
        expanded = expand;
        if (expand) {
            cancelCollapse();
            hideMenu();
            scheduleCollapse(EXPAND_TIMEOUT_MS);
        } else {
            hideMenu();
            cancelCollapse();
        }

        int targetX = expand ? expandedX() : collapsedX();
        bubbleView.animate()
                .alpha(expand ? 1f : COLLAPSED_ALPHA)
                .setDuration(animate ? SLIDE_DURATION_MS : 0)
                .start();
        if (animate) {
            animateX(targetX);
        } else {
            cancelSlide();
            bubbleParams.x = targetX;
            updateBubble();
        }
    }

    private void animateX(int targetX) {
        cancelSlide();
        if (bubbleParams == null) return;
        int startX = bubbleParams.x;
        if (startX == targetX) return;
        slideAnimator = ValueAnimator.ofInt(startX, targetX);
        slideAnimator.setDuration(SLIDE_DURATION_MS);
        slideAnimator.addUpdateListener(animation -> {
            if (bubbleParams == null) return;
            bubbleParams.x = (int) animation.getAnimatedValue();
            updateBubble();
        });
        slideAnimator.start();
    }

    private void cancelSlide() {
        if (slideAnimator != null) {
            slideAnimator.cancel();
            slideAnimator = null;
        }
    }

    private void updateBubble() {
        if (bubbleView == null || bubbleParams == null || windowManager == null) return;
        try {
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception ignored) {
        }
    }

    private void scheduleCollapse(long delay) {
        handler.removeCallbacks(collapseTask);
        handler.postDelayed(collapseTask, delay);
    }

    private void cancelCollapse() {
        handler.removeCallbacks(collapseTask);
    }

    private int expandedX() {
        return "left".equals(side)
                ? dp(EDGE_DP)
                : screenWidth() - dp(BUBBLE_DP) - dp(EDGE_DP);
    }

    private int collapsedX() {
        return "left".equals(side)
                ? -dp(BUBBLE_DP - VISIBLE_DP)
                : screenWidth() - dp(VISIBLE_DP);
    }

    /* --------------------------------- Menu ---------------------------------- */

    private void showMenu() {
        if (menuView != null || bubbleView == null || bubbleParams == null || windowManager == null) {
            return;
        }

        LayoutInflater inflater = LayoutInflater.from(this);
        View menu = inflater.inflate(R.layout.easy_touch_menu, null);
        menu.measure(
                View.MeasureSpec.makeMeasureSpec(dp(MENU_WIDTH_DP), View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));

        int width = menu.getMeasuredWidth();
        int height = menu.getMeasuredHeight();
        int x = "left".equals(side)
                ? bubbleParams.x + dp(BUBBLE_DP) + dp(8)
                : bubbleParams.x - width - dp(8);
        x = Math.max(dp(8), Math.min(x, screenWidth() - width - dp(8)));
        int y = bubbleParams.y + (dp(BUBBLE_DP) - height) / 2;
        y = Math.max(
                dp(VERTICAL_RESERVE_DP),
                Math.min(y, screenHeight() - height - dp(VERTICAL_RESERVE_DP)));

        menu.findViewById(R.id.easy_touch_add).setOnClickListener(
                v -> launch(WidgetData.LAUNCH_QUICK_ADD));
        menu.findViewById(R.id.easy_touch_tick).setOnClickListener(
                v -> launch(WidgetData.LAUNCH_QUICK_TICK));
        menu.findViewById(R.id.easy_touch_today).setOnClickListener(
                v -> launch(WidgetData.LAUNCH_OPEN_TODAY));

        WindowManager.LayoutParams params = overlayParams(width, height, x, y);
        try {
            windowManager.addView(menu, params);
        } catch (Exception ignored) {
            return;
        }
        menu.setAlpha(0f);
        menu.animate().alpha(1f).setDuration(120).start();
        menuView = menu;
        handler.postDelayed(hideMenuTask, MENU_TIMEOUT_MS);
    }

    private void hideMenu() {
        handler.removeCallbacks(hideMenuTask);
        if (menuView != null && windowManager != null) {
            try {
                windowManager.removeView(menuView);
            } catch (Exception ignored) {
            }
        }
        menuView = null;
    }

    private void launch(String type) {
        hideMenu();
        setExpanded(false, true);
        Intent intent = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (type != null) intent.putExtra(WidgetData.EXTRA_LAUNCH_ACTION, type);
        try {
            startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    private WindowManager.LayoutParams overlayParams(int width, int height, int x, int y) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                width, height, type, flags, PixelFormat.TRANSLUCENT);
        // Absolute left/right offsets: START would mirror in RTL locales and
        // put the bubble on the wrong edge for the saved side.
        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.x = x;
        params.y = y;
        return params;
    }

    private void savePosition() {
        if (bubbleParams == null) return;
        prefs(this).edit()
                .putInt(KEY_Y, bubbleParams.y)
                .putString(KEY_SIDE, side)
                .apply();
    }

    /* --------------------------------- Touch --------------------------------- */

    private final class BubbleTouchListener implements View.OnTouchListener {
        @Override
        public boolean onTouch(View view, MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    if (bubbleParams == null) return false;
                    touchDownX = event.getRawX();
                    touchDownY = event.getRawY();
                    windowDownX = bubbleParams.x;
                    windowDownY = bubbleParams.y;
                    dragging = false;
                    return true;

                case MotionEvent.ACTION_MOVE:
                    if (bubbleParams == null) return false;
                    if (!dragging) {
                        float dx = event.getRawX() - touchDownX;
                        float dy = event.getRawY() - touchDownY;
                        if (Math.hypot(dx, dy) <= touchSlop) return true;

                        // Reveal the whole bubble before it starts to follow the
                        // finger; dragging a mostly off-screen handle is awkward.
                        dragging = true;
                        cancelSlide();
                        hideMenu();
                        cancelCollapse();
                        expanded = true;
                        bubbleParams.x = expandedX();
                        bubbleParams.y = clampY(bubbleParams.y);
                        updateBubble();
                        bubbleView.animate().alpha(1f).setDuration(120).start();
                        touchDownX = event.getRawX();
                        touchDownY = event.getRawY();
                        windowDownX = bubbleParams.x;
                        windowDownY = bubbleParams.y;
                        return true;
                    }

                    bubbleParams.x = clampDragX(
                            windowDownX + Math.round(event.getRawX() - touchDownX));
                    bubbleParams.y = clampY(
                            windowDownY + Math.round(event.getRawY() - touchDownY));
                    updateBubble();
                    return true;

                case MotionEvent.ACTION_UP:
                    if (dragging) {
                        dragging = false;
                        side = bubbleParams.x + dp(BUBBLE_DP) / 2 < screenWidth() / 2
                                ? "left"
                                : "right";
                        savePosition();
                        setExpanded(false, true);
                    } else {
                        view.performClick();
                    }
                    return true;

                case MotionEvent.ACTION_CANCEL:
                    if (dragging) {
                        dragging = false;
                        side = bubbleParams.x + dp(BUBBLE_DP) / 2 < screenWidth() / 2
                                ? "left"
                                : "right";
                        savePosition();
                        setExpanded(false, true);
                    }
                    return true;

                default:
                    return false;
            }
        }
    }

    private int clampDragX(int x) {
        int min = dp(EDGE_DP);
        int max = Math.max(min, screenWidth() - dp(BUBBLE_DP) - dp(EDGE_DP));
        return Math.max(min, Math.min(x, max));
    }

    private int clampY(int y) {
        int top = dp(VERTICAL_RESERVE_DP);
        int bottom = screenHeight() - dp(BUBBLE_DP) - dp(VERTICAL_RESERVE_DP);
        return Math.max(top, Math.min(y, Math.max(top, bottom)));
    }

    private int screenWidth() {
        return getResources().getDisplayMetrics().widthPixels;
    }

    private int screenHeight() {
        return getResources().getDisplayMetrics().heightPixels;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
