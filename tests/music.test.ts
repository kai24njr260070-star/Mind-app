import { describe, expect, it } from "vitest";
import { parseMusic } from "../src/aiShared";
import {
  appleMusicSearchUrl,
  appleMusicTrackUrl,
  inferMusicMood,
  localMusicSuggestion,
} from "../src/music";
import type { Goal } from "../src/types";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    parentId: null,
    title: "英語の勉強",
    description: "TOEICの復習",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    source: "manual",
    orderIndex: 0,
    ...overrides,
  };
}

describe("音楽の雰囲気", () => {
  it("勉強・作業は静かめ", () => {
    expect(inferMusicMood("英語の勉強", "auto")).toBe("calm");
    expect(inferMusicMood("資料作成", "auto")).toBe("calm");
  });

  it("運動・気分転換は上げる", () => {
    expect(inferMusicMood("筋トレ", "auto")).toBe("upbeat");
    expect(inferMusicMood("友達と遊ぶ", "auto")).toBe("upbeat");
  });

  it("手動の希望は推測より優先する", () => {
    expect(inferMusicMood("英語の勉強", "upbeat")).toBe("upbeat");
    expect(inferMusicMood("筋トレ", "calm")).toBe("calm");
  });
});

describe("端末内の候補", () => {
  it("曲名とアーティストを持つ候補を返す", () => {
    const s = localMusicSuggestion(goal(), "auto");
    expect(s.origin).toBe("local");
    expect(s.tracks.length).toBeGreaterThan(0);
    expect(s.tracks.every((t) => t.title.length > 0 && t.artist.length > 0)).toBe(true);
  });

  it("好みが入っていれば案内文に反映する", () => {
    const s = localMusicSuggestion(goal(), "calm", "ピアノ");
    expect(s.summary).toContain("ピアノ");
  });
});

describe("Apple Musicリンク", () => {
  it("検索URLに曲名とアーティストを入れる", () => {
    const url = appleMusicTrackUrl({ title: "Experience", artist: "Ludovico Einaudi" });
    expect(url).toBe("https://music.apple.com/jp/search?term=Experience%20Ludovico%20Einaudi");
  });

  it("日本語もエンコードする", () => {
    expect(appleMusicSearchUrl("集中 プレイリスト")).toContain("%E9%9B%86%E4%B8%AD");
  });
});

describe("AI応答の解析", () => {
  it("前後の説明文があってもJSONを読む", () => {
    const parsed = parseMusic(
      'はい。\n```json\n{"mood":"集中","summary":"静かに作業できます","tracks":[{"title":"Time","artist":"Hans Zimmer","reason":"没頭できる"}]}\n```'
    );
    expect(parsed.mood).toBe("集中");
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.artist).toBe("Hans Zimmer");
  });

  it("曲が無ければ例外", () => {
    expect(() => parseMusic('{"mood":"集中","tracks":[]}')).toThrow();
  });
});
