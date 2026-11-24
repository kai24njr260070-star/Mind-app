import { useCallback, useEffect, useState } from "react";
import type { Goal, GoalBlock, MusicSuggestion } from "./types";
import { getSettings } from "./store";
import { FissionApiError, requestMusicSuggestions } from "./api";
import {
  appleMusicPlaylistUrl,
  appleMusicTrackUrl,
  getCachedMusic,
  localMusicSuggestion,
  MUSIC_PREFERENCE_LABEL,
  setCachedMusic,
  type MusicPreference,
} from "./music";
import { blockRange } from "./reminders";

const PREFERENCES: MusicPreference[] = ["auto", "calm", "upbeat"];

/** AI提案の失敗理由を、内部コードではなく利用者向けの言葉にする。 */
function reasonLabel(err: unknown): string {
  if (err instanceof FissionApiError) {
    if (err.kind === "not_configured") return "AIキーが未設定";
    if (err.kind === "cors_blocked") return "この配信方法ではAIを直接呼べません";
    if (err.kind === "network") return "通信できません";
    return err.detail ?? "AIの提案に失敗しました";
  }
  return err instanceof Error ? err.message : "AIの提案に失敗しました";
}

function durationMinutes(block: GoalBlock): number {
  const range = blockRange(block);
  if (!range) return 0;
  return Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 60000));
}

/**
 * 予定(何時から何時まで)に合わせた音楽の提案。
 * AIキーが無い/失敗したときは端末内の候補へフォールバックする。
 */
export function MusicPanel({
  goal,
  block,
  active,
}: {
  goal: Goal;
  block: GoalBlock;
  active: boolean;
}): React.JSX.Element {
  const [preference, setPreference] = useState<MusicPreference>("auto");
  const [suggestion, setSuggestion] = useState<MusicSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const taste = getSettings().musicTaste;
    try {
      const res = await requestMusicSuggestions({
        goalTitle: goal.title,
        goalDescription: goal.description,
        start: block.start,
        end: block.end,
        durationMinutes: durationMinutes(block),
        preference,
        taste,
      });
      const next: MusicSuggestion = { ...res, origin: "ai" };
      setCachedMusic(block.id, preference, next);
      setSuggestion(next);
    } catch (e) {
      const local = localMusicSuggestion(goal, preference, taste);
      setCachedMusic(block.id, preference, local);
      setSuggestion(local);
      setError(reasonLabel(e));
    } finally {
      setLoading(false);
    }
  }, [block, goal, preference]);

  useEffect(() => {
    const cached = getCachedMusic(block.id, preference);
    if (cached) {
      setSuggestion(cached);
      setError(null);
      return;
    }
    setSuggestion(null);
    // 実行中の予定だけは開いたときに自動で提案する(それ以外はボタンで)
    if (active) void generate();
  }, [block.id, preference, active, generate]);

  return (
    <section className="sheet-music" aria-label="音楽">
      <h3 className="sheet-section">音楽</h3>
      <p className="page-note">
        {active ? "いま実行中の予定" : "この予定"}({block.start}〜{block.end})に合う曲を提案します。
      </p>

      <div className="row music-controls">
        {PREFERENCES.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn ghost small ${preference === p ? "on" : ""}`}
            aria-pressed={preference === p}
            onClick={() => setPreference(p)}
          >
            {MUSIC_PREFERENCE_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          className="btn primary small"
          onClick={() => void generate()}
          disabled={loading}
        >
          {loading ? "選曲中…" : suggestion ? "別の提案" : "AIに提案してもらう"}
        </button>
      </div>

      {error && (
        <p className="page-note err">AIの提案に失敗したため端末内の候補を表示しています({error})</p>
      )}

      {suggestion && (
        <>
          <p className="music-summary">
            <strong>{suggestion.mood}</strong>
            {suggestion.summary ? ` — ${suggestion.summary}` : ""}
          </p>
          <ul className="music-list">
            {suggestion.tracks.map((t) => (
              <li key={`${t.title}-${t.artist}`} className="music-row">
                <div className="music-text">
                  <span className="music-title">{t.title}</span>
                  {t.artist && <span className="music-artist">{t.artist}</span>}
                  {t.reason && <span className="music-reason">{t.reason}</span>}
                </div>
                <a
                  className="btn ghost small music-link"
                  href={appleMusicTrackUrl(t)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apple Music
                </a>
              </li>
            ))}
          </ul>
          <a
            className="page-note music-playlist"
            href={appleMusicPlaylistUrl(suggestion.mood)}
            target="_blank"
            rel="noreferrer"
          >
            この雰囲気のプレイリストを探す ↗
          </a>
          <p className="page-note">
            曲はApple Musicの検索リンクで開きます(iPad/iPhoneはMusicアプリが起動)。再生や「最近聴いた曲」の取得にはMusicKitの開発者トークンとユーザー認証が必要です。
          </p>
        </>
      )}
    </section>
  );
}
