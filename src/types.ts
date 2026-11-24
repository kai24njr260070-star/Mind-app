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

export type FissionError = "not_configured" | "ai_failed" | "bad_request" | "network" | "cors_blocked";

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
  /** 失敗の具体的な理由(provider 401 など)。原因究明用にUIへ出す。 */
  detail?: string;
}

/** アニメーション用の揮発データ(localStorageには保存しない) */
export interface TransientFx {
  type: "fission-result";
  parentId: string;
  chosenIds: string[];
  rejectedIds: string[];
  at: number;
}

/** AIが提案する1曲。Apple Musicは検索リンクで開く。 */
export interface MusicTrack {
  title: string;
  artist: string;
  /** この曲を選んだ理由(予定との関係) */
  reason?: string;
}

/** 予定に合わせた音楽の提案。origin が local のときは端末内の候補。 */
export interface MusicSuggestion {
  mood: string;
  summary: string;
  tracks: MusicTrack[];
  origin: "ai" | "local";
}

/**
 * 目標の実行予定(何時から何時まで)。
 * 開始の1時間前・10分前・開始時刻に通知する。
 */
export interface GoalBlock {
  id: string;
  goalId: string;
  /** YYYY-MM-DD(端末のローカル日付) */
  date: string;
  /** HH:MM(24時間) */
  start: string;
  /** HH:MM(24時間) */
  end: string;
  createdAt: number;
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
  /** 予定のリマインド(1時間前・10分前・開始時刻)を有効にする */
  reminders: boolean;
  /** 「明日の予定は作りましたか？」のナッジ(8時〜22時に30分おき) */
  planningNudge: boolean;
  /** 音楽提案の好み(よく聴くアーティスト・ジャンル)。AIへのヒントに使う。 */
  musicTaste: string;
}

export interface AppState {
  goals: Goal[];
  candidates: CandidateRecord[];
  memos: Memo[];
  reflections: Reflection[];
  /** 目標に設定した実行予定 */
  blocks: GoalBlock[];
  selection: string | null;
  fission: FissionState | null;
  fx: TransientFx | null;
}

export function childCount(goals: Goal[], parentId: string): number {
  return goals.filter((g) => g.parentId === parentId).length;
}
