"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { TLink as Link } from "@/components/TLink";
import { Breadcrumb } from "@/components/Breadcrumb";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

interface FormState {
  name:           string;
  icon_image_url: string;
  sort_order:     number;
  is_active:      boolean;
}

export default function WorkCharacterEditPage() {
  const params      = useParams<{ id: string; workId: string; characterId: string }>();
  const oaId        = params.id;
  const workId      = params.workId;
  const charId      = params.characterId;
  const router      = useRouter();
  const { showToast } = useToast();
  const { role, canEdit } = useWorkspaceRole(oaId);

  const [form, setForm]             = useState<FormState | null>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    characterApi.get(getDevToken(), charId)
      .then((c) => setForm({
        name:           c.name,
        icon_image_url: c.icon_image_url ?? "",
        sort_order:     c.sort_order,
        is_active:      c.is_active,
      }))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [charId]);

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: val } : null);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setErrors({});

    const errs: Record<string, string[]> = {};
    if (!form.name.trim())          errs.name          = ["キャラクター名を入力してください"];
    if (!form.icon_image_url.trim()) errs.icon_image_url = ["アイコン画像 URL を入力してください"];
    if (Object.keys(errs).length) { setErrors(errs); setSubmitting(false); return; }

    try {
      await characterApi.update(getDevToken(), charId, {
        name:           form.name.trim(),
        icon_type:      "image",
        icon_image_url: form.icon_image_url.trim(),
        icon_text:      null,
        sort_order:     form.sort_order,
        is_active:      form.is_active,
      });
      showToast(`「${form.name}」を保存しました`, "success");
      router.push(`/oas/${oaId}/works/${workId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!form && !loadError) {
    return (
      <>
        <div className="page-header">
          <h2>キャラクター編集</h2>
          <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">← 一覧に戻る</Link>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <h2>キャラクター編集</h2>
          <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">← 一覧に戻る</Link>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "キャラクター", href: `/oas/${oaId}/works/${workId}/characters` },
            { label: "編集" },
          ]} />
          <h2>{form!.name}</h2>
        </div>
        <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">← 一覧に戻る</Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {/* プレビュー */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          {form!.icon_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form!.icon_image_url} alt="プレビュー"
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "2px solid #e5e5e5" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "#e5e7eb", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 20, color: "#9ca3af",
              border: "2px solid #e5e5e5",
            }}>
              ?
            </div>
          )}
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            <p style={{ fontWeight: 500 }}>アイコンプレビュー</p>
            <p style={{ fontSize: 11, marginTop: 2 }}>URL を変更するとリアルタイム更新</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">キャラクター名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="name" type="text" value={form!.name}
              onChange={(e) => setField("name", e.target.value)} maxLength={50} readOnly={!canEdit} />
            {errors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="icon_image_url">
              アイコン画像 URL <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input id="icon_image_url" type="url" value={form!.icon_image_url}
              onChange={(e) => setField("icon_image_url", e.target.value)} readOnly={!canEdit} />
            {errors.icon_image_url?.map((m) => <p key={m} className="field-error">{m}</p>)}
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              HTTPS URL・正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
            </p>
          </div>

          <hr className="section-divider" />

          <div className="form-group">
            <label htmlFor="sort_order">表示順</label>
            <input id="sort_order" type="number" value={form!.sort_order}
              onChange={(e) => setField("sort_order", Number(e.target.value))} min={0} style={{ width: 120 }} disabled={!canEdit} />
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
              <input type="checkbox" checked={form!.is_active}
                onChange={(e) => setField("is_active", e.target.checked)} style={{ width: "auto" }} disabled={!canEdit} />
              このキャラクターを有効にする
            </label>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={!canEdit || submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
