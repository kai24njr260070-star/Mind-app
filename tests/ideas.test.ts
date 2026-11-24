import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIdeas } from "../src/aiShared";
import { ensureIdeas, LOCAL_IDEAS, pickIdeas } from "../src/ideaHints";
import { MemoryStorage } from "./memoryStorage";

describe("目標づくりのヒント", () => {
  it("AI応答から例を取り出す(説明文つきでも読む)", () => {
    const ideas = parseIdeas(
      'はい。\n```json\n{"ideas":[{"title":"毎朝10分、英語の音読をする","why":"小さく続けられる"},{"title":"週3回、20分の筋トレ"}]}\n```'
    );
    expect(ideas).toHaveLength(2);
    expect(ideas[0]?.title).toContain("英語");
    expect(ideas[0]?.why).toBe("小さく続けられる");
  });

  it("例が空なら例外", () => {
    expect(() => parseIdeas('{"ideas":[]}')).toThrow();
  });

  it("端末内の例は重複しない", () => {
    const titles = LOCAL_IDEAS.map((i) => i.title);
    expect(titles.length).toBeGreaterThanOrEqual(5);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("指定件数だけ重複なく選ぶ", () => {
    const picked = pickIdeas(3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.title)).size).toBe(3);
  });
});

describe("AIが使えないとき", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("例外を投げず端末内の例を返す", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      })
    );
    const ideas = await ensureIdeas({ context: "onboarding" });
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.some((i) => i.title.length > 0)).toBe(true);
  });
});
