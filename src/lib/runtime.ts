// src/lib/runtime.ts
// シナリオランタイム共通ヘルパー
// API ルート間で共有する状態構築ロジックを集約する。

import { prisma } from "@/lib/prisma";
import type { RuntimeState, PhaseType, MessageType, IconType, QuickReplyItem } from "@/types";

// ── 型（Prisma 返り値の最小セット）───────────────
type RawProgress = {
  id: string;
  lineUserId: string;
  workId: string;
  currentPhaseId: string | null;
  reachedEnding: boolean;
  flags: string;
  lastInteractedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

// ── フラグ条件評価 ────────────────────────────────

/**
 * フラグ条件式を評価する。
 *
 * サポートする構文（MVP）:
 *   flags.KEY               → flags["KEY"] が truthy
 *   !flags.KEY              → flags["KEY"] が falsy
 *   flags.KEY == VALUE      → 等値比較（型変換あり）
 *   flags.KEY != VALUE      → 非等値比較
 *   flags.KEY > NUMBER      → 数値比較
 *   flags.KEY >= NUMBER
 *   flags.KEY < NUMBER
 *   flags.KEY <= NUMBER
 *
 * VALUE リテラル: true / false / 数値 / "文字列" / '文字列'
 *
 * @param flags   現在の UserProgress.flags
 * @param expr    条件式文字列。null/空文字の場合は常に true を返す
 */
export function evaluateCondition(
  flags: Record<string, unknown>,
  expr: string | null | undefined
): boolean {
  if (!expr || !expr.trim()) return true;

  const e = expr.trim();

  // !flags.KEY → falsy チェック
  const negMatch = e.match(/^!flags\.(\w+)$/);
  if (negMatch) {
    return !flags[negMatch[1]];
  }

  // flags.KEY OP VALUE（比較演算子）
  const opMatch = e.match(/^flags\.(\w+)\s*(===?|!==?|>=?|<=?)\s*(.+)$/);
  if (opMatch) {
    const [, key, rawOp, rawVal] = opMatch;
    const flagVal = flags[key];
    const cmpVal  = parseFlagValue(rawVal.trim());
    // === と !== は == / != と同じ扱い
    const op = rawOp.replace("===", "==").replace("!==", "!=");
    switch (op) {
      case "==":  return flagVal == cmpVal;   // eslint-disable-line eqeqeq
      case "!=":  return flagVal != cmpVal;   // eslint-disable-line eqeqeq
      case ">":   return Number(flagVal) >  Number(cmpVal);
      case ">=":  return Number(flagVal) >= Number(cmpVal);
      case "<":   return Number(flagVal) <  Number(cmpVal);
      case "<=":  return Number(flagVal) <= Number(cmpVal);
    }
  }

  // flags.KEY → truthy チェック
  const truthMatch = e.match(/^flags\.(\w+)$/);
  if (truthMatch) {
    return !!flags[truthMatch[1]];
  }

  // 未知の式 → 警告だけ出して通過させる（シナリオが完全に止まらないように）
  console.warn("[evaluateCondition] 未知の条件式:", expr);
  return true;
}

/** 条件式中のリテラル値をパースする */
function parseFlagValue(raw: string): unknown {
  if (raw === "true")  return true;
  if (raw === "false") return false;
  if (raw === "null")  return null;
  // 引用符付き文字列
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // 数値
  const num = Number(raw);
  if (!isNaN(num) && raw !== "") return num;
  // フォールバック: そのまま文字列
  return raw;
}

/**
 * `set_flags` JSON を現在の flags にマージして新しい flags オブジェクトを返す。
 * JSON パース失敗・非オブジェクト値の場合は現在の flags をそのまま返す。
 */
export function applySetFlags(
  currentFlags: Record<string, unknown>,
  setFlagsJson: string
): Record<string, unknown> {
  try {
    const updates = JSON.parse(setFlagsJson);
    if (updates && typeof updates === "object" && !Array.isArray(updates)) {
      return { ...currentFlags, ...(updates as Record<string, unknown>) };
    }
  } catch {
    // 無効な JSON は無視して現状維持
  }
  return currentFlags;
}

// ── 遷移マッチング ────────────────────────────────
/**
 * ユーザー入力テキストに対して最初にマッチする有効な遷移を返す。
 *
 * マッチ優先順位:
 *   1. `transition_id` 直接指定（ID が完全一致）
 *   2. ラベルの完全一致（大文字小文字・全角半角を正規化して比較）
 *   3. condition キーワードを入力が含む場合
 *
 * flagCondition が設定されている遷移は、現在の flags がその条件を満たす場合のみ候補になる。
 */
export function matchTransition<
  T extends {
    id: string;
    label: string;
    condition: string | null;
    flagCondition: string | null;
    setFlags: string;
    isActive: boolean;
  }
>(
  transitions: T[],
  opts: { label?: string; transitionId?: string; flags?: Record<string, unknown> }
): T | undefined {
  const flags = opts.flags ?? {};

  // isActive かつ flagCondition を満たすものだけ候補にする
  const actives = transitions.filter(
    (t) => t.isActive && evaluateCondition(flags, t.flagCondition)
  );

  // 優先1: ID 直接指定
  if (opts.transitionId) {
    return actives.find((t) => t.id === opts.transitionId);
  }

  if (!opts.label) return undefined;

  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize("NFKC"); // 全角→半角正規化

  const input = norm(opts.label);

  // 優先2: ラベル完全一致
  const byLabel = actives.find((t) => norm(t.label) === input);
  if (byLabel) return byLabel;

  // 優先3: condition キーワードが入力に含まれる
  return actives.find(
    (t) => t.condition && input.includes(norm(t.condition))
  );
}

// ── ランタイム状態の構築 ─────────────────────────

/**
 * フェーズ付き情報を取得するヘルパー。
 * 戻り値の型を PhaseRow として使い回す。
 * webhook/cache から再利用できるよう export する。
 */
export async function fetchPhaseWithIncludes(id: string) {
  return prisma.phase.findUnique({
    where: { id },
    include: {
      messages: {
        where:   { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          character: {
            select: {
              id: true, name: true, iconType: true, iconText: true, iconColor: true,
              iconImageUrl: true,
            },
          },
        },
      },
      transitionsFrom: {
        where:   { isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        include: {
          toPhase: { select: { id: true, name: true, phaseType: true } },
        },
      },
    },
  });
}

/** fetchPhaseWithIncludes の非 null 戻り値型（webhook / cache で共用）*/
export type PhaseRow = NonNullable<Awaited<ReturnType<typeof fetchPhaseWithIncludes>>>;

/**
 * フェーズの Prisma include 定義（route.ts から PHASE_INCLUDE として再利用可能）。
 * as const を避けて orderBy が readonly にならないようにする。
 */
export function buildPhaseInclude() {
  return {
    messages: {
      where:   { isActive: true } as const,
      orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] as { sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" }[],
      include: {
        character: {
          select: {
            id: true, name: true, iconType: true, iconText: true, iconColor: true,
            iconImageUrl: true,
          },
        },
      },
    },
    transitionsFrom: {
      where:   { isActive: true } as const,
      orderBy: [{ sortOrder: "asc" as const }] as { sortOrder?: "asc" | "desc" }[],
      include: {
        toPhase: { select: { id: true, name: true, phaseType: true } },
      },
    },
  };
}

// 後方互換エクスポート
export const PHASE_INCLUDE = buildPhaseInclude();

/** Prisma メッセージ行を RuntimePhaseMessage に変換するヘルパー */
function messageRowToRuntime(
  m: PhaseRow["messages"][number],
): import("@/types").RuntimePhaseMessage {
  let quickReplies: QuickReplyItem[] | null = null;
  if (m.quickReplies) {
    try {
      const parsed = JSON.parse(m.quickReplies);
      if (Array.isArray(parsed)) quickReplies = parsed as QuickReplyItem[];
    } catch {
      console.warn(`[buildRuntimeState] quickReplies parse error msgId=${m.id}`);
    }
  }
  return {
    id:                m.id,
    message_type:      m.messageType as MessageType,
    body:              m.body,
    asset_url:         m.assetUrl,
    alt_text:          m.altText         ?? null,
    flex_payload_json: m.flexPayloadJson ?? null,
    quick_replies:     quickReplies,
    lag_ms:            m.lagMs           ?? 0,
    sort_order:        m.sortOrder,
    character:         m.character
      ? {
          id:             m.character.id,
          name:           m.character.name,
          icon_type:      m.character.iconType as IconType,
          icon_text:      m.character.iconText,
          icon_color:     m.character.iconColor,
          icon_image_url: m.character.iconImageUrl,
        }
      : null,
  };
}

/**
 * フェーズのメッセージ一覧から「フェーズ開始時に自動表示すべきメッセージ列」を構築する。
 *
 * ルール:
 *   1. QRの target_message_id で参照されるメッセージは表示しない（QRタップ時のみ表示）
 *   2. 他メッセージの nextMessageId で参照されるメッセージは起点にしない（チェーン中間）
 *   3. 起点メッセージから nextMessageId を辿り、quick_replies を持つメッセージで停止
 *      （QRを持つメッセージはそこで一時停止し、ユーザー入力を待つ）
 */
function buildEntryChain(
  messages: PhaseRow["messages"],
): import("@/types").RuntimePhaseMessage[] {
  // 1. QR の target_message_id を収集（分岐先メッセージ ID セット）
  const targetMsgIds = new Set<string>();
  for (const m of messages) {
    if (!m.quickReplies) continue;
    try {
      const items = JSON.parse(m.quickReplies) as QuickReplyItem[];
      for (const item of items) {
        if (item.target_message_id) targetMsgIds.add(item.target_message_id);
      }
    } catch { /* ignore */ }
  }

  // 2. nextMessageId で参照されているメッセージ ID セット（チェーン中間）
  const midChainIds = new Set<string>(
    messages.filter((m) => m.nextMessageId).map((m) => m.nextMessageId!)
  );

  // 3. ID → メッセージ マップ
  const msgMap = new Map(messages.map((m) => [m.id, m]));

  // 4. 起点メッセージ: QR 分岐先でなく、チェーン中間でなく、かつ kind が response/hint でないもの
  //    kind="response" / "hint" はキーワードトリガーで表示するもの（フェーズ開始時は非表示）
  //    kind="start" は LINE webhook の handleStartTrigger がキーワードマッチに使うため
  //    triggerKeyword が設定されていても常に起点として扱う（シナリオ開幕演出メッセージ）
  //    それ以外（kind="normal"/"puzzle" など）で triggerKeyword があるものはキーワード入力待ちのため除外
  const entries = messages
    .filter(
      (m) =>
        !targetMsgIds.has(m.id) &&
        !midChainIds.has(m.id) &&
        m.kind !== "response" &&
        m.kind !== "hint" &&
        (m.kind === "start" || !m.triggerKeyword?.trim()),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());

  // 5. 各起点からチェーンを辿り、QR・puzzle・triggerKeyword で停止
  const result: import("@/types").RuntimePhaseMessage[] = [];
  const visited = new Set<string>(); // 循環ガード

  for (const entry of entries) {
    let cur: PhaseRow["messages"][number] | undefined = entry;
    while (cur && !visited.has(cur.id)) {
      // kind="response"/"hint" はチェーン中間でも表示しない
      if (cur.kind === "response" || cur.kind === "hint") break;
      visited.add(cur.id);
      result.push(messageRowToRuntime(cur));
      // QR を持つメッセージ、puzzle フェーズ、または triggerKeyword が設定されたメッセージで停止
      // （ユーザーの選択・解答・キーワード入力を待つ）
      if (cur.quickReplies || cur.kind === "puzzle" || cur.triggerKeyword?.trim()) break;
      // nextMessageId チェーンを辿る
      const nextId = cur.nextMessageId;
      if (!nextId) break;
      cur = msgMap.get(nextId);
    }
  }

  return result;
}

/**
 * プリフェッチ済みの PhaseRow から RuntimeState.phase を組み立てる（DB クエリなし）。
 * buildRuntimeState / buildRuntimeStateWithPhase の共通処理。
 */
function phaseRowToRuntimePhase(
  phase:  PhaseRow,
  flags:  Record<string, unknown>,
): import("@/types").RuntimePhase {
  const isEnding = phase.phaseType === "ending";

  const availableTransitions = phase.transitionsFrom.filter(
    (t) => evaluateCondition(flags, t.flagCondition)
  );

  return {
    id:          phase.id,
    phase_type:  phase.phaseType as PhaseType,
    name:        phase.name,
    description: phase.description,
    messages:    buildEntryChain(phase.messages),
    transitions: isEnding
      ? null
      : availableTransitions.map((t) => ({
          id:        t.id,
          label:     t.label,
          condition: t.condition,
          set_flags: t.setFlags,
          sort_order: t.sortOrder,
          to_phase: {
            id:         t.toPhase.id,
            name:       t.toPhase.name,
            phase_type: t.toPhase.phaseType as PhaseType,
          },
        })),
  };
}

/**
 * Prisma の UserProgress レコードから RuntimeState を構築する。
 * 現在フェーズのメッセージ・遷移を JOIN して返す。
 *
 * @param preloadedPhase  既にフェッチ済みの PhaseRow を渡すと DB クエリをスキップする。
 *                        省略時は currentPhaseId で自動フェッチする。
 */
export async function buildRuntimeState(
  progress:      RawProgress,
  preloadedPhase?: PhaseRow | null,
): Promise<RuntimeState> {
  const progressOut = {
    id:                 progress.id,
    line_user_id:       progress.lineUserId,
    work_id:            progress.workId,
    current_phase_id:   progress.currentPhaseId,
    reached_ending:     progress.reachedEnding,
    flags:              safeParseFlags(progress.flags),
    last_interacted_at: progress.lastInteractedAt.toISOString(),
    created_at:         progress.createdAt.toISOString(),
    updated_at:         progress.updatedAt.toISOString(),
  };

  if (!progress.currentPhaseId) {
    return { progress: progressOut, phase: null };
  }

  const phase = preloadedPhase ?? await fetchPhaseWithIncludes(progress.currentPhaseId);

  if (!phase) {
    return { progress: progressOut, phase: null };
  }

  const flags = safeParseFlags(progress.flags);

  return {
    progress: progressOut,
    phase:    phaseRowToRuntimePhase(phase, flags),
  };
}

// ── ユーティリティ ───────────────────────────────
export function safeParseFlags(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
