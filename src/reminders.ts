import type { Goal, GoalBlock } from "./types";

/**
 * 予定のリマインド判定(純粋関数)。
 *
 * - 目標の実行予定(何時から何時まで)に対し、1時間前・10分前・開始時刻に通知する
 * - 8:00〜22:00 の間、30分おきに「明日の予定は作りましたか？」と促す
 *   (明日の予定が1件でも入っていれば止める = 予定づくりを後押しする)
 *
 * 通知の送信そのものは notifications.ts / ReminderHost.tsx が担当する。
 */

export type ReminderKind = "lead60" | "lead10" | "start" | "nudge";

export interface Reminder {
  /** 重複送信を防ぐための一意キー */
  key: string;
  kind: ReminderKind;
  title: string;
  body: string;
  goalId?: string;
  blockId?: string;
  /** 本来の通知時刻(epoch ms) */
  at: number;
}

/** 通知を出すリードタイム(分)。 */
export const LEAD_MINUTES = [60, 10, 0] as const;

/** 予定時刻を過ぎてから通知する猶予。次のリードタイムと重ならない5分にする。 */
export const DUE_WINDOW_MS = 5 * 60 * 1000;

/** 明日の予定づくりナッジの開始・終了時刻と間隔。 */
export const NUDGE_START_HOUR = 8;
export const NUDGE_END_HOUR = 22;
export const NUDGE_SLOT_MINUTES = 30;
/** スロット(例: 8:00)から何分以内なら通知するか。 */
export const NUDGE_WINDOW_MINUTES = 4;

/** 端末のローカル日付(YYYY-MM-DD)。UTCにすると日本時間の朝が前日になるため使わない。 */
export function localDateISO(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" + "HH:MM" を端末ローカルの Date にする。不正なら null。 */
export function parseBlockTime(date: string, hm: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!dm || !tm) return null;
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 予定の開始・終了時刻。終了が開始以前なら1時間後として扱う。 */
export function blockRange(block: GoalBlock): { start: Date; end: Date } | null {
  const start = parseBlockTime(block.date, block.start);
  if (!start) return null;
  const end = parseBlockTime(block.date, block.end);
  if (!end || end.getTime() <= start.getTime()) {
    return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
  }
  return { start, end };
}

function reminderFor(
  block: GoalBlock,
  goal: Goal,
  lead: (typeof LEAD_MINUTES)[number]
): Reminder {
  const kind: ReminderKind = lead === 60 ? "lead60" : lead === 10 ? "lead10" : "start";
  const leadLabel = lead === 60 ? "1時間前" : lead === 10 ? "10分前" : "開始時刻";
  return {
    key: `${block.id}:${kind}`,
    kind,
    goalId: goal.id,
    blockId: block.id,
    at: 0,
    title: lead === 0 ? `開始時刻です: ${goal.title}` : `${leadLabel}: ${goal.title}`,
    body:
      lead === 0
        ? `${block.start}〜${block.end} の予定です。今から実行しましょう。`
        : `${block.start}〜${block.end} の予定です。そろそろ準備を始めましょう。`,
  };
}

/**
 * いま通知すべき予定リマインドを返す。
 * fired には送信済みキーを渡し、同じ通知を繰り返さない。
 */
export function dueBlockReminders(
  blocks: GoalBlock[],
  goals: Goal[],
  now: Date,
  fired: ReadonlySet<string>
): Reminder[] {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const nowMs = now.getTime();
  const out: Reminder[] = [];

  for (const block of blocks) {
    const goal = goalById.get(block.goalId);
    // 完了した目標には通知しない
    if (!goal || goal.status === "completed") continue;
    const range = blockRange(block);
    if (!range) continue;
    // 終了して1日以上たった予定は拾わない
    if (range.end.getTime() < nowMs - 24 * 60 * 60 * 1000) continue;

    for (const lead of LEAD_MINUTES) {
      const target = range.start.getTime() - lead * 60 * 1000;
      const delta = nowMs - target;
      if (delta < 0 || delta > DUE_WINDOW_MS) continue;
      const reminder = reminderFor(block, goal, lead);
      if (fired.has(reminder.key)) continue;
      out.push({ ...reminder, at: target });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/**
 * 明日の予定づくりナッジ。
 * 8:00〜22:00 の各30分スロットの頭5分で、明日の予定が空のときだけ返す。
 * 予定が1件でも入れば返さない(入れるまで繰り返し促す)。
 */
export function planningNudge(
  now: Date,
  tomorrowPlanned: number,
  enabled: boolean
): Reminder | null {
  if (!enabled || tomorrowPlanned > 0) return null;
  const hour = now.getHours();
  if (hour < NUDGE_START_HOUR || hour > NUDGE_END_HOUR) return null;

  const slotMinute = Math.floor(now.getMinutes() / NUDGE_SLOT_MINUTES) * NUDGE_SLOT_MINUTES;
  if (now.getMinutes() - slotMinute > NUDGE_WINDOW_MINUTES) return null;
  // 22:30 は出さない
  if (hour === NUDGE_END_HOUR && slotMinute > 0) return null;

  const slot = `${String(hour).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`;
  return {
    key: `nudge:${localDateISO(now)}T${slot}`,
    kind: "nudge",
    at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, slotMinute).getTime(),
    title: "明日の予定は作りましたか？",
    body: "明日の実行時間がまだ空です。中目標を開いて「8:00〜8:30」のような予定を入れておきましょう。",
  };
}
