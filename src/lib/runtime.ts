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
  // 演出設定: すべて null なら timing=null（inherit 扱い）
  const hasAnyTiming =
    m.readReceiptMode != null || m.readDelayMs != null ||
    m.typingEnabled != null || m.typingMinMs != null || m.typingMaxMs != null ||
    m.loadingEnabled != null || m.loadingThresholdMs != null ||
    m.loadingMinSeconds != null || m.loadingMaxSeconds != null;
  const timing: import("@/types").MessageTimingConfig | null = hasAnyTiming
    ? {
        read_receipt_mode:    (m.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
        read_delay_ms:        m.readDelayMs        ?? null,
        typing_enabled:       m.typingEnabled       ?? null,
        typing_min_ms:        m.typingMinMs         ?? null,
        typing_max_ms:        m.typingMaxMs         ?? null,
        loading_enabled:      m.loadingEnabled      ?? null,
        loading_threshold_ms: m.loadingThresholdMs  ?? null,
        loading_min_seconds:  m.loadingMinSeconds   ?? null,
        loading_max_seconds:  m.loadingMaxSeconds   ?? null,
      }
    : null;

  return {
    id:                m.id,
    kind:              m.kind,
    message_type:      m.messageType as MessageType,
    body:              m.body,
    asset_url:         m.assetUrl,
    alt_text:          m.altText         ?? null,
    flex_payload_json: m.flexPayloadJson ?? null,
    quick_replies:     quickReplies,
    lag_ms:            m.lagMs           ?? 0,
    hint_mode:         (m.hintMode ?? "always") as import("@/types").HintMode,
    sort_order:        m.sortOrder,
    timing,
    tap_destination_id: m.tapDestinationId ?? null,
    tap_url:            m.tapUrl ?? null,
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
 * ユーザーの進行セグメント。
 * - not_started : 未開始（UserProgress なし）
 * - in_progress : プレイ中（UserProgress あり・エンディング未到達）
 * - completed   : クリア済み（reachedEnding = true）
 */
export type UserSegment = "not_started" | "in_progress" | "completed";

// ── フェーズ内メッセージの自動連続送信 ─────────────────────
//
// Phase内メッセージ送信フロー:
//
//   [通常] → [通常] → [puzzle] → (停止) → 正解 → drain再開 → [通常] → ...
//
//   自動送信の判定基準:
//     現在ノード（currentNode）の属性のみで判定する。
//     次ノードの種類（puzzle / ending / その他）は一切参照しない。
//
//   送信条件:
//   - currentNode が Message（kind=normal/start）かつ待機条件なし → 自動送信
//   - currentNode の次に何が来ても（puzzle, ending 等）、送信を阻害しない
//
//   停止条件（= ユーザー操作待ち: requiresUserInteraction）:
//   - puzzle       … 表示後に解答待ち
//   - quickReplies … 表示後に選択待ち
//   - triggerKeyword … キーワード入力待ち（kind="start" 除く）
//
// 設計メモ:
//   - UIの「ラベル」（通常/応答/謎 等）は MSG_KIND_META[kind].label で
//     表示時に導出される名前であり、DB に label カラムは存在しない。
//     ランタイムでは kind フィールドを直接参照する。
//
//   - 自動送信の判定は kind 単独では決まらない。
//     kind="normal" でも triggerKeyword があればキーワード入力待ち、
//     quickReplies があれば選択待ちになる。
//     → isAutoSendablePhaseItem（送信対象か）と isWaitPoint（停止するか）の
//       2段階で判定する。
//
//   - kind="puzzle" は「送信は自動、回答待ちで停止」。
//     puzzle メッセージ自体はフェーズ突入時に表示されるが、
//     requiresUserInteraction が true を返すためそこで連続送信は停止する。
//     正解後の correctText / incorrectText はメッセージ行ではなく
//     puzzle の属性であり、handlePuzzleCorrect が処理する。

type PhaseMessage = PhaseRow["messages"][number];

// ── 自動送信判定ヘルパー ─────────────────────────────
//
// 自動送信の判定は **現在ノード（currentNode）** の属性のみで行う。
// 「次ノードが puzzle かどうか」は一切参照しない。
//
//   判定フロー:
//     1. isAutoSendableMessageNode(currentNode, ctx)
//        → 現在ノードがフェーズ開始時の自動送信対象か？
//        → false なら sortOrder 走査からスキップ（response, hint, QR先参照 等）
//
//     2. requiresUserInteraction(currentNode)
//        → 現在ノード自体がユーザー操作を必要とするか？
//        → true なら「このノードを送信した上で」連続送信を停止
//          （例: puzzle は表示してから解答待ち、QR は表示してから選択待ち）
//
//   重要: 次ノードの種類（puzzle / ending / その他）は停止判定に一切影響しない。
//         Message ノード（kind=normal/start）かつ待機条件なし → 常に自動送信される。

/**
 * 現在ノードがユーザー操作を必要とするかどうかを判定する。
 *
 * true を返すノードは送信された上で連続送信チェーンを停止する。
 * ユーザーの操作（解答入力・QR選択・キーワード入力）を待つ。
 *
 * 判定条件（いずれかを満たせば true）:
 *   - quickReplies あり → QR選択待ち
 *   - kind="puzzle"     → パズル解答待ち
 *   - triggerKeyword あり（kind≠"start"）→ キーワード入力待ち
 */
export function requiresUserInteraction(m: PhaseMessage): boolean {
  if (m.quickReplies) return true;
  if (m.kind === "puzzle") return true;
  // kind="start" の triggerKeyword は開始トリガー用であり、ユーザー入力待ちではない
  if (m.kind !== "start" && m.triggerKeyword?.trim()) return true;
  return false;
}

/**
 * 現在ノードがフェーズ突入時の自動送信対象かどうかを判定する。
 *
 * 判定は現在ノードの属性のみで行い、次ノードの種類は参照しない。
 * この関数が true を返しても requiresUserInteraction が true なら
 * そのノードで連続送信は停止する（ノード自体は送信される）。
 *
 * 除外条件:
 *   - QR 分岐先として参照されるメッセージ（QR タップ時のみ表示）
 *   - kind="response" / "hint"（キーワード / ヒントトリガーでのみ表示）
 *   - triggerKeyword 付き（kind≠"start"）（キーワード入力待ちのため除外）
 *   - puzzle の targetSegment 不一致（セグメント限定パズル）
 */
export function isAutoSendableMessageNode(
  m: PhaseMessage,
  ctx: {
    targetMsgIds: Set<string>;
    userSegment?: UserSegment;
  },
): boolean {
  // QR 分岐先として参照されるメッセージは自動表示しない
  if (ctx.targetMsgIds.has(m.id)) return false;
  // response / hint はキーワード / ヒントトリガーでのみ表示
  if (m.kind === "response" || m.kind === "hint") return false;
  // kind="start" は常に自動表示（startTrigger 用の開始演出）
  // それ以外で triggerKeyword が設定されているものはキーワード入力待ちのため除外
  if (m.kind !== "start" && m.triggerKeyword?.trim()) return false;
  // puzzle: targetSegment フィルタ（設定されていればセグメント一致チェック）
  if (m.kind === "puzzle" && m.targetSegment && ctx.userSegment && m.targetSegment !== ctx.userSegment) return false;
  return true;
}

// 後方互換エイリアス（内部参照用）
const isAutoSendablePhaseItem = isAutoSendableMessageNode;
const isWaitPoint = requiresUserInteraction;

/**
 * フェーズ内の自動送信対象メッセージを sortOrder 順にドレインする。
 *
 * 判定基準:
 *   - 送信可否は **現在ノードの属性** のみで決定する（次ノードの種類は参照しない）
 *   - 現在ノードが Message（kind=normal/start）かつ待機条件なし → 自動送信
 *   - 現在ノードが puzzle/QR付き/triggerKeyword付き → 送信した上で停止（ユーザー操作待ち）
 *   - 次ノードが puzzle であること自体は、直前の Message の送信を阻害しない
 *
 * ルール:
 *   1. メッセージを sortOrder 順に走査する
 *   2. 自動送信対象（isAutoSendableMessageNode）のメッセージを順に結果に追加する
 *   3. ユーザー操作待ち（requiresUserInteraction）に達したら、そのメッセージを追加して停止する
 *      （puzzle は表示してから解答待ち、QR は表示してから選択待ち）
 *   4. nextMessageId チェーン中間のメッセージは sortOrder 走査からはスキップするが、
 *      チェーンの起点がドレイン対象であればチェーンを辿って追加する
 *
 * @param startAfterSortOrder  指定すると、この sortOrder より後のメッセージからドレインする。
 *                              パズル正解後の継続送信で使用する。
 */
export function drainAutoSendableItems(
  messages: PhaseRow["messages"],
  userSegment?: UserSegment,
  startAfterSortOrder?: number,
): import("@/types").RuntimePhaseMessage[] {
  // 1. QR の target_message_id を収集
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

  // 2. nextMessageId で参照されるメッセージ ID セット（チェーン中間）
  const midChainIds = new Set<string>(
    messages.filter((m) => m.nextMessageId).map((m) => m.nextMessageId!),
  );

  // 3. ID → メッセージ マップ
  const msgMap = new Map(messages.map((m) => [m.id, m]));

  // 4. sortOrder 順にソートした自動送信候補を構築
  //    チェーン中間のメッセージは起点から辿るため、ここではスキップする
  const sorted = messages
    .filter((m) => !midChainIds.has(m.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());

  // 5. sortOrder 順にドレイン
  console.log(
    `[drainAutoSendableItems] input=${messages.length}件 sorted=${sorted.length}件 midChain=${midChainIds.size}件 targetMsg=${targetMsgIds.size}件 startAfter=${startAfterSortOrder ?? "none"} segment=${userSegment ?? "none"}`,
    sorted.map((m) => `id=${m.id.slice(0, 8)} kind=${m.kind} sort=${m.sortOrder} type=${m.messageType}`).join(" / "),
  );
  const result: import("@/types").RuntimePhaseMessage[] = [];
  // 診断用: result に追加したメッセージの kind を追跡（RuntimePhaseMessage に kind がないため）
  const resultKinds: string[] = [];
  const visited = new Set<string>();

  /** 診断ログ出力ヘルパー */
  const logResult = () => {
    console.log(
      `[drainAutoSendableItems] result=${result.length}件`,
      result.map((m, i) => `id=${m.id.slice(0, 8)} kind=${resultKinds[i]} type=${m.message_type} sort=${m.sort_order} body=${m.body ? "あり" : "なし"} asset=${m.asset_url ? "あり" : "なし"}`).join(" / "),
    );
  };

  for (const entry of sorted) {
    // startAfterSortOrder 指定時: それ以前のメッセージはスキップ
    if (startAfterSortOrder !== undefined && entry.sortOrder <= startAfterSortOrder) continue;

    // 現在ノードが自動送信対象でなければスキップ（次ノードの種類は参照しない）
    if (!isAutoSendableMessageNode(entry, { targetMsgIds, userSegment })) continue;

    // エントリーからチェーンを辿る
    let cur: PhaseMessage | undefined = entry;
    while (cur && !visited.has(cur.id)) {
      // チェーン中間で response/hint に遭遇したら停止
      if (cur.kind === "response" || cur.kind === "hint") break;
      visited.add(cur.id);
      result.push(messageRowToRuntime(cur));
      resultKinds.push(cur.kind);

      // 現在ノードがユーザー操作待ちなら、送信済みの上で全体を停止
      // （判定は現在ノードの属性のみ。次ノードが puzzle 等であっても直前の Message は送信済み）
      if (requiresUserInteraction(cur)) {
        logResult();
        return result;
      }

      // nextMessageId チェーンを辿る
      const nextId = cur.nextMessageId;
      if (!nextId) break;
      cur = msgMap.get(nextId);
    }
  }

  logResult();
  return result;
}

/**
 * フェーズのメッセージ一覧から「フェーズ開始時に自動表示すべきメッセージ列」を構築する。
 *
 * 判定基準は **現在ノードの属性** のみ。次ノードの種類（puzzle 等）は参照しない。
 *
 * ルール:
 *   1. QRの target_message_id で参照されるメッセージは表示しない（QRタップ時のみ表示）
 *   2. kind="response"/"hint" はフェーズ開始時に表示しない
 *   3. triggerKeyword 付き（kind≠"start"）のメッセージは自動表示しない
 *   4. sortOrder 順に Message ノードを連続送信する
 *      → Message（kind=normal/start）かつ待機条件なし → 次ノードの種類に関係なく送信
 *   5. ユーザー操作待ちノード（puzzle/QR/trigger）に達したらそのノードを送信して停止
 */
function buildEntryChain(
  messages: PhaseRow["messages"],
  userSegment?: UserSegment,
): import("@/types").RuntimePhaseMessage[] {
  return drainAutoSendableItems(messages, userSegment);
}

/**
 * プリフェッチ済みの PhaseRow から RuntimeState.phase を組み立てる（DB クエリなし）。
 * buildRuntimeState / buildRuntimeStateWithPhase の共通処理。
 */
function phaseRowToRuntimePhase(
  phase:       PhaseRow,
  flags:       Record<string, unknown>,
  userSegment?: UserSegment,
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
    messages:    buildEntryChain(phase.messages, userSegment),
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

  // ユーザーのセグメントを進行状態から導出
  // （"not_started" は progress レコードが存在しないため、ここでは in_progress / completed のみ）
  const userSegment: UserSegment = progress.reachedEnding ? "completed" : "in_progress";

  return {
    progress: progressOut,
    phase:    phaseRowToRuntimePhase(phase, flags, userSegment),
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
