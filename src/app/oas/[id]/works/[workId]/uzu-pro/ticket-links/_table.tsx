"use client";

// for ウズプロ ＞ チケット連携一覧テーブル（**read-only**）。
//   - View Model のみ受け取る。生 DB モデル・LINE UID・内部主キーの業務表示はしない。
//   - 操作は「内容を修正」（PR-C）と「連携を解除」（PR-B）のみ。承認 / 状態の任意変更は持たない。
//     いずれも行の控えめなテキストボタン → 確認ダイアログを経由し、押しただけでは変更しない。
//     REVOKED 行には操作導線を出さない（terminal・履歴としての閲覧は維持）。
//     修正は既存行の上書きではなく replacement（旧 REVOKED + 新規 PENDING）。
//   - 予約番号は照合キーとしてフル表示する（この画面は for ウズプロ権限を通過した運営のみ）。
//   - 項目が多いため横スクロールさせる。内容が単純に切れて見えなくならないよう
//     ラッパに overflow-x-auto を置き、各セルは意味に応じて nowrap / 折り返しを使い分ける。

import { useState } from "react";
import { formatDateTime } from "@/lib/format-datetime";
import { ACTIVITY_TONE_CLASS, type ActivityTone } from "@/lib/activity-feed";
import type { TicketLinkAdminRow } from "@/lib/uzupro/ticket-link-view";
import type { TicketLinkStatus } from "@prisma/client";
import type { TicketLinkTicketTypeSetting } from "@/types";
import { TicketLinkRevokeDialog } from "./_revoke-dialog";
import { TicketLinkEditDialog } from "./_edit-dialog";

/** 既存 enum → 表示トーン。状態は色だけでなくラベル文字でも判別できる。 */
const STATUS_TONE: Record<TicketLinkStatus, ActivityTone> = {
  PENDING_UZU_BOOKING: "amber",
  LINKED: "green",
  CONFLICT: "red",
  REVOKED: "gray",
};

/** 登録経路の表示名。未知値は素の値をそのまま出す（勝手に握りつぶさない）。 */
const SOURCE_LABEL: Record<string, string> = {
  LIFF_MANUAL: "LIFF 手動入力",
  LIFF_IMAGE: "LIFF 画像",
  LINE_IMAGE: "LINE 画像",
  LINE_TEXT: "LINE テキスト",
};

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold text-ink-3";
const TD = "whitespace-nowrap px-3 py-2.5 align-top text-[12px] text-ink-2";

