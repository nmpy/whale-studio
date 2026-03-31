// src/lib/runtime.ts
// シナリオランタイム共通ヘルパー
// API ルート間で共有する状態構築ロジックを集約する。

import { prisma } from "@/lib/prisma";
import type { RuntimeState, PhaseType, MessageType, IconType } from "@/types";

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
 * Prisma の UserProgress レコードから RuntimeState を構築する。
 * 現在フェーズのメッセージ・遷移を JOIN して返す。
 */
export async function buildRuntimeState(
  progress: RawProgress
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

  const phase = await prisma.phase.findUnique({
    where: { id: progress.currentPhaseId },
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

  if (!phase) {
    return { progress: progressOut, phase: null };
  }

  const isEnding = phase.phaseType === "ending";
  const flags    = safeParseFlags(progress.flags);

  // flagCondition を満たす遷移のみ返す（LINE / Playground ともに同じ表示範囲）
  const availableTransitions = phase.transitionsFrom.filter(
    (t) => evaluateCondition(flags, t.flagCondition)
  );

  return {
    progress: progressOut,
    phase: {
      id:          phase.id,
      phase_type:  phase.phaseType as PhaseType,
      name:        phase.name,
      description: phase.description,
      messages:    phase.messages.map((m) => ({
        id:           m.id,
        message_type: m.messageType as MessageType,
        body:         m.body,
        asset_url:    m.assetUrl,
        sort_order:   m.sortOrder,
        character:    m.character
          ? {
              id:             m.character.id,
              name:           m.character.name,
              icon_type:      m.character.iconType as IconType,
              icon_text:      m.character.iconText,
              icon_color:     m.character.iconColor,
              icon_image_url: m.character.iconImageUrl,
            }
          : null,
      })),
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
    },
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
