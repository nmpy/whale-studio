// src/lib/phase-transitions.ts
//
// シナリオ（フェーズ管理）画面の「このフェーズから次のフェーズへ進めるか」を
// 実際の到達可能性に基づいて判定するための純関数群。
//
// 背景:
//   旧実装はフェーズ直下の transition レコードと「QR の target_phase_id」しか見ておらず、
//   QR の遷移先が別フェーズのメッセージだったり、謎の正解後フェーズ・自由入力後の応答・
//   到着トリガーの遷移先などで次フェーズへ進む構成を「遷移なし」と誤判定していた。
//
//   ここでは 1 フェーズに属する有効なメッセージ / QR / 分岐 / トリガーを横断して、
//   別フェーズへ到達できる遷移先 phaseId を集める。
//   - 同一フェーズ内のメッセージ遷移（next_message など）はフェーズ外遷移とみなさない。
//   - 無効化（is_active=false / QR enabled=false）された導線は除外する。
//   - 存在しない phaseId を参照している場合は「不正な遷移先」として別管理する。
//   - 位置情報（到着トリガー）系は、保存時点で権限（Pro Max）が無いと
//     checkin_trigger_next_phase_id 自体が null で保存されるため、データを見るだけで
//     権限の無い導線を「有効な遷移」と誤判定しない（= 追加のプラン判定は不要）。

// ── 入力の最小構造（テスト容易性のため Message 等に依存しすぎない形にする）──

export interface PhaseLite {
  id:         string;
  phase_type: string;
}

export interface QuickReplyLite {
  enabled?:           boolean | null;
  target_phase_id?:   string | null;
  target_type?:       string | null;
  target_message_id?: string | null;
  action?:            string | null;
  value?:             string | null;
  label?:             string | null;
}

export interface MessageLite {
  id:       string;
  phase_id: string | null;
  is_active?: boolean | null;
  quick_replies?:                   QuickReplyLite[] | null;
  /** 謎・問題の不正解時に表示する QR（target_phase_id を持ちうる） */
  incorrect_quick_replies?:         QuickReplyLite[] | null;
  /** 謎・問題の正解後に進むフェーズ */
  correct_next_phase_id?:           string | null;
  /** 到着（QR/GPS/Beacon チェックイン）トリガー後に進むフェーズ */
  checkin_trigger_next_phase_id?:   string | null;
  /** 到着トリガー後に送るメッセージ（別フェーズなら遷移とみなす） */
  checkin_trigger_next_message_id?: string | null;
  /** 自由入力（ユーザー入力）を受けた後に送るメッセージ（別フェーズなら遷移） */
  free_input_next_message_id?:      string | null;
  /** 連続送信の次メッセージ（別フェーズを指していれば遷移） */
  next_message_id?:                 string | null;
}

export interface TransitionLite {
  from_phase_id: string;
  to_phase_id:   string;
  label?:        string | null;
}

export interface ScenarioData {
  phases:      PhaseLite[];
  transitions: TransitionLite[];
  messages:    MessageLite[];
}