export function TicketLinkTable({
  rows,
  oaId,
  workId,
  ticketTypes,
}: {
  rows: TicketLinkAdminRow[];
  oaId: string;
  workId: string;
  /** 作品設定の**有効な**チケット種別。修正ダイアログの選択肢・人数の正。 */
  ticketTypes: TicketLinkTicketTypeSetting[];
}) {
  // 解除確認ダイアログの対象行（null = 閉じている）。
  const [target, setTarget] = useState<TicketLinkAdminRow | null>(null);
  // 修正ダイアログの対象行（null = 閉じている）。
  const [editTarget, setEditTarget] = useState<TicketLinkAdminRow | null>(null);
  // 有効なチケット種別が 1 件も無いと人数を確定できないため修正させない（fail closed）。
  const canEdit = ticketTypes.length > 0;

  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-line bg-surface px-6 py-12 text-center shadow-sm">
        <p className="text-[13px] font-bold text-ink-2">該当するチケット連携がありません</p>
        <p className="mt-1 text-[12px] text-ink-3">
          条件を変更するか、プレイヤーが LIFF から連携するとここに表示されます。
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[1200px] border-collapse">
        <thead>
          <tr className="border-b border-line bg-line-2/40">
            <th scope="col" className={TH}>状態</th>
            <th scope="col" className={TH}>予約番号</th>
            <th scope="col" className={TH}>チケット種別</th>
            <th scope="col" className={TH}>人数</th>
            <th scope="col" className={TH}>コードネーム</th>
            <th scope="col" className={TH}>登録経路</th>
            <th scope="col" className={TH}>登録日時</th>
            <th scope="col" className={TH}>確定日時</th>
            <th scope="col" className={TH}>更新日時</th>
            <th scope="col" className={TH}>CMS 同期</th>
            <th scope="col" className={TH}>
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-b-0">
              <td className={TD}>
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold " +
                    ACTIVITY_TONE_CLASS[STATUS_TONE[r.status]]
                  }
                >
                  {r.statusLabel}
                </span>
              </td>

              {/* 照合キー。表記ゆれがあった場合のみ原文を併記する（通常は 1 行）。 */}
              <td className={TD}>
                <span className="font-num text-[13px] font-bold text-ink">{r.reservationNumber}</span>
                {r.reservationNumberDiffers && (
                  <span className="mt-0.5 block text-[11px] text-ink-3">
                    入力原文: {r.reservationNumberRaw}
                  </span>
                )}
              </td>

              {/* td の max-width は table-layout:auto では効かないため、内側の block で幅を決める。
                  max だけだと他列に押されて過度に圧縮されるので min も併せて指定する
                  （min が無いと短い種別名まで不必要に折り返す）。 */}
              <td className={TD}>
                <div className="min-w-[150px] max-w-[220px] whitespace-normal break-words [overflow-wrap:anywhere]">
                  {r.ticketType ?? "—"}
                </div>
              </td>

              <td className={TD}>
                <span className="font-num">{r.participantCount}</span> 名
              </td>

              {/* 人数分を縦に並べる。長いコードネームでも崩れないよう折り返す。 */}
              <td className={TD}>
                <div className="min-w-[130px] max-w-[240px] whitespace-normal">
                  {r.codeNames.length === 0 ? (
                    "—"
                  ) : (
                    <ul className="space-y-0.5">
                      {r.codeNames.map((c, i) => (
                        <li key={i} className="break-words [overflow-wrap:anywhere]">
                          <span className="text-ink-3">・</span>{c}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.codeNames.length !== r.participantCount && (
                    <span className="mt-0.5 block text-[11px] text-warn">
                      登録 {r.codeNames.length} / {r.participantCount} 名
                    </span>
                  )}
                </div>
              </td>

              <td className={TD}>{SOURCE_LABEL[r.source] ?? r.source}</td>
              <td className={TD}>{formatDateTime(r.createdAt)}</td>
              <td className={TD}>{formatDateTime(r.confirmedAt)}</td>
              <td className={TD}>{formatDateTime(r.updatedAt)}</td>
              <td className={TD}>
                {r.uzuSyncedAt ? (
                  formatDateTime(r.uzuSyncedAt)
                ) : (
                  <span className="text-ink-3">未同期</span>
                )}
              </td>

              {/* 操作: 修正 / 解除。既に無効な行には出さない（terminal・履歴として閲覧だけ残す）。 */}
              <td className={TD + " text-right"}>
                {r.status === "REVOKED" ? (
                  <span className="text-[11px] text-ink-3">—</span>
                ) : (
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={!canEdit}
                      title={canEdit ? undefined : "チケット種別が設定されていないため修正できません"}
                      onClick={() => setEditTarget(r)}
                      className={
                        "rounded-lg border border-line px-2 py-1 text-[11px] font-semibold " +
                        (canEdit
                          ? "text-ink-3 hover:border-brand/40 hover:text-brand-ink"
                          : "cursor-not-allowed text-ink-3 opacity-50")
                      }
                    >
                      内容を修正
                    </button>
                    <button
                      type="button"
                      onClick={() => setTarget(r)}
                      className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink-3 hover:border-danger/40 hover:text-danger"
                    >
                      連携を解除
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {target && (
        <TicketLinkRevokeDialog
          oaId={oaId}
          workId={workId}
          row={target}
          onClose={() => setTarget(null)}
        />
      )}

      {editTarget && (
        <TicketLinkEditDialog
          oaId={oaId}
          workId={workId}
          row={editTarget}
          ticketTypes={ticketTypes}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
