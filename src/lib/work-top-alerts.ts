// src/lib/work-top-alerts.ts
// 作品トップ「状態と注意点」の判定（純関数・既存データのみから安全に導出）。
// トーンは優先度で分ける: warning（運用事故につながりうる）/ info（設定推奨・確認メモ）/ success（概ね整っている）。
// 文言は強すぎない「確認メモ / 設定ヒント」寄りにする。CTA href は basePath から組み立てる（新規 API は使わない）。

import { startKeywordsOf } from "@/lib/start-keyword";

export type WorkTopAlertTone = "warning" | "info" | "success";

/**
 * 「プレイヤーが開始できる導線があるか」を runtime と同じ定義で判定する。
 * = Work.startKeyword ∨ 開始フェーズ Phase.startTrigger（startTrigger 一致で送信される開始演出もこれで発火）。
 * 作品トップ独自の簡易判定にせず、@/lib/start-keyword の startKeywordsOf を流用する。
 */
export function hasStartEntry(input: { startKeyword?: string | null; startTrigger?: string | null }): boolean {
  return startKeywordsOf({ id: "", startKeyword: input.startKeyword ?? null, startTrigger: input.startTrigger ?? null }).length > 0;
}

export interface WorkTopAlert {
  key:    string;
  tone:   WorkTopAlertTone;
  title:  string;
  detail: string;
  cta?:   { label: string; href: string };
}

export interface WorkTopAlertInput {
  /** publish_status（"active"=公開中 / それ以外は非公開扱い） */
  publishStatus:   string;
  hasStartTrigger: boolean;
  characters:      number;
  phases:          number;
  messages:        number;
  /** CTA href 組み立て用（例: /oas/xxx/works/yyy） */
  basePath:        string;
}

/**
 * 作品トップの注意アラートを算出する。
 * - 公開中(active)は運用事故に直結するため warning、非公開は設定推奨の info に落とす。
 * - 何も無ければ success を1件返す（強い赤にはしない）。
 */
export function computeWorkTopAlerts(input: WorkTopAlertInput): WorkTopAlert[] {
  const { publishStatus, hasStartTrigger, characters, phases, messages, basePath } = input;
  const published = publishStatus === "active";
  const alerts: WorkTopAlert[] = [];

  if (phases === 0) {
    alerts.push({
      key: "no_phases",
      tone: published ? "warning" : "info",
      title: "フェーズがありません",
      detail: "シナリオの土台となるフェーズを1つ以上作成してください。",
      cta: { label: "フェーズを追加する", href: `${basePath}/scenario` },
    });
  }

  if (messages === 0) {
    alerts.push({
      key: "no_messages",
      tone: published ? "warning" : "info",
      title: published ? "公開中ですがメッセージがありません" : "メッセージがありません",
      detail: published
        ? "公開中ですが、まだ送信するメッセージがありません。追加するとプレイヤーに内容が届きます。"
        : "フェーズに紐づくメッセージを追加すると、プレイヤーに届く内容が作れます。",
      cta: { label: "メッセージを追加する", href: `${basePath}/messages` },
    });
  }

  if (characters === 0) {
    alerts.push({
      key: "no_characters",
      tone: "info",
      title: "キャラクターがいません",
      detail: "送信者となるキャラクターを作成すると、名前・アイコン付きで送信できます。",
      cta: { label: "キャラクターを追加する", href: `${basePath}/characters` },
    });
  }

  if (!hasStartTrigger) {
    // 断定せず「確認メモ」トーン。実際に開始導線がある作品では page 側で hasStartTrigger=true になり出さない。
    alerts.push({
      key: "no_start_trigger",
      tone: "info",
      title: "開始トリガーを確認してください",
      detail: "開始キーワードや開始フェーズの設定があると、プレイヤーがスムーズに開始できます。必要に応じて設定してください。",
      cta: { label: "設定を確認する", href: `${basePath}/scenario` },
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      key: "all_ok",
      tone: "success",
      title: "主要な設定は整っています",
      detail: "作品作成・キャラクター・フェーズ・メッセージ・開始トリガーが設定済みです。",
    });
  }

  return alerts;
}
