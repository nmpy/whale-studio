// src/lib/api-client.ts
// フロントエンド向け API クライアント
// 各関数は Authorization ヘッダー用の token を受け取る。
// 開発環境では getDevToken() が返す "dev-token" をそのまま渡せる。

import type {
  ApiSuccess,
  Oa,
  Work,
  Character,
  Phase,
  PhaseWithCounts,
  Transition,
  TransitionWithPhases,
  Message,
  MessageWithRelations,
  RuntimeState,
  CreateOaBody,
  UpdateOaBody,
  CreateWorkBody,
  UpdateWorkBody,
  CreateCharacterBody,
  UpdateCharacterBody,
  CreatePhaseBody,
  UpdatePhaseBody,
  CreateTransitionBody,
  UpdateTransitionBody,
  CreateMessageBody,
  UpdateMessageBody,
  StartScenarioBody,
  AdvanceScenarioBody,
  ResetScenarioBody,
  RichMenuWithAreas,
  CreateRichMenuBody,
  UpdateRichMenuBody,
  FriendAddSettings,
  PutFriendAddBody,
  SnsPost,
  CreateSnsPostBody,
  UpdateSnsPostBody,
  Riddle,
  CreateRiddleBody,
  UpdateRiddleBody,
  Segment,
  CreateSegmentBody,
  UpdateSegmentBody,
  Tracking,
  CreateTrackingBody,
  UpdateTrackingBody,
  AnalyticsData,
  SegmentAnalytics,
  CreateHintLogBody,
  GlobalCommand,
  CreateGlobalCommandBody,
  UpdateGlobalCommandBody,
} from "@/types";

// ────────────────────────────────────────────────
// トークン取得ヘルパー
// ────────────────────────────────────────────────

/**
 * API 呼び出し用のトークンを返す。
 *
 * 暫定: "dev-token" を返す（サーバー側の BYPASS_AUTH=true と組み合わせて使用）。
 * 本命: サーバーが Supabase cookie を直接読むため、ここで返す値は無視される。
 *       将来的にはブラウザの Supabase セッションから access_token を取得する形に置き換える。
 */
export function getDevToken(): string {
  return "dev-token";
}

// ────────────────────────────────────────────────
// エラークラス
// ────────────────────────────────────────────────

/**
 * API が 404 を返したときに throw されるエラー。
 * 「未登録 = 正常系」なリソース（FriendAddSettings など）の
 * 分岐に使う。
 *
 * @example
 * try {
 *   const s = await friendAddApi.get(token, oaId);
 * } catch (e) {
 *   if (e instanceof NotFoundError) { /* 未登録 *\/ }
 * }
 */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message?: string) {
    super(message ?? "Not Found");
    this.name = "NotFoundError";
  }
}

/**
 * API が 400 (Validation error) を返したときに throw されるエラー。
 * `details` にフィールド別のエラーメッセージが入る。
 *
 * @example
 * try {
 *   await friendAddApi.put(token, oaId, body);
 * } catch (e) {
 *   if (e instanceof ValidationError) {
 *     console.log(e.details); // { share_image_url: ["..."] }
 *   }
 * }
 */
export class ValidationError extends Error {
  readonly status = 400;
  readonly details: Record<string, string[]>;
  constructor(message: string, details: Record<string, string[]> = {}) {
    super(message);
    this.name    = "ValidationError";
    this.details = details;
  }
  /** フィールド別エラーを "field: message" 形式の文字列にまとめる */
  toDetailString(): string {
    const lines = Object.entries(this.details).flatMap(([field, msgs]) =>
      msgs.map((m) => `${field}: ${m}`)
    );
    return lines.length ? lines.join("\n") : this.message;
  }
}

// ────────────────────────────────────────────────
// 内部ユーティリティ
// ────────────────────────────────────────────────

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as unknown as T;
  const json = await res.json();
  if (!json.success) {
    const msg     = json.error?.message ?? `HTTP ${res.status}`;
    const details = json.error?.details  ?? {};
    // 専用クラスで throw — 呼び出し側が instanceof で確実に分岐できる
    if (res.status === 404) throw new NotFoundError(msg);
    if (res.status === 400) throw new ValidationError(msg, details);
    throw new Error(msg);
  }
  return (json as ApiSuccess<T>).data;
}

// ────────────────────────────────────────────────
// OA API
// ────────────────────────────────────────────────

