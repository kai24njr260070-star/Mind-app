import { useState } from "react";
import { cancelFission, confirmFission, confirmManualFission, getGoal, startFission } from "./store";
import { useAppState } from "./useAppState";
import type { AICandidate, FissionError } from "./types";

const ERROR_MESSAGES: Record<FissionError, string> = {
  not_configured: "AI候補を使うには、オーナー自身のFreebuff APIキーが必要です(設定 → デベロッパーAPI)。手動入力なら今すぐ続けられます。",
  ai_failed: "AIによる候補生成に失敗しました。手動入力で作業を続けられます。",
  bad_request: "リクエストが正しくありません。もう一度お試しください。",
  network: "ネットワークに接続できません。保存済みの目標はそのまま使えます。",
};

export function FissionBar(): React.JSX.Element {
  const state = useAppState();
  const fission = state.fission;
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  if (!fission) return <></>;

  const parent = getGoal(fission.parentId);
  const canConfirmAI = fission.phase === "ready" && fission.candidates.length > 0;

  const chooseSingle = (c: AICandidate, id: string) => confirmFission([c], [id]);
  const chooseBoth = () => confirmFission(fission.candidates, fission.candidates.map((c) => c.id));

  const submitManual = () => {
    const t = manualTitle.trim();
    if (!t) return;
    confirmManualFission(t);
    setManualTitle("");
    setManualOpen(false);
  };

  return (
    <div className="fission-bar">
      {fission.phase === "loading" && (
        <div className="fission-status">
          <span className="spinner" aria-hidden="true" />
          <span>AIが候補を作成中…</span>
          <button className="btn ghost small" onClick={cancelFission}>中断</button>
        </div>
      )}

      {fission.phase === "error" && (
        <div className="fission-status">
          <span className="error-text">{ERROR_MESSAGES[fission.error ?? "ai_failed"]}</span>
          <div className="row">
            <button className="btn ghost small" onClick={() => startFission(fission.parentId)}>再試行</button>
            <button className="btn ghost small" onClick={() => setManualOpen((v) => !v)}>手動で入力</button>
            <button className="btn ghost small" onClick={cancelFission}>閉じる</button>
          </div>
          {manualOpen && (
            <div className="manual-row">
              <input
                type="text"
                value={manualTitle}
                placeholder="次の目標"
                maxLength={40}
                onChange={(e) => setManualTitle(e.target.value)}
                onKeyDown={() => {
                  // Enter単体では確定しない(ボタン操作のみ)
                }}
              />
              <button className="btn primary small" onClick={submitManual} disabled={manualTitle.trim().length === 0}>
                確定
              </button>
            </div>
          )}
        </div>
      )}

      {fission.phase === "ready" && (
        <>
          <div className="fission-hint">
            {canConfirmAI ? "候補の星をタップして1つ選ぶか、下から操作を選んでください。" : "候補はありません。自分で入力できます。"}
          </div>

          {canConfirmAI && (
            <div className="cand-rows">
              {fission.candidates.map((c, i) => (
                <button key={c.id} className="cand-row" onClick={() => chooseSingle(c, c.id)}>
                  <span className="cand-badge">{String.fromCharCode(65 + i)}</span>
                  <span className="cand-text">
                    <span className="cand-title">{c.title}</span>
                    {c.description && <span className="cand-desc">{c.description}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {canConfirmAI && (
            <div className="row">
              <button className="btn primary small" onClick={chooseBoth}>両方採用</button>
              <button className="btn ghost small" onClick={() => setManualOpen((v) => !v)}>手動で入力</button>
              <button className="btn ghost small" onClick={cancelFission}>今回は選ばない</button>
            </div>
          )}

          {manualOpen && (
            <div className="manual-row">
              <input
                type="text"
                value={manualTitle}
                placeholder={parent ? `「${truncate(parent.title)}」の次の目標` : "次の目標"}
                maxLength={40}
                onChange={(e) => setManualTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
              />
              <button className="btn primary small" onClick={submitManual} disabled={manualTitle.trim().length === 0}>
                確定
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function truncate(text: string): string {
  return text.length > 10 ? `${text.slice(0, 9)}…` : text;
}
