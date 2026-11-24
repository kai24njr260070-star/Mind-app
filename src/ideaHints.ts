import { requestIdeaHints } from "./api";
import type { GoalIdea } from "./types";

/**
 * 目標づくりのヒント。
 * AIに一般的な例を作らせる(他の利用者のデータは一切使わない)。
 * AIキーが無い/失敗したときは端末内の例を出す。
 */

export const LOCAL_IDEAS: GoalIdea[] = [
  { title: "毎朝10分、英語の音読をする", why: "小さく毎日続けられる" },
  { title: "3ヶ月でTOEIC700点を取る", why: "期限と数値があると進めやすい" },
  { title: "週3回、20分の筋トレを続ける", why: "回数と時間を決めると迷わない" },
  { title: "半年で副業の月1万円を作る", why: "金額を小さくすると始めやすい" },
  { title: "毎月1冊、仕事に役立つ本を読む", why: "月1冊なら無理なく続く" },
  { title: "寝る前30分、スマホを置いて読書する", why: "きっかけを習慣に結びつける" },
  { title: "毎週日曜に1週間の予定を30分見直す", why: "振り返りの時間を先に確保する" },
  { title: "ポートフォリオ用の作品を1つ公開する", why: "完成の形がはっきりしている" },
  { title: "月2回、家族と食事の時間をつくる", why: "回数を決めると予定に入れやすい" },
  { title: "1日5分、日記を書く", why: "負担が少なく続けやすい" },
];

const CACHE_KEY = "mind-signature-idea-hints-v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let pool: GoalIdea[] = [...LOCAL_IDEAS];
let loaded = false;
let inflight: Promise<GoalIdea[]> | null = null;

function readCache(now: number): GoalIdea[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; ideas?: GoalIdea[] };
    if (typeof parsed.at !== "number" || now - parsed.at > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.ideas)) return null;
    const ideas = parsed.ideas.filter(
      (i) => typeof i?.title === "string" && i.title.trim().length > 0
    );
    return ideas.length > 0 ? ideas : null;
  } catch {
    return null;
  }
}

function writeCache(ideas: GoalIdea[], now: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, ideas }));
  } catch {
    // キャッシュできなくても表示は続ける
  }
}

function merge(aiIdeas: GoalIdea[]): GoalIdea[] {
  const seen = new Set<string>();
  const out: GoalIdea[] = [];
  for (const idea of [...aiIdeas, ...LOCAL_IDEAS]) {
    const key = idea.title.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(idea);
  }
  return out;
}

/** いま使えるヒント(初回はローカルのみ)。 */
export function currentIdeas(): GoalIdea[] {
  if (!loaded) {
    loaded = true;
    const cached = readCache(Date.now());
    if (cached) pool = merge(cached);
  }
  return pool;
}

/**
 * AIにヒントを作らせる。同日中はキャッシュを使い、同時呼び出しは1回にまとめる。
 * 失敗しても端末内の例を返す(例外を投げない)。
 */
export async function ensureIdeas(payload: {
  goals?: string[];
  context?: string;
}): Promise<GoalIdea[]> {
  const base = currentIdeas();
  const cached = readCache(Date.now());
  if (cached) return merge(cached);
  if (inflight) return inflight;

  inflight = requestIdeaHints(payload)
    .then((ideas) => {
      if (ideas.length > 0) {
        pool = merge(ideas);
        writeCache(ideas, Date.now());
      }
      return pool;
    })
    .catch(() => base)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** プールから n 件を順不同で選ぶ(直前と同じ並びは避ける)。 */
export function pickIdeas(n: number, from: GoalIdea[] = currentIdeas()): GoalIdea[] {
  const list = [...from];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(0, n));
}
