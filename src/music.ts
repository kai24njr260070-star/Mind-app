import type { Goal, MusicSuggestion, MusicTrack } from "./types";

/**
 * 予定に合わせた音楽の提案(端末内フォールバック + Apple Musicリンク)。
 *
 * Apple Music API のカタログ検索や「最近聴いた曲」の取得には
 * Apple Developer Program の MusicKit 開発者トークンとユーザー認証が必要なため、
 * 鍵が無い状態では「AIの提案 + Apple Music検索リンク」で動かす。
 * リンクは iPad / iPhone では Apple Music アプリが開く。
 */

export type MusicPreference = "auto" | "calm" | "upbeat";

export const MUSIC_PREFERENCE_LABEL: Record<MusicPreference, string> = {
  auto: "おまかせ",
  calm: "静かめ",
  upbeat: "上げたい",
};

const UPBEAT_WORDS = [
  "運動",
  "筋トレ",
  "ランニング",
  "ジョギング",
  "散歩",
  "掃除",
  "家事",
  "料理",
  "遊ぶ",
  "楽し",
  "気分",
  "元気",
  "友達",
  "パーティ",
  "ゲーム",
  "ドライブ",
  "旅行",
  "ダンス",
];

const FOCUS_WORDS = [
  "勉強",
  "学習",
  "作業",
  "仕事",
  "読書",
  "書く",
  "コーディング",
  "開発",
  "制作",
  "資料",
  "集中",
  "課題",
  "レポート",
  "英語",
  "資格",
  "復習",
  "予習",
  "試験",
  "研究",
  "デザイン",
];

/** 目標の文言から雰囲気を推測する(自動選択のとき)。 */
export function inferMusicMood(text: string, preference: MusicPreference = "auto"): "calm" | "upbeat" {
  if (preference === "calm" || preference === "upbeat") return preference;
  const t = text;
  if (UPBEAT_WORDS.some((w) => t.includes(w))) return "upbeat";
  if (FOCUS_WORDS.some((w) => t.includes(w))) return "calm";
  return "calm";
}

const LOCAL_LIBRARY: Record<"calm" | "upbeat", MusicTrack[]> = {
  calm: [
    { title: "Experience", artist: "Ludovico Einaudi", reason: "静かに集中したいときの定番" },
    { title: "Merry Christmas Mr. Lawrence", artist: "坂本龍一", reason: "考える作業に馴染むピアノ" },
    { title: "Clair de Lune", artist: "Claude Debussy", reason: "気持ちを落ち着けたいときに" },
    { title: "Holocene", artist: "Bon Iver", reason: "穏やかな空気で視界をクリアに" },
    { title: "Sunset Lover", artist: "Petit Biscuit", reason: "淡々と手を動かしたいときに" },
  ],
  upbeat: [
    { title: "Levitating", artist: "Dua Lipa", reason: "明るく弾むテンポで背中を押す" },
    { title: "Blinding Lights", artist: "The Weeknd", reason: "軽快に動き出したいときに" },
    { title: "新時代", artist: "Ado", reason: "勢いが欲しい瞬間に" },
    { title: "Uptown Funk", artist: "Mark Ronson, Bruno Mars", reason: "気分を一気に上げる定番" },
    { title: "白日", artist: "King Gnu", reason: "前向きな余韻が残る1曲" },
  ],
};

/** AIが使えないときの端末内候補。 */
export function localMusicSuggestion(
  goal: Goal,
  preference: MusicPreference = "auto",
  taste = ""
): MusicSuggestion {
  const mood = inferMusicMood(`${goal.title} ${goal.description ?? ""}`, preference);
  const tracks = LOCAL_LIBRARY[mood];
  return {
    mood: mood === "calm" ? "集中・落ち着き" : "気分を上げる",
    summary: taste
      ? `端末内の候補です。好み(${taste.slice(0, 24)})を反映するには設定でAIキーを入れてください。`
      : "端末内の候補です。AIキーを設定すると、予定と好みに合わせた曲を提案します。",
    tracks,
    origin: "local",
  };
}

/** Apple Music(またはiTunes)の検索URL。iPadではMusicアプリが開く。 */
export function appleMusicSearchUrl(query: string): string {
  return `https://music.apple.com/jp/search?term=${encodeURIComponent(query.trim())}`;
}

/** 曲の検索リンク。 */
export function appleMusicTrackUrl(track: MusicTrack): string {
  return appleMusicSearchUrl(`${track.title} ${track.artist}`.trim());
}

/** その雰囲気のプレイリスト検索リンク。 */
export function appleMusicPlaylistUrl(mood: string): string {
  return appleMusicSearchUrl(`${mood} プレイリスト`);
}

/* ---------------- 提案のキャッシュ ---------------- */

const CACHE_KEY = "mind-signature-music-v1";
const MAX_ENTRIES = 40;

interface MusicCacheEntry {
  at: number;
  blockId: string;
  preference: MusicPreference;
  suggestion: MusicSuggestion;
}

function readCache(): MusicCacheEntry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: MusicCacheEntry[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function getCachedMusic(
  blockId: string,
  preference: MusicPreference
): MusicSuggestion | null {
  return readCache().find((e) => e.blockId === blockId && e.preference === preference)?.suggestion ?? null;
}

export function setCachedMusic(
  blockId: string,
  preference: MusicPreference,
  suggestion: MusicSuggestion
): void {
  try {
    const items = readCache().filter(
      (e) => !(e.blockId === blockId && e.preference === preference)
    );
    const next = [{ at: Date.now(), blockId, preference, suggestion }, ...items].slice(0, MAX_ENTRIES);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, items: next }));
  } catch {
    // キャッシュできなくても提案自体は表示する
  }
}
