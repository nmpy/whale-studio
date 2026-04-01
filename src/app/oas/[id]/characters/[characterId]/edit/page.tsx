"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";

interface FormState {
  name:           string;
  icon_image_url: string;
  sort_order:     number;
  is_active:      boolean;
}

export default function CharacterEditPage() {
  const params  = useParams<{ id: string; characterId: string }>();
  const oaId    = params.id;
  const charId  = params.characterId;
  const router  = useRouter();
  const { showToast } = useToast();

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

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setErrors({});

    const clientErrors: Record<string, string[]> = {};
    if (!form.name.trim())           clientErrors.name          = ["キャラクター名を入力してください"];
    if (!form.icon_image_url.trim()) clientErrors.icon_image_url = ["アイコン画像 URL を入力してください"];
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); setSubmitting(false); return; }

    try {
      await characterApi.update(getDevToken(), charId, {
        name:           form.name.trim(),
        icon_type:      "image",
        icon_text:      null,
        icon_image_url: form.icon_image_url.trim(),
        sort_order:     form.sort_order,
        is_active:      form.is_active,
      });
      showToast(`「${form.name}」を保存しました`, "success");
      router.push(`/oas/${oaId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "キャラクター一覧", href: `/oas/${oaId}/characters` },
      { label: "編集" },
    ]} />
  );

  if (!form && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>キャラクター編集</h2></div>
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
          <div>{breadcrumb}<h2>キャラクター編集</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{form!.name}</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {/* アイコンプレビュー */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          {form!.icon_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form!.icon_image_url} alt="プレビュー"
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "2px solid #e5e5e5" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "#e5e7eb",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#9ca3af", border: "2px solid #e5e5e5",
            }}>?</div>
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
              onChange={(e) => setField("name", e.target.value)} maxLength={50} />
            {errors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="icon_image_url">
              アイコン画像 URL <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input id="icon_image_url" type="url" value={form!.icon_image_url}
              onChange={(e) => setField("icon_image_url", e.target.value)} />
            {errors.icon_image_url?.map((m) => <p key={m} className="field-error">{m}</p>)}
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              HTTPS URL・正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
            </p>
          </div>

          <hr className="section-divider" />

          <div className="form-group">
            <label htmlFor="sort_order">表示順</label>
            <input id="sort_order" type="number" value={form!.sort_order}
              onChange={(e) => setField("sort_order", Number(e.target.value))} min={0} style={{ width: 120 }} />
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
              <input type="checkbox" checked={form!.is_active}
                onChange={(e) => setField("is_active", e.target.checked)} style={{ width: "auto" }} />
              このキャラクターを有効にする
            </label>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/characters`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
