import { todayKey } from "./date";
import { useStore } from "./store";
import { isRecurringTask, isTaskDone } from "./task-state";
import {
  buildWidgetSnapshot,
  consumeWidgetActions,
  pushWidgetSnapshot,
  widgetsSupported,
} from "./widgets";

/**
 * Rebuild the widget snapshot from the live store.
 *
 * Called whenever tasks/logs/sections change, on resume, and on a slow timer.
 * The snapshot is intentionally small; skipping it entirely on the web keeps
 * the subscription in the app shell free.
 */
export async function syncWidgetsFromStore(): Promise<void> {
  if (!widgetsSupported()) return;
  const state = useStore.getState();
  if (!state.ready) return;
  await pushWidgetSnapshot(
    buildWidgetSnapshot({
      tasks: state.tasks,
      logs: state.logs,
      sections: state.sections,
      history: state.history,
      now: new Date(),
    }),
  );
}

/**
 * Apply task completions made from a widget.
 *
 * The widget queues a tap because it cannot write IndexedDB. Two rules keep a
 * queued tap honest:
 *   - a tap is applied at most once (the task is checked before toggling);
 *   - a tap from an earlier day only survives for work whose completion is
 *     not day-scoped. Ticking "Read 20 pages" yesterday must not complete
 *     today's occurrence, but finishing a one-off deadline still counts.
 */
export async function applyWidgetCompletions(): Promise<number> {
  const actions = await consumeWidgetActions();
  if (actions.length === 0) return 0;

  const today = todayKey();
  let applied = 0;

  for (const action of actions) {
    const state = useStore.getState();
    const task = state.tasks.find((candidate) => candidate.id === action.taskId);
    if (!task || task.status === "accomplished" || isTaskDone(task)) continue;

    const dayScoped = isRecurringTask(task) && !task.dueDate;
    if (dayScoped && action.date !== today) continue;

    state.toggleTask(task.id, true);
    applied += 1;
  }

  if (applied > 0) await syncWidgetsFromStore();
  return applied;
}
