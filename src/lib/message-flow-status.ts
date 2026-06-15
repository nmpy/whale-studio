// src/lib/message-flow-status.ts
//
// メッセージ一覧の「導線状態」判定ロジック（純関数・UI 非依存）。
// 各メッセージ（chain head）について、次の遷移先・分岐の有無・未設定/未接続などを集計する。
//
// 設計方針:
//   - 純関数（I/O / global state / prisma なし）。クライアント一覧画面から呼ぶ。
//     一覧 API が返す全メッセージはすでに 1 回の fetch で手元にあるため、ここでの集計は
//     追加クエリ不要（N+1 を作らない）。
//   - 入力は一覧 API の snake_case shape の部分集合。
//   - 公開前チェック（src/lib/pre-publish-check.ts）と「遷移先の壊れ」概念を共有するが、
//     あちらは prisma camelCase をサーバーで集計する作品横断の品質チェック、こちらは
//     一覧表示のための per-message 導線可視化。責務が異なるためロジックは重複させず、
//     本モジュールを「一覧導線判定の純関数」の置き場として将来の共通化点にする。
//   - 既存の分岐ルール純関数は src/lib/message-flow.ts（webhook/編集フォーム用）にある。混同しない。
//
// 用語:
//   - chain（連続メッセージ）: next_message_id で繋がる同一フェーズの塊。一覧は head のみ表示する。
//     導線バッジ（QR分岐 / 自由入力 / 画像タップ / クイックリプライ）と「次の遷移先」は、
//     head 単体ではなく chain 全体を畳んで集計する（塊として何をする / どこへ行くかを示す）。
//   - 「次の遷移先」: message レベルの前方リンクのみ（自由入力後 / 謎正解後 / 到着後 / QR分岐先 /
//     塊外への連続）。フェーズ遷移（phase.transitions）は別 UI の責務なのでここでは扱わない。

export type FlowLinkType =
  | "free_input"      // 自由入力後に送る次メッセージ
  | "puzzle_phase"    // 謎の正解後に進むフェーズ
  | "checkin_message" // 地点到着後に送る次メッセージ
  | "checkin_phase"   // 地点到着後に進むフェーズ
  | "qr_message"      // QR タップ先メッセージ（target_message_id / response_message_id / action="next"）
  | "qr_phase"        // QR タップ先フェーズ（target_phase_id）
  | "chain_external"; // chain 末尾の next_message_id が「この塊の外」を指す（通常は稀）

export interface FlowLink {
  type:       FlowLinkType;
  targetType: "message" | "phase";
  /** 遷移先の ID。空文字 = ポインタはあるが宛先未指定（= 未設定）。 */
  targetId:   string;
  /** 宛先が実在するか（message なら messageId 集合、phase なら phaseId 集合に含まれるか）。 */
  exists:     boolean;
}

export interface MessageFlowInfo {
  /** kind="start"（開始メッセージ）か。 */
  isStart:        boolean;
  /** chain 内のいずれかに「分岐する」QR があるか（target / response / action="next"）。 */
  hasQrBranch:    boolean;
  /** chain 内のいずれかに QR があるか（分岐しない url/hint のみでも true）。 */
  hasQuickReply:  boolean;
  /** chain 内のいずれかが自由入力受付 ON か。 */
  hasFreeInput:   boolean;
  /** chain 内のいずれかに画像タップアクションがあるか。 */
  hasImageTap:    boolean;
  /** message レベルの前方リンク（この塊の外への遷移先）。 */
  nextLinks:      FlowLink[];
  /** 設定されたポインタが宛先未指定 or 不在（= 遷移先未設定の警告対象）。 */
  hasBrokenLink:  boolean;
  /** 応答キーワードが必須（kind=start/response）なのに空（= 警告対象）。 */
  missingKeyword: boolean;
  /** どこからも参照されず、フェーズ自動送信でも届かない（= 未接続の警告対象。head 限定）。 */
  unreferenced:   boolean;
}

export interface FlowQuickReply {
  action?:              string | null;
  value?:               string | null;
  target_message_id?:   string | null;
  target_phase_id?:     string | null;
  response_message_id?: string | null;
}

