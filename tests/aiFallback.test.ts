import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FissionApiError, requestAIStatus, requestFissionCandidates } from "../src/api";
import { MemoryStorage } from "./memoryStorage";

const SETTINGS_KEY = "mind-signature-settings-v1";

type Call = { url: string; init?: RequestInit };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Cloudflare Pages のような /api を持たない静的配信の応答。 */
function staticHostResponse(): Response {
  return new Response("<!doctype html><html></html>", {
    status: 404,
    headers: { "content-type": "text/html" },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return await handler(url, init);
    })
  );
  return calls;
}

const payload = {
  parent: { title: "AIを開発する" },
  ancestors: ["宇宙"],
  siblings: [],
  depth: 1,
};

describe("静的ホスティングでのブラウザ直結", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ providerId: "groq", apiKey: "gsk_test_key", aiModel: "" })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/api が無ければ Groq へ直接chatを送る", async () => {
    const calls = stubFetch((url) => {
      if (url.startsWith("/api/")) return staticHostResponse();
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ candidates: [{ title: "学習計画", description: "基礎を固める" }] }),
            },
          },
        ],
      });
    });

    const out = await requestFissionCandidates(payload);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("学習計画");

    const direct = calls.find((c) => c.url.startsWith("https://api.groq.com/openai/v1/chat/completions"));
    expect(direct).toBeTruthy();
    expect((direct?.init?.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test_key");
    const body = JSON.parse(String(direct?.init?.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.messages).toHaveLength(2);
  });

  it("WorkerのAPIが使える場合はブラウザ直結しない", async () => {
    const calls = stubFetch((url) => {
      if (url === "/api/ai/fission") {
        return jsonResponse({ candidates: [{ title: "Worker候補", description: "サーバー経由" }] });
      }
      return staticHostResponse();
    });

    const out = await requestFissionCandidates(payload);
    expect(out[0]?.title).toBe("Worker候補");
    expect(calls.some((c) => c.url.startsWith("https://api.groq.com"))).toBe(false);
  });

  it("キー未設定なら not_configured を返す", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ providerId: "groq", apiKey: "", aiModel: "" }));
    stubFetch(() => staticHostResponse());

    await expect(requestFissionCandidates(payload)).rejects.toBeInstanceOf(FissionApiError);
    await expect(requestFissionCandidates(payload)).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("接続テストも直結で確認できる", async () => {
    stubFetch((url) => {
      if (url.startsWith("/api/")) return staticHostResponse();
      return jsonResponse({ data: [{ id: "llama-3.3-70b-versatile" }] });
    });

    const status = await requestAIStatus();
    expect(status.ok).toBe(true);
    expect(status.model).toBe("llama-3.3-70b-versatile");
  });

  it("直結がCORS等で失敗したら network として扱う", async () => {
    stubFetch((url) => {
      if (url.startsWith("/api/")) return staticHostResponse();
      throw new TypeError("Failed to fetch");
    });

    await expect(requestFissionCandidates(payload)).rejects.toMatchObject({ kind: "network" });
  });
});
