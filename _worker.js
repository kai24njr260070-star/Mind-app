// src/aiShared.ts
var PROVIDER_BASES = {
  freebuff: "https://freebuff.com/api/v1/paid",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1"
};
var PROVIDER_FALLBACK_MODELS = {
  freebuff: "deepseek-v4.1-flash",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  grok: "grok-3-mini"
};
var NON_CHAT_MODEL = /(whisper|transcrib|embed|moderation|rerank|\btts\b|audio|speech|image|dall-e|diffusion|sdxl|\bflux\b|guard|safety|\bocr\b|realtime)/i;
var CHAT_MODEL = /(gpt|claude|llama|gemini|qwen|mistral|mixtral|deepseek|gemma|glm|kimi|grok|command|nova|phi|solar|minimax|mimo|seed|ling|step|granite|nemotron|\bhy\b|laguna|inkling|pareto|trinity|muse|hermes|magistral|devstral|chat)/i;
var PROVIDER_MODEL_PREFERENCE = {
  freebuff: ["deepseek-v4.1-flash", "gemini-2.5-flash", "gpt-4o-mini", "gpt-5-nano"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "qwen"],
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "gpt-5-nano"],
  gemini: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"],
  grok: ["grok-3-mini", "grok-4-fast", "grok-3"]
};
function pickChatModel(ids, provider) {
  const chat = ids.map((id) => String(id ?? "").replace(/^models\//, "").trim()).filter((id) => id.length > 0 && !NON_CHAT_MODEL.test(id) && CHAT_MODEL.test(id));
  if (chat.length === 0) return null;
  const preferred = provider ? PROVIDER_MODEL_PREFERENCE[provider] ?? [] : [];
  for (const want of preferred) {
    const exact = chat.find((id) => id.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const partial = chat.find((id) => id.toLowerCase().includes(want.toLowerCase()));
    if (partial) return partial;
  }
  const cheap = chat.find((id) => /(mini|nano|flash|lite|small|haiku|turbo|fast)/i.test(id));
  return cheap ?? chat[0] ?? null;
}
var FISSION_SYSTEM_PROMPT = `\u3042\u306A\u305F\u306F Mind Signature \u306E\u300CElement Fission(\u76EE\u6A19\u5206\u88C2)\u300D\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002
\u30E6\u30FC\u30B6\u30FC\u306E\u89AA\u76EE\u6A19\u3092\u9054\u6210\u3059\u308B\u305F\u3081\u306E\u4E2D\u9593\u76EE\u6A19\u5019\u88DC\u3092\u3001\u5FC5\u305A2\u3064\u63D0\u6848\u3057\u307E\u3059\u3002

\u30EB\u30FC\u30EB:
- \u5019\u88DC\u306F\u89AA\u76EE\u6A19\u306E\u9054\u6210\u306B\u8CA2\u732E\u3057\u3001\u62BD\u8C61\u5EA6\u3092\u5FC5\u305A1\u6BB5\u968E\u4E0B\u3052\u308B\u3002
- 2\u3064\u306E\u5019\u88DC\u304C\u91CD\u8907\u3057\u306A\u3044\u3088\u3046\u3001\u62C5\u3046\u9818\u57DF\u3092\u660E\u78BA\u306B\u5206\u3051\u308B\u3002
- \u30E6\u30FC\u30B6\u30FC\u304C\u6C7A\u3081\u3066\u3044\u306A\u3044\u60C5\u5831(\u6280\u8853\u9078\u5B9A\u3001\u4E88\u5B9A\u306A\u3069)\u3092\u52DD\u624B\u306B\u78BA\u5B9A\u3057\u306A\u3044\u3002
- \u5404\u5019\u88DC\u306E title \u306F20\u6587\u5B57\u4EE5\u5185\u3001description \u306F35\u6587\u5B57\u4EE5\u5185\u306E1\u6587\u3002
- \u76EE\u6A19\u304C\u65E2\u306B\u300C\u884C\u52D51\u56DE\u3067\u7D42\u308F\u308B\u300D\u898F\u6A21\u306A\u3089\u3001\u3053\u308C\u4EE5\u4E0A\u5206\u88C2\u3055\u305B\u308B\u5FC5\u8981\u306E\u306A\u3044\u5177\u4F53\u30EC\u30D9\u30EB\u3092\u63D0\u6848\u3059\u308B\u3002
- \u51FA\u529B\u306FJSON\u306E\u307F\u3002\u8AAC\u660E\u6587\u306F\u66F8\u304B\u306A\u3044\u3002
- \u5F62\u5F0F: {"candidates":[{"title":"...","description":"..."}]}`;
var REFLECTION_SYSTEM_PROMPT = `\u3042\u306A\u305F\u306F Mind Signature \u306E\u300CReflection\u300D\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3067\u3059\u3002
\u30E6\u30FC\u30B6\u30FC\u3092\u8A55\u4FA1\u30FB\u6279\u5224\u305B\u305A\u3001\u8A08\u753B\u3092\u30E6\u30FC\u30B6\u30FC\u306B\u5408\u308F\u305B\u3066\u8ABF\u6574\u3059\u308B\u63D0\u6848\u306E\u307F\u3092\u884C\u3044\u307E\u3059\u3002

\u30EB\u30FC\u30EB:
- summary \u306F\u4ECA\u65E5\u306E\u72B6\u6CC1\u3092\u7A4F\u3084\u304B\u306B\u307E\u3068\u3081\u305F2\u301C3\u6587(\u65E5\u672C\u8A9E)\u3002
- \u5909\u66F4\u306F\u5FC5\u305A\u63D0\u6848\u3068\u3057\u3066\u793A\u3057\u3001\u5B9F\u884C\u306F\u30E6\u30FC\u30B6\u30FC\u306E\u627F\u8A8D\u5F8C\u3067\u3042\u308B\u3053\u3068\u3092\u524D\u63D0\u306B\u3059\u308B\u3002
- actions \u306F\u6700\u59273\u3064\u3002kind \u306F split(\u76EE\u6A19\u3092\u3055\u3089\u306B\u5206\u88C2) / reschedule(\u671F\u9650\u306E\u5EF6\u671F) / focus(\u4ECA\u65E5\u306E\u4E00\u6B69) / rest(\u4F11\u3080) \u306E\u3044\u305A\u308C\u304B\u3002
- split \u3068 reschedule \u306F goalIdx(\u6E21\u3057\u305F\u76EE\u6A19\u30EA\u30B9\u30C8\u306E\u756A\u53F7)\u3092\u5FC5\u305A\u6307\u5B9A\u3059\u308B\u3002
- reschedule \u306F days(\u5EF6\u3070\u3059\u65E5\u6570\u30011\u301C90)\u3082\u6307\u5B9A\u3059\u308B\u3002\u671F\u9650\u8D85\u904E\u3092\u4EBA\u683C\u7684\u306A\u5931\u6557\u3068\u3057\u3066\u6271\u308F\u306A\u3044\u3002
- label \u306F\u65E5\u672C\u8A9E\u306780\u6587\u5B57\u4EE5\u5185\u306E\u5177\u4F53\u7684\u306A\u63D0\u6848\u6587\u3002
- \u77ED\u671F\u9593\u306E\u30ED\u30B0\u3060\u3051\u3067\u632B\u6298\u30FB\u610F\u6B32\u4F4E\u4E0B\u3092\u65AD\u5B9A\u3057\u306A\u3044\u3002
- \u51FA\u529B\u306FJSON\u306E\u307F\u3002\u5F62\u5F0F: {"summary":"...","actions":[{"goalIdx":0,"kind":"split","label":"...","days":7}]}`;
function fissionContextLines(payload) {
  const parentTitle = String(payload.parent?.title ?? "").trim();
  const ancestors = (payload.ancestors ?? []).filter((t) => typeof t === "string").slice(0, 8);
  const siblings = (payload.siblings ?? []).filter((t) => typeof t === "string").slice(0, 12);
  const depth = Number.isFinite(payload.depth) ? Number(payload.depth) : 0;
  return [
    `\u89AA\u76EE\u6A19: ${parentTitle}`,
    ancestors.length > 0 ? `\u4E0A\u4F4D\u306E\u76EE\u6A19(\u30EB\u30FC\u30C8\u5074): ${ancestors.join(" > ")}` : "",
    siblings.length > 0 ? `\u65E2\u306B\u78BA\u5B9A\u6E08\u307F\u306E\u5144\u5F1F\u76EE\u6A19(\u3053\u308C\u3068\u91CD\u8907\u3057\u306A\u3044\u3053\u3068): ${siblings.join(" / ")}` : "",
    depth >= 3 ? "\u3053\u306E\u76EE\u6A19\u306F\u6D45\u3044\u968E\u5C64\u306B\u3042\u308B\u3002\u884C\u52D5\u30EC\u30D9\u30EB\u306E\u5177\u4F53\u7684\u306A\u5019\u88DC\u306B\u3059\u308B\u3053\u3068\u3002" : ""
  ].filter(Boolean).join("\n");
}
function reflectionContextLines(payload) {
  const todayStr = String(payload.today ?? "").slice(0, 10);
  const goals = (payload.goals ?? []).slice(0, 30);
  const memos = (payload.memos ?? []).slice(0, 12);
  const goalLines = goals.map((g) => {
    const idx = typeof g.idx === "number" ? g.idx : 0;
    const dl = typeof g.deadline === "string" ? ` \u671F\u9650:${g.deadline}` : "";
    const stale = typeof g.daysOld === "number" && g.daysOld >= 7 ? `${g.daysOld}\u65E5\u7D4C\u904E` : "";
    return `[${idx}] ${String(g.title ?? "").slice(0, 60)} (status:${String(g.status ?? "active")}, \u5B50\u76EE\u6A19:${Number.isFinite(g.childCount) ? g.childCount : 0}${dl} ${stale})`;
  }).join("\n");
  const memoLines = memos.length ? memos.map((m) => `${String(m.date ?? "")}: ${String(m.content ?? "").slice(0, 120)}`).join("\n") : "(\u30E1\u30E2\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093)";
  return `\u4ECA\u65E5: ${todayStr}

\u76EE\u6A19\u30EA\u30B9\u30C8:
${goalLines}

\u76F4\u8FD1\u306E\u30E1\u30E2:
${memoLines}`;
}
function fissionRequestBody(model, payload) {
  return {
    model,
    temperature: 0.8,
    max_tokens: 600,
    messages: [
      { role: "system", content: FISSION_SYSTEM_PROMPT },
      { role: "user", content: fissionContextLines(payload) }
    ]
  };
}
function reflectionRequestBody(model, payload) {
  return {
    model,
    temperature: 0.6,
    max_tokens: 700,
    messages: [
      { role: "system", content: REFLECTION_SYSTEM_PROMPT },
      { role: "user", content: reflectionContextLines(payload) }
    ]
  };
}
function parseCandidates(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed = JSON.parse(content.slice(start, end + 1));
  const raw = parsed.candidates;
  if (!Array.isArray(raw)) throw new Error("bad shape");
  return raw.filter((c) => typeof c === "object" && c !== null).map((c) => ({
    title: String(c.title ?? "").trim(),
    description: String(c.description ?? "").trim()
  })).filter((c) => c.title.length > 0).slice(0, 2);
}
function parseReflection(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const parsed = JSON.parse(content.slice(start, end + 1));
  const kinds = /* @__PURE__ */ new Set(["split", "reschedule", "focus", "rest"]);
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = rawActions.filter((a) => typeof a === "object" && a !== null).filter((a) => kinds.has(String(a.kind))).map((a) => ({
    goalIdx: typeof a.goalIdx === "number" ? a.goalIdx : void 0,
    kind: String(a.kind),
    label: String(a.label ?? "").slice(0, 120),
    days: typeof a.days === "number" && Number.isFinite(a.days) ? Math.round(a.days) : void 0
  })).filter((a) => a.label.length > 0).slice(0, 3);
  return { summary: String(parsed.summary ?? "").trim(), actions };
}

// worker/index.ts
var DEFAULT_BASES = PROVIDER_BASES;
var ENV_KEYS = {
  freebuff: "OPENAI_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  grok: "XAI_API_KEY"
};
function requestAIConfig(request, env) {
  const provider = (request.headers.get("x-ai-provider") ?? "freebuff").toLowerCase();
  const headerKey = request.headers.get("x-ai-key")?.trim() ?? "";
  const headerModel = request.headers.get("x-ai-model")?.trim() ?? "";
  const envKey = String(env[ENV_KEYS[provider] ?? "OPENAI_API_KEY"] ?? "").trim();
  const baseUrl = normBaseUrl(DEFAULT_BASES[provider] ?? DEFAULT_BASES.freebuff);
  const key = headerKey || (provider in ENV_KEYS ? envKey : null);
  return { key: key || null, baseUrl, provider, modelHint: headerModel || env.FREEBUFF_MODEL || null };
}
function normBaseUrl(base) {
  return base.replace(/\/+$/, "");
}
async function failureDetail(res) {
  let text = "";
  try {
    text = (await res.text()).slice(0, 300).replace(/\s+/g, " ").trim();
  } catch {
  }
  return `provider ${res.status}${text ? `: ${text}` : ""}`;
}
async function listModels(base, key) {
  const res = await fetch(`${normBaseUrl(base)}/models`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id.length > 0);
}
var cachedModelsByBase = /* @__PURE__ */ new Map();
async function discoverModel(cfg) {
  if (!cfg.key) return null;
  const cacheKey = `${cfg.provider}:${cfg.baseUrl}:${cfg.key.slice(0, 6)}`;
  const cached = cachedModelsByBase.get(cacheKey);
  if (cached) return pickChatModel(cached, cfg.provider);
  try {
    const ids = await listModels(cfg.baseUrl, cfg.key);
    cachedModelsByBase.set(cacheKey, ids);
    return pickChatModel(ids, cfg.provider);
  } catch {
    return null;
  }
}
async function resolveModels(cfg) {
  const models = [];
  const push = (model) => {
    const m = String(model ?? "").trim();
    if (m && !models.includes(m)) models.push(m);
  };
  push(cfg.modelHint);
  if (!cfg.modelHint) push(await discoverModel(cfg));
  push(PROVIDER_FALLBACK_MODELS[cfg.provider]);
  return models;
}
async function chatCompletion(cfg, body) {
  if (!cfg.key) return { ok: false, status: 0, detail: "not_configured" };
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      return { ok: false, status: res.status, detail: await failureDetail(res) };
    }
    const json = await res.json();
    return { ok: true, content: json.choices?.[0]?.message?.content ?? "" };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: e instanceof Error ? `network: ${e.message}` : "network"
    };
  }
}
function shouldRetryWithNextModel(status) {
  return status === 400 || status === 404 || status === 422;
}
async function handleFission(request, env) {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const parentTitle = String(body.parent?.title ?? "").trim();
  if (!parentTitle) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json(
      { error: "ai_failed", detail: "\u30E2\u30C7\u30EB\u3092\u6C7A\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" },
      { status: 502 }
    );
  }
  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(cfg, fissionRequestBody(model, body));
    if (!result.ok) {
      detail = `${model} \u2192 ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      const candidates = parseCandidates(result.content);
      if (candidates.length > 0) return Response.json({ candidates });
      detail = `${model} \u2192 \u5019\u88DC\u3092\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F`;
    } catch {
      detail = `${model} \u2192 JSON\u4EE5\u5916\u306E\u5FDC\u7B54`;
    }
  }
  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}
async function handleReflection(request, env) {
  const cfg = requestAIConfig(request, env);
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const goals = (body.goals ?? []).slice(0, 30);
  if (goals.length === 0) {
    return Response.json({
      summary: "\u307E\u3060\u5B87\u5B99\u306B\u76EE\u6A19\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u6700\u521D\u306E\u76EE\u6A19\u3092\u3072\u3068\u3064\u5165\u529B\u3059\u308B\u3068\u3001AI\u304C\u5206\u88C2\u5019\u88DC\u3092\u51FA\u3057\u307E\u3059\u3002",
      actions: []
    });
  }
  const models = await resolveModels(cfg);
  if (models.length === 0) {
    return Response.json(
      { error: "ai_failed", detail: "\u30E2\u30C7\u30EB\u3092\u6C7A\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" },
      { status: 502 }
    );
  }
  let detail = "";
  for (const model of models) {
    const result = await chatCompletion(
      cfg,
      reflectionRequestBody(model, { ...body, goals })
    );
    if (!result.ok) {
      detail = `${model} \u2192 ${result.detail}`;
      if (shouldRetryWithNextModel(result.status)) continue;
      break;
    }
    try {
      return Response.json(parseReflection(result.content));
    } catch {
      detail = `${model} \u2192 JSON\u4EE5\u5916\u306E\u5FDC\u7B54`;
    }
  }
  return Response.json({ error: "ai_failed", detail }, { status: 502 });
}
async function handleStatus(request, env) {
  const cfg = requestAIConfig(request, env);
  const envConfigured = Boolean(
    env.OPENAI_API_KEY?.trim() || env.GROQ_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || env.XAI_API_KEY?.trim()
  );
  if (!cfg.key || !cfg.baseUrl) {
    return Response.json({ configured: false, ok: false, model: null, error: null, envConfigured });
  }
  const models = await resolveModels(cfg);
  let detail = "\u30E2\u30C7\u30EB\u3092\u6C7A\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F";
  for (const model of models) {
    const result = await chatCompletion(cfg, {
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }]
    });
    if (result.ok) {
      return Response.json({ configured: true, ok: true, model, error: null, envConfigured });
    }
    detail = `${model} \u2192 ${result.detail}`;
    if (!shouldRetryWithNextModel(result.status)) break;
  }
  return Response.json({
    configured: true,
    ok: false,
    model: models[0] ?? null,
    error: detail,
    envConfigured
  });
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/ai/status" && request.method === "GET") {
        return await handleStatus(request, env);
      }
      if (url.pathname === "/api/ai/fission" && request.method === "POST") {
        return await handleFission(request, env);
      }
      if (url.pathname === "/api/ai/reflection" && request.method === "POST") {
        return await handleReflection(request, env);
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  index_default as default
};
