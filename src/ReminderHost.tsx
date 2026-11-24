import { useEffect, useRef, useState } from "react";
import { getSettings } from "./store";
import { useAppState } from "./useAppState";
import { dueBlockReminders, localDateISO, planningNudge, type Reminder } from "./reminders";
import { loadFiredKeys, markFired, showSystemNotification } from "./notifications";

/**
 * 予定リマインドの実行役。
 * 20秒ごとに「1時間前・10分前・開始時刻」と「明日の予定づくりナッジ」を判定し、
 * OS通知(許可時)とアプリ内トーストの両方で知らせる。
 * ※Webアプリのため、通知が届くのはアプリを開いている間だけ。
 */
export function ReminderHost(): React.JSX.Element | null {
  const state = useAppState();
  const [toast, setToast] = useState<Reminder | null>(null);
  // 予定や目標が変わるたびにintervalを作り直さないよう、最新値はrefで参照する
  const latest = useRef(state);
  latest.current = state;

  const { reminders, planningNudge: nudgeEnabled } = getSettings();

  useEffect(() => {
    if (!reminders) return;
    let disposed = false;

    const tick = (): void => {
      const now = new Date();
      const { blocks, goals } = latest.current;
      const settingsNow = getSettings();
      if (!settingsNow.reminders) return;

      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
      const tomorrowISO = localDateISO(tomorrow);
      const tomorrowPlanned = blocks.filter((b) => b.date === tomorrowISO).length;

      const fired = loadFiredKeys(now.getTime());
      const due = dueBlockReminders(blocks, goals, now, fired);
      const nudge = planningNudge(now, tomorrowPlanned, settingsNow.planningNudge);
      const pending = nudge && !fired.has(nudge.key) ? [...due, nudge] : due;
      if (pending.length === 0) return;

      markFired(
        pending.map((r) => r.key),
        now.getTime()
      );
      for (const reminder of pending) showSystemNotification(reminder);
      if (!disposed) setToast(pending[pending.length - 1]);
    };

    tick();
    const id = window.setInterval(tick, 20_000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [reminders, nudgeEnabled]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 12_000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="reminder-toast" role="status" aria-live="polite">
      <div className="reminder-toast-body">
        <strong>{toast.title}</strong>
        <p>{toast.body}</p>
      </div>
      <button
        type="button"
        className="reminder-toast-close"
        aria-label="通知を閉じる"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