export interface OutgoingResult {
  /** 別フェーズ（存在する・自フェーズ以外）への有効な遷移先 phaseId */
  validTargets:   Set<string>;
  /** 参照しているが phases に存在しない phaseId（不正な遷移先） */
  invalidTargets: Set<string>;
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");

/**
 * 指定フェーズから「別フェーズへ出ていく」遷移先 phaseId を集める。
 *
 * 集計対象（いずれもこのフェーズに属する有効メッセージ＋明示 transition）:
 *  - 明示の transition（from_phase_id === phaseId）
 *  - QR / 不正解 QR の target_phase_id
 *  - QR / 不正解 QR の target_message_id（解決先メッセージが別フェーズなら遷移）
 *  - QR の value/label が、このフェーズ起点の transition ラベルに一致 → その to_phase
 *  - 謎の正解後フェーズ（correct_next_phase_id）
 *  - 到着トリガーの遷移先（checkin_trigger_next_phase_id / _next_message_id）
 *  - 自由入力後の応答メッセージ（free_input_next_message_id が別フェーズ）
 *  - 連続送信の next_message_id が別フェーズを指す場合
 *
 * 同一フェーズ内を指す遷移は validTargets に含めない（フェーズ外へ進めないため）。
 */
export function getOutgoingPhaseTargets(phaseId: string, data: ScenarioData): OutgoingResult {
  const phaseIds = new Set(data.phases.map((p) => p.id));
  const msgPhase = new Map<string, string | null>(data.messages.map((m) => [m.id, m.phase_id]));

  const valid   = new Set<string>();
  const invalid = new Set<string>();

  // このフェーズ起点の transition ラベル → to_phase（テキスト QR 照合用）
  const labelMap = new Map<string, string>();
  for (const t of data.transitions) {
    if (t.from_phase_id === phaseId && t.label) labelMap.set(norm(t.label), t.to_phase_id);
  }

  const addPhaseTarget = (target: string | null | undefined) => {
    if (!target) return;
    if (target === phaseId) return;       // 自フェーズはフェーズ外遷移ではない
    if (phaseIds.has(target)) valid.add(target);
    else invalid.add(target);             // 存在しない phaseId = 不正な遷移先
  };

  const addMessageTarget = (msgId: string | null | undefined) => {
    if (!msgId) return;
    const targetPhase = msgPhase.get(msgId);
    if (targetPhase === undefined) return; // 存在しないメッセージは無視（別の壊れ警告対象）
    addPhaseTarget(targetPhase);           // 別フェーズなら遷移、同フェーズなら除外
  };

  const handleQr = (items?: QuickReplyLite[] | null) => {
    for (const qr of items ?? []) {
      if (qr.enabled === false) continue;  // 無効化された QR は除外
      if (qr.target_phase_id) { addPhaseTarget(qr.target_phase_id); continue; }
      if (qr.target_type === "message" && qr.target_message_id) { addMessageTarget(qr.target_message_id); continue; }
      const textVal = (qr.value?.trim() || qr.label || "").trim();
      if (textVal) {
        const matched = labelMap.get(norm(textVal));
        if (matched) addPhaseTarget(matched);
      }
    }
  };

  // 1. 明示 transition
  for (const t of data.transitions) {
    if (t.from_phase_id === phaseId) addPhaseTarget(t.to_phase_id);
  }

  // 2. このフェーズの有効メッセージ由来
  for (const m of data.messages) {
    if (m.phase_id !== phaseId) continue;
    if (m.is_active === false) continue;   // 無効化されたメッセージは除外

    handleQr(m.quick_replies);
    handleQr(m.incorrect_quick_replies);

    addPhaseTarget(m.correct_next_phase_id);
    addPhaseTarget(m.checkin_trigger_next_phase_id);
    addMessageTarget(m.checkin_trigger_next_message_id);
    addMessageTarget(m.free_input_next_message_id);
    addMessageTarget(m.next_message_id);
  }

  return { validTargets: valid, invalidTargets: invalid };
}

/** 指定フェーズから別フェーズへ進む有効な導線が 1 つでもあるか。 */
export function hasOutgoingTransitionFromPhase(phaseId: string, data: ScenarioData): boolean {
  return getOutgoingPhaseTargets(phaseId, data).validTargets.size > 0;
}

export interface PhaseTransitionWarnings {
  /** phase_type !== "ending" かつ別フェーズへ進む導線が 1 つも無いフェーズ id */
  deadEndPhaseIds:  Set<string>;
  /** phase_type !== "start" かつどこからも到達できないフェーズ id（孤立） */
  orphanPhaseIds:   Set<string>;
  /** 存在しないフェーズを遷移先に参照しているフェーズ id → 参照先 id 群 */
  invalidTargets:   Map<string, Set<string>>;
  /** 各フェーズの有効な遷移先 phaseId（UI 補助表示用） */
  outgoingByPhase:  Map<string, Set<string>>;
}

/**
 * シナリオ全体の遷移到達性を解析し、警告対象フェーズを返す。
 *
 * - deadEnd（フェーズ外へ進めない）: ending を除外。phases が 1 つだけのときは出さない。
 * - orphan（どこからも到達できない）: start を除外。
 * - invalidTargets（存在しないフェーズ参照）: deadEnd とは独立に検出する。
 */
export function analyzePhaseTransitions(data: ScenarioData): PhaseTransitionWarnings {
  const outgoingByPhase = new Map<string, Set<string>>();
  const invalidTargets  = new Map<string, Set<string>>();
  const incoming        = new Set<string>();

  for (const p of data.phases) {
    const res = getOutgoingPhaseTargets(p.id, data);
    outgoingByPhase.set(p.id, res.validTargets);
    if (res.invalidTargets.size > 0) invalidTargets.set(p.id, res.invalidTargets);
    for (const t of res.validTargets) incoming.add(t);
  }

  const multiPhase = data.phases.length > 1;
  const deadEndPhaseIds = new Set<string>();
  const orphanPhaseIds  = new Set<string>();

  for (const p of data.phases) {
    const out = outgoingByPhase.get(p.id) ?? new Set<string>();
    if (p.phase_type !== "ending" && out.size === 0 && multiPhase) deadEndPhaseIds.add(p.id);
    if (p.phase_type !== "start"  && !incoming.has(p.id) && multiPhase) orphanPhaseIds.add(p.id);
  }

  return { deadEndPhaseIds, orphanPhaseIds, invalidTargets, outgoingByPhase };
}
