"use client";

// src/app/oas/[id]/works/[workId]/characters/page.tsx
// 作品配下キャラクター一覧 + システムキャラクター選択 + 削除 / 有効・無効トグル。
// Phase 4.1a: UI を Phase 0 トークン + shared/Button + shared/StatusBadge + buttonClass に揃える。
// new / edit ページには触らない (= Phase 4.1b 対象)。
// OA-level /oas/[id]/characters/ も触らない (= 別 PR 候補)。
// load / handleSaveSystemChar / handleDelete / toggleActive / API / 権限判定 / systemCharId 保護は完全維持。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { workApi, characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Character } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { GuideCard } from "@/components/onboarding/GuideCard";
import { Button, StatusBadge, buttonClass } from "@/components/shared";

// 行内 select / input 共通 className (= Phase 3.1 以降の compact 入力 pattern と統一)
const compactInputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

function IconPreview({ character }: { character: Character }) {
  if (character.icon_type === "image" && character.icon_image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.icon_image_url}
        alt={character.name}
        className="block h-9 w-9 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ background: character.icon_color ?? "#6366f1" }}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
    >
      {character.icon_text ?? character.name.charAt(0)}
    </div>
  );
}

export default function WorkCharacterListPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]           = useState("");
  const [systemCharId, setSystemCharId]     = useState<string | null>(null);
  const [savingSystemChar, setSavingSystemChar] = useState(false);
  const [characters, setCharacters]         = useState<Character[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [work, chars] = await Promise.all([
        workApi.get(token, workId),
        characterApi.list(token, workId),
      ]);
      setWorkTitle(work.title);
      setSystemCharId(work.system_character_id ?? null);
      setCharacters(chars.sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [workId]);

  async function handleSaveSystemChar() {
    setSavingSystemChar(true);
    try {
      await workApi.update(getDevToken(), workId, { system_character_id: systemCharId });
      showToast("システムキャラクターを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingSystemChar(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？\nこのキャラクターが紐づいたメッセージからは参照が外れます。`)) return;
    try {
      await characterApi.delete(getDevToken(), id);
      showToast(`「${name}」を削除しました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  async function toggleActive(character: Character) {
    try {
      await characterApi.update(getDevToken(), character.id, { is_active: !character.is_active });
      showToast(`「${character.name}」を${!character.is_active ? "有効" : "無効"}にしました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新に失敗しました", "error");
    }
  }

  const selectedSystemChar = characters.find((c) => c.id === systemCharId) ?? null;

  return (
    <>
      <ViewerBanner role={role} />

      {/* ── ページヘッダー ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "キャラクター管理" },
          ]} />
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            キャラクター管理
          </h2>
        </div>
        {canEdit && (
          <Link
            href={`/oas/${oaId}/works/${workId}/characters/new`}
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            + キャラクターを追加
          </Link>
        )}
      </div>

      {/* ── エラー ── */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={load}>
            再読み込み
          </Button>
        </div>
      )}

      {/* ── 初回ガイド（キャラクター未作成時） ── */}
      {!loading && characters.length === 0 && (
        <GuideCard
          message="キャラクターを作成すると、メッセージの送信者として設定できます。名前・アイコン画像を設定して、各メッセージに紐づけましょう。"
          ctaText="キャラクターを追加 →"
          ctaHref={`/oas/${oaId}/works/${workId}/characters/new`}
        />
      )}

      {/* ── 使い方ガイド (= 別管理、触らず) ── */}
      <HelpAccordion items={[
        { title: "この画面でできること", points: [
          "LINE のメッセージ送信者として表示されるキャラクターを管理します",
          "アイコン画像と名前がトーク画面に表示されます",
        ]},
        { title: "操作手順", points: [
          "「+ キャラクターを追加」でキャラクターを作成",
          "アイコン画像URL（HTTPS必須）と名前を設定します",
          "作成後、メッセージ管理でキャラクターをメッセージに紐づけます",
        ]},
        { title: "注意点", points: [
          "アイコン画像は HTTPS の URL のみ有効（HTTP は LINE API に拒否されます）",
          "名前は最大20文字（LINE API の制限）",
          "キャラクターを削除するとメッセージの送信者が空欄になります",
        ]},
      ]} />

      {/* ══ システムキャラクター（必須） ══ */}
      <div className="mb-6 w-full max-w-[640px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="mb-1 flex items-center gap-2">
          <p className="m-0 text-[13px] font-bold text-ink">システムキャラクター</p>
          <span className="rounded-full border border-danger/30 bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">
            必須
          </span>
        </div>
        <p className="mb-4 text-[12px] leading-[1.6] text-ink-2">
          開始・エラー等のシステムメッセージに使う送信者を設定します。未設定の場合は OA デフォルト名義で送信されます。
        </p>

        {loading ? (
          <div className="skeleton" style={{ height: 38, borderRadius: 6 }} />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={systemCharId ?? ""}
                onChange={(e) => setSystemCharId(e.target.value || null)}
                disabled={!canEdit}
                aria-label="システムキャラクターを選択"
                className={compactInputClass + " flex-1"}
              >
                <option value="">（OA デフォルト — 設定しない）</option>
                {characters.filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveSystemChar}
                disabled={!canEdit || savingSystemChar}
                aria-busy={savingSystemChar || undefined}
                className="sm:flex-shrink-0"
              >
                {savingSystemChar && <span className="spinner" aria-hidden="true" />}
                {savingSystemChar ? "保存中..." : "保存"}
              </Button>
            </div>

            {selectedSystemChar && (
              <div className="mt-2.5 flex items-center gap-2.5 rounded-field border border-brand/30 bg-brand-soft px-3 py-2">
                <IconPreview character={selectedSystemChar} />
                <div className="text-[13px]">
                  <span className="font-bold text-ink">{selectedSystemChar.name}</span>
                  {selectedSystemChar.icon_image_url ? (
                    <span className="ml-2 text-[11px] text-brand-ink">アイコン画像あり</span>
                  ) : (
                    <span className="ml-2 text-[11px] text-danger">画像URL未設定（name のみ）</span>
                  )}
                </div>
              </div>
            )}

            {characters.length === 0 && (
              <p className="mt-2 text-[12px] text-ink-3">
                先にキャラクターを追加すると、ここで選択できます。
              </p>
            )}
          </>
        )}
      </div>

      {/* ══ キャラクター一覧 ══ */}
      {loading ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <table>
            <thead>
              <tr>{["アイコン", "名前", "種別", "順序", "状態", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  <td><div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} /></td>
                  {[120, 80, 40, 60, 180].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: w, height: 14 }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : characters.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-[16px] font-bold text-ink">キャラクターがまだいません</p>
          <p className="mt-2 text-[13px] leading-[1.75] text-ink-2">
            作品に登場するキャラクターを追加しましょう。
            <br />
            キャラクターはメッセージの送信者として使用できます。
          </p>
          {canEdit && (
            <Link
              href={`/oas/${oaId}/works/${workId}/characters/new`}
              className={buttonClass({ variant: "primary", size: "md", className: "mt-4" })}
            >
              + 最初のキャラクターを追加
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>アイコン</th>
                  <th>名前</th>
                  <th>アイコン種別</th>
                  <th style={{ textAlign: "center" }}>順序</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {characters.map((c) => (
                  <tr key={c.id}>
                    <td><IconPreview character={c} /></td>
                    <td className="font-semibold text-ink">
                      {c.name}
                      {c.id === systemCharId && (
                        // 「システム」識別ラベル (= status ではなくロール識別、ローカル小バッジで維持)
                        <span className="ml-1.5 inline-flex items-center rounded-full border border-lilac/30 bg-lilac-soft px-1.5 py-0.5 text-[10px] font-bold text-lilac">
                          システム
                        </span>
                      )}
                    </td>
                    <td className="text-[12px] text-ink-3">
                      {c.icon_type === "text" ? `テキスト「${c.icon_text ?? ""}」` : "画像URL"}
                    </td>
                    <td className="text-center text-ink-3">{c.sort_order}</td>
                    <td>
                      <StatusBadge tone={c.is_active ? "active" : "muted"}>
                        {c.is_active ? "有効" : "無効"}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {canEdit && (
                          <Link
                            href={`/oas/${oaId}/works/${workId}/characters/${c.id}/edit`}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            編集
                          </Link>
                        )}
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(c)}
                          >
                            {c.is_active ? "無効化" : "有効化"}
                          </Button>
                        )}
                        {(isOwner || isAdmin) && c.id !== systemCharId && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(c.id, c.name)}
                          >
                            削除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line-2 px-4 py-2.5 text-[12px] text-ink-3">
            {characters.length} 件
          </div>
        </div>
      )}
    </>
  );
}
