import { useRef, useState } from "react";
import { clearAllData, exportData, getSettings, importData, updateSettings } from "./store";
import { useAppState } from "./useAppState";
import { requestAIStatus } from "./api";

const PROVIDERS: Array<{ id: string; label: string; hint: string; keyHint: string }> = [
  { id: "freebuff", label: "Freebuff(既定)", hint: "https://freebuff.com/api/v1/paid", keyHint: "freebuff.com アカウント → Developer API で発行" },
  { id: "groq", label: "Groq", hint: "https://api.groq.com/openai/v1", keyHint: "console.groq.com の API keys" },
  { id: "openai", label: "OpenAI", hint: "https://api.openai.com/v1", keyHint: "platform.openai.com の API keys" },
  { id: "gemini", label: "Google Gemini", hint: "generativelanguage.googleapis.com (OpenAI互換)", keyHint: "Google AI Studio の API key" },
  { id: "grok", label: "xAI Grok", hint: "https://api.x.ai/v1", keyHint: "console.x.ai の API keys" },
];

type Status = Awaited<ReturnType<typeof requestAIStatus>>;

/** 設定画面(spec §9)。テーマ・音・アニメ・AI設定・データ管理を扱う。 */
export function SettingsView(): React.JSX.Element {
  useAppState();
  const s = getSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [aiStatus, setAIStatus] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [aiResult, setAIResult] = useState<Status | null>(null);

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mind-signature-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("バックアップを書き出しました。");
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (window.confirm("現在のデータをファイルの内容で上書きします。よろしいですか?")) {
        const res = importData(String(reader.result));
        setMsg(res.ok ? "読み込みました。" : `読み込みに失敗しました: ${res.error}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="page">
      <div className="page-block">
        <h3 className="page-subtitle">体験</h3>
        <label className="setting-row">
          <span>起動アニメーションをスキップ</span>
          <input
            type="checkbox"
            checked={s.skipStartup}
            onChange={(e) => updateSettings({ skipStartup: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>効果音(起動・分裂の電子音)</span>
          <input
            type="checkbox"
            checked={s.sound}
            onChange={(e) => updateSettings({ sound: e.target.checked })}
          />
        </label>
        <p className="page-note">アニメーション/効果音は既定で控えめに設定されています。OSの「動きを減らす」設定にも従います。</p>
      </div>

      <div className="page-block">
        <h3 className="page-subtitle">AI</h3>
        <p className="page-note">
          分裂候補・振り返りの生成はサーバー側(Worker)で行われ、入力したキーがブラウザ以外で保存されたり、
          画面に誤って表示されることはありません。OpenAI互換(chat/completions)のプロバイダを選べます。
        </p>

        <label className="setting-row">
          <span>プロバイダ</span>
          <select
            value={s.providerId}
            onChange={(e) => updateSettings({ providerId: e.target.value })}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <p className="page-note">
          既定エンドポイント: <code>{PROVIDERS.find((p) => p.id === s.providerId)?.hint}</code>
          <br />
          キーの入手先: {PROVIDERS.find((p) => p.id === s.providerId)?.keyHint}
        </p>

        <label className="setting-col">
          <span>APIキー</span>
          <input
            type="password"
            value={s.apiKey}
            placeholder="sk-… / gsk_… / AIza… / xai-…"
            autoComplete="off"
            onChange={(e) => updateSettings({ apiKey: e.target.value })}
          />
        </label>

        <label className="setting-col">
          <span>モデル(空欄なら自動選択)</span>
          <input
            type="text"
            value={s.aiModel}
            placeholder={s.providerId === "gemini" ? "gemini-2.5-flash" : s.providerId === "grok" ? "grok-3-mini" : s.providerId === "groq" ? "llama-3.3-70b-versatile" : s.providerId === "openai" ? "gpt-4o-mini" : "自動"}
            onChange={(e) => updateSettings({ aiModel: e.target.value })}
          />
        </label>

        <div className="row ai-status-row">
          <button
            className="btn"
            disabled={aiStatus === "checking"}
            onClick={async () => {
              setAIStatus("checking");
              setAIResult(null);
              // 直前に入力した値を確実に反映させるため、保存済み設定で検査
              const res = await requestAIStatus();
              setAIResult(res);
              setAIStatus(res.ok ? "ok" : "failed");
            }}
          >
            接続テスト
          </button>
          {aiStatus === "checking" && <span className="page-note">確認中…</span>}
          {aiStatus === "ok" && (
            <span className="page-note ok">接続OK(モデル: {aiResult?.model})</span>
          )}
          {aiStatus === "failed" && (
            <span className="page-note err">
              接続できません{aiResult?.error ? `(${aiResult.error})` : ""}。キー/Base URL/モデルを確認してください。
            </span>
          )}
        </div>

        <p className="page-note">
          {aiResult?.envConfigured || s.apiKey
            ? "キーが設定されています(Freebuff既定ではWorkerの環境変数キーを優先)。"
            : "キー未設定でも、手動分裂と端末内の簡易振り返り判定で機能は継続します。"}
        </p>
      </div>

      <div className="page-block">
        <h3 className="page-subtitle">データ管理</h3>
        <div className="row">
          <button className="btn" onClick={doExport}>バックアップを書き出す</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>ファイルから復元</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = "";
            }}
          />
          <button
            className={`btn ghost danger ${confirmClear ? "confirm" : ""}`}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              clearAllData();
              setConfirmClear(false);
              setMsg("すべてのデータを削除しました。");
            }}
          >
            {confirmClear ? "もう一度で全削除" : "すべて削除"}
          </button>
        </div>
        {msg && <p className="page-note ok">{msg}</p>}
      </div>
    </div>
  );
}