/** GET /api/oas 一覧アイテム（channel_secret / channel_access_token を除く） */
export interface OaListItem extends Omit<Oa, "channel_secret" | "channel_access_token"> {
  _count:   { works: number };
  my_role:  string; // 'owner' | 'editor' | 'viewer' | 'none'
}

/** POST /api/oas・PATCH /api/oas/:id の書き込みレスポンス（secret 類を除く） */
export type OaWriteResponse = Omit<Oa, "channel_secret" | "channel_access_token">;

// ────────────────────────────────────────────────
// Rich Menu API（管理画面向け）
// ────────────────────────────────────────────────

export interface RichMenuStatus {
  oa_id:        string;
  rich_menu_id: string | null;
  line_status:  { richMenuId: string; name: string; chatBarText: string } | null;
}

export interface OaListMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ────────────────────────────────────────────────
// Rich Menu Editor API（カスタムリッチメニュー管理）
// ────────────────────────────────────────────────

export const richMenuEditorApi = {
  async list(token: string, oaId: string): Promise<RichMenuWithAreas[]> {
    const res = await fetch(`/api/rich-menus?oa_id=${oaId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async get(token: string, id: string): Promise<RichMenuWithAreas> {
    const res = await fetch(`/api/rich-menus/${id}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async create(token: string, body: CreateRichMenuBody): Promise<RichMenuWithAreas> {
    const res = await fetch("/api/rich-menus", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateRichMenuBody): Promise<RichMenuWithAreas> {
    const res = await fetch(`/api/rich-menus/${id}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/rich-menus/${id}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async apply(token: string, id: string): Promise<{ rich_menu_id: string; line_rich_menu_id: string; applied: boolean }> {
    const res = await fetch(`/api/rich-menus/${id}/apply`, {
      method:  "POST",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};


export const oaApi = {
  async list(
    token: string,
    params?: { publish_status?: string; page?: number; limit?: number }
  ): Promise<{ data: OaListItem[]; meta: OaListMeta }> {
    const query = new URLSearchParams();
    if (params?.publish_status) query.set("publish_status", params.publish_status);
    if (params?.page)           query.set("page",           String(params.page));
    if (params?.limit)          query.set("limit",          String(params.limit));
    const res = await fetch(`/api/oas?${query}`, { headers: authHeaders(token) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return { data: json.data as OaListItem[], meta: json.meta as OaListMeta };
  },

  async get(token: string, id: string): Promise<Oa & { _count: { works: number } }> {
    const res = await fetch(`/api/oas/${id}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreateOaBody): Promise<OaWriteResponse> {
    const res = await fetch("/api/oas", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateOaBody): Promise<OaWriteResponse> {
    const res = await fetch(`/api/oas/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/oas/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Work API
// ────────────────────────────────────────────────

export interface WorkListItem extends Work {
  _count: { characters: number; phases: number; messages: number; userProgress: number };
}

export const workApi = {
  async list(
    token: string,
    oaId: string,
    params?: { publish_status?: string }
  ): Promise<WorkListItem[]> {
    const query = new URLSearchParams({ oa_id: oaId });
    if (params?.publish_status) query.set("publish_status", params.publish_status);
    const res = await fetch(`/api/works?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async get(token: string, id: string): Promise<WorkListItem> {
    const res = await fetch(`/api/works/${id}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreateWorkBody): Promise<Work> {
    const res = await fetch("/api/works", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateWorkBody): Promise<Work> {
    const res = await fetch(`/api/works/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/works/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  /** 作品を複製する。複製後の新作品（draft）を返す */
  async duplicate(token: string, id: string): Promise<WorkListItem & { _duplicated_from: string }> {
    const res = await fetch(`/api/works/${id}/duplicate`, {
      method:  "POST",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Phase API
// ────────────────────────────────────────────────

export const phaseApi = {
  async list(
    token: string,
    workId: string,
    params?: { phase_type?: string; is_active?: boolean }
  ): Promise<PhaseWithCounts[]> {
    const query = new URLSearchParams({ work_id: workId });
    if (params?.phase_type  !== undefined) query.set("phase_type", params.phase_type);
    if (params?.is_active   !== undefined) query.set("is_active",  String(params.is_active));
    const res = await fetch(`/api/phases?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async get(token: string, id: string): Promise<PhaseWithCounts> {
    const res = await fetch(`/api/phases/${id}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreatePhaseBody): Promise<PhaseWithCounts> {
    const res = await fetch("/api/phases", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdatePhaseBody): Promise<PhaseWithCounts> {
    const res = await fetch(`/api/phases/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/phases/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Transition API
// ────────────────────────────────────────────────

export const transitionApi = {
  /** from_phase_id でフィルタ（フェーズ詳細画面用） */
  async list(
    token: string,
    params: { from_phase_id: string; is_active?: boolean }
  ): Promise<TransitionWithPhases[]> {
    const query = new URLSearchParams({
      from_phase_id: params.from_phase_id,
      with_phases:   "true",
    });
    if (params.is_active !== undefined) query.set("is_active", String(params.is_active));
    const res = await fetch(`/api/transitions?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  /** work_id でフィルタ（作品全体のフロー把握用） */
  async listByWork(
    token: string,
    workId: string,
    params?: { is_active?: boolean }
  ): Promise<TransitionWithPhases[]> {
    const query = new URLSearchParams({ work_id: workId, with_phases: "true" });
    if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
    const res = await fetch(`/api/transitions?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreateTransitionBody): Promise<TransitionWithPhases> {
    const res = await fetch("/api/transitions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateTransitionBody): Promise<TransitionWithPhases> {
    const res = await fetch(`/api/transitions/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/transitions/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Character API
// ────────────────────────────────────────────────

export const characterApi = {
  async list(
    token: string,
    workId: string,
    params?: { is_active?: boolean }
  ): Promise<Character[]> {
    const query = new URLSearchParams({ work_id: workId });
    if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
    const res = await fetch(`/api/characters?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async get(token: string, id: string): Promise<Character> {
    const res = await fetch(`/api/characters/${id}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreateCharacterBody): Promise<Character> {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateCharacterBody): Promise<Character> {
    const res = await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/characters/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Runtime API — シナリオ実行
// ────────────────────────────────────────────────

export interface RuntimeAdvanceResult extends RuntimeState {
  _matched?:    boolean;
  _message?:    string;
  _transition?: { id: string; label: string };
}

export const runtimeApi = {
  /** 現在の進行状態を取得（未開始なら progress: null） */
  async getProgress(
    token: string,
    lineUserId: string,
    workId: string
  ): Promise<RuntimeState> {
    const query = new URLSearchParams({ line_user_id: lineUserId, work_id: workId });
    const res = await fetch(`/api/runtime/progress?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  /** シナリオを（再）開始して開始フェーズの状態を返す */
  async start(token: string, body: StartScenarioBody): Promise<RuntimeState> {
    const res = await fetch("/api/runtime/start", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** 遷移ラベル（またはID）を指定して次フェーズへ進む */
  async advance(token: string, body: AdvanceScenarioBody): Promise<RuntimeAdvanceResult> {
    const res = await fetch("/api/runtime/advance", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** 進行状態をリセット（最初からやり直し） */
  async reset(token: string, body: ResetScenarioBody): Promise<{ reset: boolean }> {
    const res = await fetch("/api/runtime/reset", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** QR の target_message_id を解決してメッセージ内容を返す（テスト画面用） */
  async getMessage(token: string, messageId: string): Promise<import("@/types").RuntimePhaseMessage> {
    const query = new URLSearchParams({ message_id: messageId });
    const res = await fetch(`/api/runtime/message?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Dashboard API — 進行状況ダッシュボード
// ────────────────────────────────────────────────

export interface DashboardStats {
  total_users:     number;
  in_progress:     number;
  reached_ending:  number;
  /** 0–100 の整数 */
  completion_rate: number;
}

export interface PhaseDistributionItem {
  phase_id:   string | null;
  phase_name: string | null;
  /** "start" | "normal" | "ending" | null */
  phase_type: string | null;
  sort_order: number;
  user_count: number;
}

export interface EndingDistributionItem {
  phase_id:   string;
  phase_name: string;
  user_count: number;
}

export interface DashboardUser {
  id:                 string;
  line_user_id:       string;
  current_phase_id:   string | null;
  current_phase_name: string | null;
  current_phase_type: string | null;
  reached_ending:     boolean;
  flags:              Record<string, unknown>;
  last_interacted_at: string;
  created_at:         string;
  updated_at:         string;
}

export interface DashboardData {
  work: { id: string; title: string; publish_status: string };
  stats: DashboardStats;
  phase_distribution:  PhaseDistributionItem[];
  ending_distribution: EndingDistributionItem[];
  users: DashboardUser[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export const dashboardApi = {
  async get(
    token: string,
    workId: string,
    params?: { page?: number; limit?: number }
  ): Promise<DashboardData> {
    const query = new URLSearchParams({ work_id: workId });
    if (params?.page  !== undefined) query.set("page",  String(params.page));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    const res = await fetch(`/api/dashboard?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Message API
// ────────────────────────────────────────────────

// ────────────────────────────────────────────────
// Upload API
// ────────────────────────────────────────────────

/**
 * 画像ファイルをサーバーにアップロードし、配信 URL を返す。
 * POST /api/upload — multipart/form-data { file: File }
 */
export const uploadApi = {
  async uploadImage(token: string, file: File): Promise<{ url: string }> {
    const body = new FormData();
    body.append("file", file);
    // Content-Type は FormData が自動設定するため Authorization のみ渡す
    const res = await fetch("/api/upload", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Friend Add Settings API
// ────────────────────────────────────────────────

export const friendAddApi = {
  async get(token: string, oaId: string): Promise<FriendAddSettings> {
    const res = await fetch(`/api/oas/${oaId}/friend-add`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async put(token: string, oaId: string, body: PutFriendAddBody): Promise<FriendAddSettings> {
    const res = await fetch(`/api/oas/${oaId}/friend-add`, {
      method:  "PUT",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// SNS Post API
// ────────────────────────────────────────────────

export const snsApi = {
  async list(token: string, oaId: string): Promise<SnsPost[]> {
    const res = await fetch(`/api/oas/${oaId}/sns`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async create(token: string, oaId: string, body: CreateSnsPostBody): Promise<SnsPost> {
    const res = await fetch(`/api/oas/${oaId}/sns`, {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, oaId: string, snsId: string, body: UpdateSnsPostBody): Promise<SnsPost> {
    const res = await fetch(`/api/oas/${oaId}/sns/${snsId}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, oaId: string, snsId: string): Promise<void> {
    const res = await fetch(`/api/oas/${oaId}/sns/${snsId}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Message API
// ────────────────────────────────────────────────

export const messageApi = {
  async list(
    token: string,
    workId: string,
    params?: { phase_id?: string; character_id?: string; is_active?: boolean; with_relations?: boolean }
  ): Promise<(Message | MessageWithRelations)[]> {
    const query = new URLSearchParams({ work_id: workId });
    if (params?.phase_id       !== undefined) query.set("phase_id",       params.phase_id);
    if (params?.character_id   !== undefined) query.set("character_id",   params.character_id);
    if (params?.is_active      !== undefined) query.set("is_active",      String(params.is_active));
    if (params?.with_relations !== undefined) query.set("with_relations", String(params.with_relations));
    const res = await fetch(`/api/messages?${query}`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  async create(token: string, body: CreateMessageBody): Promise<MessageWithRelations> {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, id: string, body: UpdateMessageBody): Promise<MessageWithRelations> {
    const res = await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/messages/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Riddle API
// ────────────────────────────────────────────────

export const riddleApi = {
  async list(token: string, oaId: string): Promise<Riddle[]> {
    const res = await fetch(`/api/oas/${oaId}/riddles`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async get(token: string, oaId: string, riddleId: string): Promise<Riddle> {
    const res = await fetch(`/api/oas/${oaId}/riddles/${riddleId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  async create(token: string, oaId: string, body: CreateRiddleBody): Promise<Riddle> {
    const res = await fetch(`/api/oas/${oaId}/riddles`, {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async update(token: string, oaId: string, riddleId: string, body: UpdateRiddleBody): Promise<Riddle> {
    const res = await fetch(`/api/oas/${oaId}/riddles/${riddleId}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  async delete(token: string, oaId: string, riddleId: string): Promise<void> {
    const res = await fetch(`/api/oas/${oaId}/riddles/${riddleId}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Segment API
// ────────────────────────────────────────────────
export const segmentApi = {
  async list(token: string, oaId: string): Promise<Segment[]> {
    const res = await fetch(`/api/segments?oa_id=${oaId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
  async get(token: string, id: string): Promise<Segment> {
    const res = await fetch(`/api/segments/${id}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
  async create(token: string, body: CreateSegmentBody): Promise<Segment> {
    const res = await fetch("/api/segments", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async update(token: string, id: string, body: UpdateSegmentBody): Promise<Segment> {
    const res = await fetch(`/api/segments/${id}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/segments/${id}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Tracking API
// ────────────────────────────────────────────────
export const trackingApi = {
  async list(token: string, oaId: string): Promise<Tracking[]> {
    const res = await fetch(`/api/trackings?oa_id=${oaId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
  async get(token: string, id: string): Promise<Tracking> {
    const res = await fetch(`/api/trackings/${id}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
  async create(token: string, body: CreateTrackingBody): Promise<Tracking> {
    const res = await fetch("/api/trackings", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async update(token: string, id: string, body: UpdateTrackingBody): Promise<Tracking> {
    const res = await fetch(`/api/trackings/${id}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/trackings/${id}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Analytics API
// ────────────────────────────────────────────────
export const analyticsApi = {
  async get(token: string, workId: string): Promise<AnalyticsData> {
    const res = await fetch(`/api/analytics?work_id=${workId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

export const segmentAnalyticsApi = {
  async list(token: string, oaId: string, workId: string): Promise<SegmentAnalytics[]> {
    const res = await fetch(`/api/analytics/segments?oa_id=${oaId}&work_id=${workId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// Member API
// ────────────────────────────────────────────────

export interface WorkspaceMember {
  id:           string;
  workspace_id: string;
  user_id:      string;
  role:         string; // 'owner' | 'editor' | 'viewer'
  invited_by:   string | null;
  created_at:   string;
  updated_at:   string;
}

export interface MyRole {
  workspace_id: string;
  user_id:      string;
  role:         string;
}

export const memberApi = {
  /** 自分のロールを取得 */
  async getMyRole(token: string, oaId: string): Promise<MyRole> {
    const res = await fetch(`/api/oas/${oaId}/members/me`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  /** メンバー一覧（owner のみ） */
  async list(token: string, oaId: string): Promise<WorkspaceMember[]> {
    const res = await fetch(`/api/oas/${oaId}/members`, { headers: authHeaders(token) });
    return parseResponse(res);
  },

  /** メンバー追加（owner のみ） */
  async add(token: string, oaId: string, body: { user_id: string; role: string }): Promise<WorkspaceMember> {
    const res = await fetch(`/api/oas/${oaId}/members`, {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** ロール変更（owner のみ） */
  async updateRole(token: string, oaId: string, memberId: string, role: string): Promise<WorkspaceMember> {
    const res = await fetch(`/api/oas/${oaId}/members/${memberId}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify({ role }),
    });
    return parseResponse(res);
  },

  /** メンバー削除（owner のみ） */
  async remove(token: string, oaId: string, memberId: string): Promise<void> {
    const res = await fetch(`/api/oas/${oaId}/members/${memberId}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// HintLog API
// ────────────────────────────────────────────────
export const hintLogApi = {
  async create(token: string, body: CreateHintLogBody): Promise<{ id: string; created_at: string }> {
    const res = await fetch(`/api/hint-logs`, {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },
};

// ────────────────────────────────────────────────
// GlobalCommand API
// ────────────────────────────────────────────────
export const globalCommandApi = {
  /** OA に紐づくグローバルコマンド一覧 */
  async list(token: string, oaId: string): Promise<GlobalCommand[]> {
    const res = await fetch(`/api/global-commands?oa_id=${oaId}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  /** グローバルコマンド詳細 */
  async get(token: string, id: string): Promise<GlobalCommand> {
    const res = await fetch(`/api/global-commands/${id}`, {
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },

  /** 新規作成 */
  async create(token: string, body: CreateGlobalCommandBody): Promise<GlobalCommand> {
    const res = await fetch("/api/global-commands", {
      method:  "POST",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** 更新 */
  async update(token: string, id: string, body: UpdateGlobalCommandBody): Promise<GlobalCommand> {
    const res = await fetch(`/api/global-commands/${id}`, {
      method:  "PATCH",
      headers: authHeaders(token),
      body:    JSON.stringify(body),
    });
    return parseResponse(res);
  },

  /** 削除 */
  async delete(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/global-commands/${id}`, {
      method:  "DELETE",
      headers: authHeaders(token),
    });
    return parseResponse(res);
  },
};
