import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";

/**
 * Worker経由の生成が「一覧の先頭モデル」を送って失敗する回帰を防ぐ。
 * 特に Groq の /models は whisper 等の非chatモデルを含むため、
 * 先頭をそのまま使うと生成だけ 400 で失敗していた。
 */

const env = {
  ASSETS: { fetch: async () => new Response("static asset", { status: 200 }) },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fissionRequest(provider: string, key: string): Request {
  return new Request("https://example.com/api/ai/fission", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-provider": provider,
      "x-ai-key": key,
    },
    body: JSON.stringify({ parent: { title: "AIを作る" }, ancestors: [], siblings: [], depth: 0 }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkerのAI生成", () => {
  it("Groqの一覧に非chatモデルが先頭でもchatモデルを選ぶ", async () => {
    const chatBodies: Array<{ model?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/models")) {
          return jsonResponse({
            object: "list",
            data: [
              { id: "whisper-large-v3" },
              { id: "llama-guard-3-8b" },
              { id: "llama-3.3-70b-versatile" },
            ],
          });
        }
        chatBodies.push(JSON.parse(String(init?.body)) as { model?: string });
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({ candidates: [{ title: "学習計画", description: "基礎を固める" }] }),
              },
            },
          ],
        });
      })
    );

    const res = await worker.fetch(fissionRequest("groq", "gsk_key_a"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [{ title: "学習計画", description: "基礎を固める" }],
    });
    expect(chatBodies[0]?.model).toBe("llama-3.3-70b-versatile");
  });

  it("一覧が取れないFreebuffは既定のchatモデルへフォールバックする", async () => {
    const chatBodies: Array<{ model?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/models")) return jsonResponse({ error: "not found" }, 404);
        chatBodies.push(JSON.parse(String(init?.body)) as { model?: string });
        return jsonResponse({
          choices: [
            { message: { content: JSON.stringify({ candidates: [{ title: "候補", description: "説明" }] }) } },
          ],
        });
      })
    );

    const res = await worker.fetch(fissionRequest("freebuff", "sk_key_b"), env);
    expect(res.status).toBe(200);
    expect(chatBodies[0]?.model).toBe("deepseek-v4.1-flash");
  });

  it("生成できない場合は理由(detail)を返し、キーは含めない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) return jsonResponse({ data: [{ id: "llama-3.3-70b-versatile" }] });
        return jsonResponse({ error: { message: "Invalid API Key" } }, 401);
      })
    );

    const res = await worker.fetch(fissionRequest("groq", "gsk_secret_value"), env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("ai_failed");
    expect(body.detail).toContain("401");
    expect(body.detail).not.toContain("gsk_secret_value");
  });

  it("接続テストは /models ではなく実際の生成で判定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) return jsonResponse({ data: [{ id: "llama-3.3-70b-versatile" }] });
        return jsonResponse({ error: { message: "model_not_found" } }, 404);
      })
    );

    const req = new Request("https://example.com/api/ai/status", {
      headers: { "x-ai-provider": "groq", "x-ai-key": "gsk_key_c" },
    });
    const res = await worker.fetch(req, env);
    const body = (await res.json()) as { configured: boolean; ok: boolean; error: string | null };
    expect(body.configured).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("404");
  });
});