export interface FlowMessage {
  id:                               string;
  /** 所属フェーズ ID（null / 不在 = どのフェーズにも属さない＝フェーズ入場で自動送信されない）。 */
  phase_id?:                        string | null;
  kind?:                            string | null;
  trigger_keyword?:                 string | null;
  next_message_id?:                 string | null;
  free_input_enabled?:              boolean | null;
  free_input_next_message_id?:      string | null;
  correct_action?:                  string | null;
  correct_next_phase_id?:           string | null;
  checkin_trigger_type?:            string | null;
  checkin_trigger_next_message_id?: string | null;
  checkin_trigger_next_phase_id?:   string | null;
  image_action_type?:               string | null;
  image_action_text?:               string | null;
  image_action_url?:                string | null;
  image_action_liff_page_id?:       string | null;
  image_action_postback_data?:      string | null;
  quick_replies?:                   FlowQuickReply[] | null;
}

/** 画像タップアクションの「宛先値」が未設定か（type ごとに必須フィールドを見る）。pre-publish-check #9 と整合。 */
function imageActionTargetMissing(m: FlowMessage): boolean {
  const t = m.image_action_type;
  if (!t || t === "none") return false;
  if (t === "message")  return !(m.image_action_text ?? "").trim();
  if (t === "uri")      return !(m.image_action_url ?? "").trim();
  if (t === "liff")     return !(m.image_action_liff_page_id ?? "").trim();
  if (t === "postback") return !(m.image_action_postback_data ?? "").trim();
  return false;
}

/** QR が「分岐」する（導線を別メッセージ/フェーズ/応答へ動かす）か。url/hint は分岐とみなさない。 */
function qrIsBranch(qr: FlowQuickReply): boolean {
  if (qr.action === "next") return true;
  return !!(qr.target_message_id || qr.target_phase_id || qr.response_message_id);
}

/** head から next_message_id を辿って chain の構成メンバー（head 含む）を順に返す。循環防止。 */
function walkChain(byId: Map<string, FlowMessage>, headId: string): FlowMessage[] {
  const out: FlowMessage[] = [];
  const visited = new Set<string>();
  let curId: string | null | undefined = headId;
  while (curId && !visited.has(curId) && byId.has(curId)) {
    visited.add(curId);
    const m: FlowMessage = byId.get(curId)!;
    out.push(m);
    curId = m.next_message_id ?? null;
  }
  return out;
}

/** 応答キーワードが必須な kind か（開始演出 / キーワード応答）。pre-publish-check の #3 と整合。 */
function keywordRequired(kind: string | null | undefined): boolean {
  return kind === "start" || kind === "response";
}

/**
 * 一覧の全メッセージから、chain head ごとの導線情報を集計して返す（key = head の id）。
 *
 * @param messages 一覧 API が返す全メッセージ（chain continuation も含む全件を渡すこと）。
 * @param phaseIds 実在するフェーズ ID 集合（遷移先フェーズの実在判定に使う）。
 */
