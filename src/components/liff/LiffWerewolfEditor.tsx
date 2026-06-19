"use client";

// src/components/liff/LiffWerewolfEditor.tsx
//
// 人狼 / 配役閲覧モード — Phase 1 CMS 編集 UI。
//
// Phase 1 スコープ (このファイルで提供する機能):
//   - タイトル一覧
//   - 「+ タイトル追加」モーダル (title / description / scheduled_at / player_count 入力)
//   - 削除ボタン
//   - 「slot/card 編集 / ゲーム開始 / QR 発行は Phase 2 で対応予定」のお知らせ
//
// Phase 2 で追加するもの (このファイル or 別 component で実装予定):
//   - タイトル詳細編集ページ (scheduledAt 等の変更)
//   - 配役スロット編集 (label / cards)
//   - 配役カード CRUD + 並び替え
//   - QR 表示 + 一覧印刷
//   - 「ゲーム開始」ボタン (確認ダイアログつき)

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { werewolfApi, getDevToken } from "@/lib/api-client";
import type { WerewolfTitle } from "@/types";

interface Props {
  workId: string;
  liffPageConfigId: string;
  readOnly: boolean;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "未設定";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "未設定";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/** HTML datetime-local の value を ISO 文字列 (offset 込み) に変換。
 *  未入力なら null を返す。 */
function datetimeLocalToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function LiffWerewolfEditor({ workId, liffPageConfigId, readOnly }: Props) {
  const { showToast } = useToast();
  const params = useParams();
  const oaId = params.id as string;
  const [titles, setTitles] = useState<WerewolfTitle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await werewolfApi.listTitles(getDevToken(), workId, {
        liff_page_config_id: liffPageConfigId,
      });
      setTitles(res.titles);
    } catch {
      showToast("人狼タイトル一覧の読み込みに失敗しました", "error");
    } finally {
      setLoading(false);
    }
  }, [workId, liffPageConfigId, showToast]);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = async (title: WerewolfTitle) => {
    if (readOnly) return;
    if (!window.confirm(`「${title.title}」を削除しますか？\n配下のスロット・配役カードもすべて削除されます。`)) return;
    try {
      await werewolfApi.deleteTitle(getDevToken(), workId, title.id);
      showToast("タイトルを削除しました", "success");
      await reload();
    } catch {
      showToast("削除に失敗しました", "error");
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-900">人狼 / 配役閲覧 — タイトル一覧</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold transition-colors hover:bg-brand-deep"
          >
            ＋ タイトル追加
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-500 mb-4 leading-relaxed">
        GM がプレイヤーごとに配役情報を配布するためのモードです。
        タイトル単位でプレイヤー人数分の配役スロットを作成し、QR コードで配布します。
        「編集」から各スロットの配役カードや QR、ゲーム開始操作を行えます。
      </p>

      {loading ? (
        <div className="h-16 bg-gray-100 rounded animate-pulse" />
      ) : (titles && titles.length === 0) ? (
        <div className="bg-gray-50 rounded-lg p-6 text-center border-2 border-dashed border-gray-200">
          <p className="text-3xl mb-2">🐺</p>
          <p className="text-sm text-gray-500 mb-1">タイトルがまだ登録されていません</p>
          <p className="text-[11px] text-gray-400">「タイトル追加」ボタンから最初の 1 件を作成してください</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {titles?.map((t) => (
            <li key={t.id} className="px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-[14px] font-bold text-gray-900 truncate">{t.title}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    t.is_started
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {t.is_started ? "開始済み" : "開始前"}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>プレイ予定: {formatDateTime(t.scheduled_at)}</span>
                  <span>プレイヤー: {t.player_count} 名</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/oas/${oaId}/works/${workId}/liff/${liffPageConfigId}/werewolf/${t.id}`}
                  className="px-2.5 py-1 text-xs bg-brand text-white rounded font-semibold transition-colors hover:bg-brand-deep"
                >
                  編集
                </Link>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDelete(t)}
                    className="px-2.5 py-1 text-xs text-red-600 rounded border border-red-200 transition-colors hover:bg-red-50"
                  >
                    削除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAddModal && (
        <AddTitleModal
          workId={workId}
          liffPageConfigId={liffPageConfigId}
          onCreated={async () => {
            setShowAddModal(false);
            await reload();
            showToast("タイトルを作成しました", "success");
          }}
          onCancel={() => setShowAddModal(false)}
          onError={(msg) => showToast(msg, "error")}
        />
      )}
    </div>
  );
}

// ── 追加モーダル ─────────────────────────────────────────────────────────────
function AddTitleModal({
  workId, liffPageConfigId, onCreated, onCancel, onError,
}: {
  workId: string;
  liffPageConfigId: string;
  onCreated: () => Promise<void> | void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [playerCount, setPlayerCount] = useState(8);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onError("タイトル名を入力してください");
      return;
    }
    setSaving(true);
    try {
      await werewolfApi.createTitle(getDevToken(), workId, {
        liff_page_config_id: liffPageConfigId,
        title:               title.trim(),
        description:         description.trim() || null,
        scheduled_at:        datetimeLocalToISO(scheduledAt),
        player_count:        playerCount,
      });
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <h3 className="text-base font-bold text-gray-900 mb-4">人狼タイトルを追加</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">タイトル名 <span className="text-red-500">*</span></label>
            <input
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: パンドラの人狼 第1ゲーム"
              maxLength={100}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">説明 (任意)</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: テストプレイA卓"
              rows={2}
              maxLength={1000}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">プレイ予定日時 (任意)</label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">プレイヤー人数 <span className="text-red-500">*</span></label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={playerCount}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setPlayerCount(Math.max(1, Math.min(50, Math.floor(n))));
                }}
                min={1}
                max={50}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">人数分の配役スロットが自動生成されます。</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-md text-sm transition-colors hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-brand text-white rounded-md text-sm font-semibold transition-colors hover:bg-brand-deep disabled:opacity-50"
            >
              {saving ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
