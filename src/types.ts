export interface Goal {
  id: string;
  parentId: string | null;
  title: string;
  description?: string;
  status: "active" | "completed";
  createdAt: number;
  updatedAt: number;
  deadline?: string;
  completionDate?: string | null;
  source: "manual" | "ai";
  orderIndex: number;
}

/**
 * 確定した Goal とは明確に区別される、未確定の分裂候補。
 * 選択されなかった候補も履歴として保持する(再検討・復元の対象)。spec §3.2
 */
export interface CandidateRecord {
  id: string;
  parentId: string;
  title: string;
  description?: string;
  createdAt: number;
  selectionStatus: "pending" | "selected" | "rejected";
}

export type AICandidate = { title: string; description: string };

export type FissionError = "not_configured" | "ai_failed" | "bad_request" | "network";

export interface FissionCandidateLive {
  id: string;
  title: string;
  description: string;
  /** 分裂アニメーション用:生成時刻 */
  bornAt: number;
}

export interface FissionState {
  parentId: string;
  phase: "loading" | "ready" | "error";
  candidates: FissionCandidateLive[];
  error?: FissionError;
}

/** アニメーション用の揮発データ(localStorageには保存しない) */
export interface TransientFx {
  type: "fission-result";
  parentId: string;
  chosenIds: string[];
  rejectedIds: string[];
  at: number;
}

/** 日次メモ(spec §5)。目標ツリーとは独立。書いても自動的に目標化されない。 */
export interface Memo {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  content: string;
  tags: string[];
  linkedGoalIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** Reflection AIが提案した、ユーザー承認待ちのアクション(単体では実行されない)。 */
export interface ReflectionAction {
  kind: "split" | "reschedule" | "focus" | "rest";
  goalId?: string;
  /** 提案文(カードに表示) */
  label: string;
  /** reschedule時の提案日(YYYY-MM-DD)。適用はユーザーの承認後 */
  newDeadline?: string;
}

/** 振り返り記録(spec §7)。提案の適用・辞退を履歴として残す。 */
export interface Reflection {
  id: string;
  createdAt: number;
  relatedGoalIds: string[];
  summary: string;
  suggestedActions: ReflectionAction[];
  approvalStatus: "pending" | "acted" | "declined";
  /** "ai" = Worker経由 / "offline" = 端末内ルール判定 */
  origin: "ai" | "offline";
}

/** アプリ設定(localStorage別キー)。 */
export interface Settings {
  /** 起動アニメーションを常にスキップ */
  skipStartup: boolean;
  /** 効果音(既定はオフ。消音状態を尊重する) */
  sound: boolean;
  /**
   * 設定画面で入力したAPIキー。ブラウザのlocalStorageにのみ保存され、
   * リクエスト時だけヘッダ(X-AI-Key)でサーバーへ渡る。Workerの環境変数キーがあればそちらを優先。
   */
  apiKey: string;
  /** AIプロバイダ。"freebuff" | "openai" | "gemini" | "grok" | "groq" */
  providerId: string;
  /** モデル指定(空ならサーバー側で自動選択) */
  aiModel: string;
  /** プロバイダごとのAPIキー/モデル。プロバイダを切り替えても消えないよう保存する。 */
  perProvider?: Record<string, { apiKey: string; aiModel: string }>;
}

export interface AppState {
  goals: Goal[];
  candidates: CandidateRecord[];
  memos: Memo[];
  reflections: Reflection[];
  selection: string | null;
  fission: FissionState | null;
  fx: TransientFx | null;
}

export function childCount(goals: Goal[], parentId: string): number {
  return goals.filter((g) => g.parentId === parentId).length;
}