export function analyzeMessageList(
  messages: FlowMessage[],
  phaseIds: ReadonlySet<string>,
): Map<string, MessageFlowInfo> {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const messageIds = new Set(messages.map((m) => m.id));

  // 「continuation（他メッセージの next_message_id から指される）」= head ではない。
  const continuationIds = new Set<string>();
  for (const m of messages) {
    if (m.next_message_id) continuationIds.add(m.next_message_id);
  }

  // 受信参照（incoming reference）集合: これらに含まれる ID は「どこかから参照されている」。
  // next_message_id / QR の target・response / 自由入力後 / 到着後 の各ポインタを集約。
  const referencedIds = new Set<string>();
  const addRef = (id: string | null | undefined) => { if (id) referencedIds.add(id); };
  for (const m of messages) {
    addRef(m.next_message_id);
    addRef(m.free_input_next_message_id);
    addRef(m.checkin_trigger_next_message_id);
    for (const qr of m.quick_replies ?? []) {
      addRef(qr.target_message_id);
      addRef(qr.response_message_id);
    }
  }

  const result = new Map<string, MessageFlowInfo>();

  for (const head of messages) {
    if (continuationIds.has(head.id)) continue; // continuation は head 経由で集計
    const chain = walkChain(byId, head.id);
    const chainIds = new Set(chain.map((m) => m.id));

    let hasQrBranch = false;
    let hasQuickReply = false;
    let hasFreeInput = false;
    let hasImageTap = false;
    let hasBrokenLink = false;
    // キーワード未設定は chain 全体で集約する（途中メッセージの不足も head 行で見落とさない）。
    let missingKeyword = false;
    const nextLinks: FlowLink[] = [];

    const pushLink = (type: FlowLinkType, targetType: "message" | "phase", targetId: string | null | undefined) => {
      const id = (targetId ?? "").trim();
      // chain 内部を指す message リンクは「塊の中」なので外向き遷移としては出さない。
      if (targetType === "message" && id && chainIds.has(id)) return;
      const exists = targetType === "message" ? messageIds.has(id) : phaseIds.has(id);
      nextLinks.push({ type, targetType, targetId: id, exists });
      if (!id || !exists) hasBrokenLink = true;
    };

    for (const m of chain) {
      // 途中メッセージも含めてキーワード必須・未入力を集約（chain 子の見落とし防止）。
      if (keywordRequired(m.kind) && !(m.trigger_keyword ?? "").trim()) missingKeyword = true;

      // QR
      const qrs = m.quick_replies ?? [];
      if (qrs.length > 0) hasQuickReply = true;
      for (const qr of qrs) {
        if (qrIsBranch(qr)) {
          hasQrBranch = true;
          if (qr.target_phase_id) pushLink("qr_phase", "phase", qr.target_phase_id);
          else if (qr.target_message_id) pushLink("qr_message", "message", qr.target_message_id);
          else if (qr.response_message_id) pushLink("qr_message", "message", qr.response_message_id);
          else if (qr.action === "next") {
            // action="next" は宛先指定がなければ「未設定の分岐」。
            const id = (qr.value ?? "").trim();
            if (id) pushLink("qr_message", "message", id);
            else hasBrokenLink = true;
          }
        } else if ((qr.action === "url" || qr.action === "custom") && !(qr.value ?? "").trim()) {
          // 分岐しない QR でも url/custom は宛先値が必須（空 = 操作後の遷移先未設定）。pre-publish-check #9 と整合。
          hasBrokenLink = true;
        }
      }

      // 自由入力
      if (m.free_input_enabled) {
        hasFreeInput = true;
        if (m.free_input_next_message_id) pushLink("free_input", "message", m.free_input_next_message_id);
      }

      // 画像タップ（アクション設定あり→宛先値が空なら未設定警告）
      if (m.image_action_type && m.image_action_type !== "none") {
        hasImageTap = true;
        if (imageActionTargetMissing(m)) hasBrokenLink = true;
      }

      // 謎の正解後フェーズ遷移
      if (m.correct_action === "transition" || m.correct_action === "text_and_transition") {
        pushLink("puzzle_phase", "phase", m.correct_next_phase_id);
      }

      // 地点到着後
      if (m.checkin_trigger_type) {
        if (m.checkin_trigger_next_message_id) pushLink("checkin_message", "message", m.checkin_trigger_next_message_id);
        if (m.checkin_trigger_next_phase_id)   pushLink("checkin_phase",   "phase",   m.checkin_trigger_next_phase_id);
      }
    }

    // chain 末尾の next_message_id が塊の外（= 存在しない ID 含む）を指すケース。
    const tail = chain[chain.length - 1];
    if (tail?.next_message_id && !chainIds.has(tail.next_message_id)) {
      pushLink("chain_external", "message", tail.next_message_id);
    }

    // 未接続の判定（誤検知を避けつつ「確実に届かない」もののみ flag）:
    //   (a) response/hint は「参照される or キーワード待ち」でしか発火しない trigger 専用 kind。
    //   (b) フェーズに属さない（phase_id 無効）非 start/system_notice メッセージは
    //       フェーズ入場の自動送信に乗らないため、参照もキーワードも無ければ確実に孤立する。
    //   normal/puzzle でも「有効なフェーズに属していれば」入場で自動送信されるので flag しない。
    const isTriggerOnlyKind = head.kind === "response" || head.kind === "hint";
    const isPhaseless = !head.phase_id || !phaseIds.has(head.phase_id);
    const canAutoSendFromPhase = !isPhaseless; // 有効フェーズに属せば入場で自動送信される
    const isStart = head.kind === "start";
    const isSystemNotice = head.kind === "system_notice"; // システムイベントで送信＝flow 外
    const noIncoming = !referencedIds.has(head.id) && !(head.trigger_keyword ?? "").trim();
    const unreferenced =
      noIncoming &&
      !isStart &&
      !isSystemNotice &&
      (isTriggerOnlyKind || !canAutoSendFromPhase);

    result.set(head.id, {
      isStart,
      hasQrBranch,
      hasQuickReply,
      hasFreeInput,
      hasImageTap,
      nextLinks,
      hasBrokenLink,
      missingKeyword,
      unreferenced,
    });
  }

  return result;
}
