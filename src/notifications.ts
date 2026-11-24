import type { Reminder } from "./reminders";

/**
 * ブラウザ通知とアプリ内通知の共通処理。
 * 通知が許可されていない/非対応の環境でも、アプリ内トーストで必ず伝える。
 */

const FIRED_KEY = "mind-signature-reminder-state-v1";
/** 送信済み記録を残す期間。これより古いキーは掃除する。 */
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

type FiredFile = { fired: Record<string, number> };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 送信済みの通知キー(通知の重複防止)。 */
export function loadFiredKeys(now: number = Date.now()): Set<string> {
  const s = storage();
  if (!s) return new Set();
  try {
    const raw = s.getItem(FIRED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Partial<FiredFile>;
    const fired = parsed.fired ?? {};
    return new Set(
      Object.entries(fired)
        .filter(([, at]) => typeof at === "number" && now - at < KEEP_MS)
        .map(([key]) => key)
    );
  } catch {
    return new Set();
  }
}

/** 通知したキーを記録する(古い記録は掃除する)。 */
export function markFired(keys: string[], now: number = Date.now()): void {
  const s = storage();
  if (!s || keys.length === 0) return;
  try {
    const raw = s.getItem(FIRED_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<FiredFile>) : {};
    const next: Record<string, number> = {};
    for (const [key, at] of Object.entries(parsed.fired ?? {})) {
      if (typeof at === "number" && now - at < KEEP_MS) next[key] = at;
    }
    for (const key of keys) next[key] = now;
    s.setItem(FIRED_KEY, JSON.stringify({ fired: next } satisfies FiredFile));
  } catch {
    // 記録できなくても通知自体は行う(その場合セッション内の重複は起こりうる)
  }
}

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** 通知許可を要求する(ユーザー操作から呼ぶこと)。 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** OSの通知を出す(許可済みのときだけ)。 */
export function showSystemNotification(reminder: Reminder): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(reminder.title, {
      body: reminder.body,
      tag: reminder.key,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // 通知APIが使えない場合はアプリ内トーストだけにする
  }
}
