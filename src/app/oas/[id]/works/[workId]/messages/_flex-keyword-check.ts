// src/app/oas/[id]/works/[workId]/messages/_flex-keyword-check.ts
//
// Flex Message の message-action ボタン（action.type="message"）の action.text と、
// 応答キーワード（kind="response"）の「有効フェーズ」のズレを検出する純ロジック（no JSX → node テスト可）。
//
// 背景: Flex ボタンを押すと action.text が通常 text として webhook に届くが、応答キーワードは
//   「現在フェーズ + 共通(phaseId=null)」のみが候補。Flex を表示するメッセージのフェーズと、
//   同じテキストの応答キーワードが在るフェーズがズレていると、押しても反応しない（keyword_no_match）。
//   この純関数で「別フェーズにある／どこにも無い」を一覧 UI 上で警告できるようにする。
//
// webhook の挙動は変えない（参照のみ）。正規化は webhook の normKw と同じ trim + NFKC。

/** webhook の normKw と同等（trim + NFKC 全角→半角）。 */
export function normFlexKeyword(s: string): string {
  return s.trim().normalize("NFKC");
}

/** Flex JSON を再帰的に走査し、action.type="message" の action.text を収集（重複排除）。 */
export function extractFlexMessageActionTexts(flexJson: string | null | undefined): string[] {
  if (!flexJson || !flexJson.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(flexJson);
  } catch {
    return [];
  }
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const action = o.action as Record<string, unknown> | undefined;
      if (action && action.type === "message" && typeof action.text === "string" && action.text.trim()) {
        found.add(action.text);
      }
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(parsed);
  return [...found];
}

type IndexableMessage = {
  kind?: string | null;
  trigger_keyword?: string | null;
  phase?: { id: string } | null;
};

/**
 * 応答キーワード（kind="response"）を「正規化キーワード → そのキーワードが在るフェーズ集合」に索引化。
 * phaseId=null は「共通（全フェーズ）」を表す（webhook の global と同義）。
 */
export function buildResponseKeywordPhaseIndex(
  messages: IndexableMessage[] | null | undefined,
): Map<string, Set<string | null>> {
  const index = new Map<string, Set<string | null>>();
  if (!Array.isArray(messages)) return index;
  for (const m of messages) {
    if (!m || m.kind !== "response") continue;
    const raw = (m.trigger_keyword ?? "").trim();
    if (!raw) continue;
    const phaseId = m.phase?.id ?? null;
    for (const kw of raw.split("\n").map((k) => normFlexKeyword(k.trim())).filter(Boolean)) {
      if (!index.has(kw)) index.set(kw, new Set());
      index.get(kw)!.add(phaseId);
    }
  }
  return index;
}

export type FlexKeywordIssue = {
  text: string;
  /** "wrong_phase" = 別フェーズにのみ存在 / "missing" = どこにも応答キーワードが無い。 */
  status: "wrong_phase" | "missing";
  /** wrong_phase のとき、そのキーワードが在る他フェーズ ID（共通=null は除外済み）。 */
  otherPhaseIds: string[];
};

/**
 * Flex メッセージ（あるフェーズに属する）の各 message-action.text について、
 * 同じテキストの応答キーワードが「このフェーズにも共通にも無い」場合だけ警告を返す。
 *   - このフェーズに在る／共通(null)に在る → OK（警告なし）
 *   - 別フェーズにのみ在る → wrong_phase
 *   - どこにも無い → missing
 */
export function findFlexKeywordPhaseIssues(args: {
  flexJson: string | null | undefined;
  flexMessagePhaseId: string | null;
  index: Map<string, Set<string | null>>;
}): FlexKeywordIssue[] {
  const texts = extractFlexMessageActionTexts(args.flexJson);
  const issues: FlexKeywordIssue[] = [];
  for (const text of texts) {
    const phases = args.index.get(normFlexKeyword(text));
    if (!phases || phases.size === 0) {
      issues.push({ text, status: "missing", otherPhaseIds: [] });
      continue;
    }
    if (phases.has(null)) continue; // 共通 → どのフェーズでも反応する
    if (args.flexMessagePhaseId !== null && phases.has(args.flexMessagePhaseId)) continue; // 同フェーズに在る
    issues.push({
      text,
      status: "wrong_phase",
      otherPhaseIds: [...phases].filter((p): p is string => p !== null),
    });
  }
  return issues;
}
