import type { Goal, Memo } from "./types";

export type CommandKind = "view" | "goal" | "memo";

export interface CommandItem {
  /** "goal:xxx" のような一意キー */
  key: string;
  kind: CommandKind;
  /** goal/memo のID、view の場合は遷移先ビュー */
  refId: string;
  label: string;
  sub: string;
}

const VIEWS: Array<{ id: string; label: string; sub: string }> = [
  { id: "universe", label: "宇宙", sub: "星のツリーを表示" },
  { id: "memo", label: "メモ", sub: "日次メモ" },
  { id: "calendar", label: "暦", sub: "期限カレンダー" },
  { id: "reflection", label: "振り返り", sub: "振り返り提案" },
  { id: "settings", label: "設定", sub: "AI・データ管理" },
];

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text;
  return line.trim().slice(0, 60);
}

/** 目標・メモ・画面を1本の検索インデックスにまとめる。 */
export function buildItems(goals: Goal[], memos: Memo[]): CommandItem[] {
  const items: CommandItem[] = VIEWS.map((v) => ({
    key: `view:${v.id}`,
    kind: "view",
    refId: v.id,
    label: v.label,
    sub: v.sub,
  }));
  for (const g of goals) {
    items.push({
      key: `goal:${g.id}`,
      kind: "goal",
      refId: g.id,
      label: g.title,
      sub: g.status === "completed" ? "完了した目標" : g.deadline ? `期限 ${g.deadline}` : "目標",
    });
  }
  for (const m of memos) {
    items.push({
      key: `memo:${m.id}`,
      kind: "memo",
      refId: m.id,
      label: firstLine(m.content),
      sub: `${m.date} のメモ`,
    });
  }
  return items;
}

/**
 * 検索。空白区切りの語はすべて一致する必要がある。
 * 前方一致 > 部分一致 > 補足欄一致 の順に優先し、短いラベルを上位にする。
 */
export function searchItems(items: CommandItem[], query: string, limit = 8): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: CommandItem; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const sub = item.sub.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      if (label.startsWith(term)) score += 6;
      else if (label.includes(term)) score += 3;
      else if (sub.includes(term)) score += 1;
      else {
        matchedAll = false;
        break;
      }
    }
    if (!matchedAll) continue;
    // 短いラベルの方が目的の項目に近い
    score += Math.max(0, 4 - Math.min(4, Math.floor(label.length / 8)));
    scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.label.length - b.item.label.length ||
      a.item.label.localeCompare(b.item.label, "ja")
  );
  return scored.slice(0, limit).map((s) => s.item);
}
