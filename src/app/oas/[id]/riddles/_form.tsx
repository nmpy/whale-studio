"use client";

// src/app/oas/[id]/riddles/_form.tsx
// 謎作成・編集フォーム（new/page.tsx と [rid]/page.tsx で共用）

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { uploadApi, workApi, characterApi, segmentApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Segment } from "@/types";
import { RiddlePreview } from "./_preview";
import { useToast } from "@/components/Toast";
import type {
  Riddle,
  RiddleQuestionType,
  RiddleMatchCondition,
  RiddleStatus,
  CarouselCard,
  CreateRiddleBody,
  Hint,
  HintQuickReply,
  HintActionType,
  Character,
} from "@/types";

// ── 定数 ─────────────────────────────────────────────────

export const QUESTION_TYPE_OPTIONS: {
  value: RiddleQuestionType;
  label: string;
  desc:  string;
}[] = [
  { value: "text",     label: "テキスト",           desc: "文字で出題" },
  { value: "image",    label: "画像",               desc: "画像で出題" },
  { value: "video",    label: "動画",               desc: "動画URLで出題" },
  { value: "carousel", label: "カルーセル",          desc: "複数カードで出題" },
];

export const MATCH_CONDITION_OPTIONS: {
  value: RiddleMatchCondition;
  label: string;
  desc:  string;
}[] = [
  { value: "exact",             label: "完全一致",              desc: "入力がそのまま正解と一致" },
  { value: "partial",           label: "部分一致",              desc: "正解テキストを含む" },
  { value: "case_insensitive",  label: "大文字・小文字無視",    desc: "ABC = abc" },
  { value: "normalize_width",   label: "全角・半角吸収",        desc: "Ａ = A、１ = 1" },
  { value: "normalize_kana",    label: "ひらがな・カタカナ吸収", desc: "あ = ア" },
];

// ── フォーム状態型 ────────────────────────────────────────

export interface FormState {
  title:               string;
  question_type:       RiddleQuestionType;
  question_text:       string;
  question_image_url:  string;
  question_video_url:  string;
  question_carousel:   CarouselCard[];
  answer_text:         string;
  match_condition:     RiddleMatchCondition;
  correct_message:     string;
  wrong_message:       string;
  status:              RiddleStatus;
  hints:               Hint[];
  character_id:        string | null;
  target_segment:      string | null;
  /** 作品スコープ管理用（null = OA スコープのまま） */
  work_id:             string | null;
}

export const EMPTY_FORM: FormState = {
  title:               "",
  question_type:       "text",
  question_text:       "",
  question_image_url:  "",
  question_video_url:  "",
  question_carousel:   [],
  answer_text:         "",
  match_condition:     "exact",
  correct_message:     "",
  wrong_message:       "",
  status:              "draft",
  hints:               [],
  character_id:        null,
  target_segment:      null,
  work_id:             null,
};

const HINT_ACTION_OPTIONS: { value: HintActionType; label: string; desc: string }[] = [
  { value: "next_hint",    label: "次のヒントへ",     desc: "次のステップのヒントを表示" },
  { value: "repeat_hint",  label: "もう一度表示",     desc: "同じヒントを再送信" },
  { value: "cancel_hint",  label: "ヒントをやめる",   desc: "ヒントをキャンセルして問題に戻る" },
  { value: "custom",       label: "カスタム",         desc: "任意テキストを送信" },
];

export function riddleToFormState(r: Riddle): FormState {
  return {
    title:               r.title,
    question_type:       r.question_type,
    question_text:       r.question_text       ?? "",
    question_image_url:  r.question_image_url  ?? "",
    question_video_url:  r.question_video_url  ?? "",
    question_carousel:   r.question_carousel   ?? [],
    answer_text:         r.answer_text,
    match_condition:     r.match_condition,
    correct_message:     r.correct_message,
    wrong_message:       r.wrong_message,
    status:              r.status,
    hints:               r.hints ?? [],
    character_id:        r.character_id   ?? null,
    target_segment:      r.target_segment ?? null,
    work_id:             r.work_id        ?? null,
  };
}

export function formStateToBody(f: FormState): CreateRiddleBody {
  return {
    title:               f.title.trim(),
    question_type:       f.question_type,
    question_text:       f.question_type === "text"     ? f.question_text.trim()      : null,
    question_image_url:  f.question_type === "image"    ? f.question_image_url.trim() : null,
    question_video_url:  f.question_type === "video"    ? f.question_video_url.trim() : null,
    question_carousel:   f.question_type === "carousel" ? f.question_carousel         : null,
    answer_text:         f.answer_text.trim(),
    match_condition:     f.match_condition,
    correct_message:     f.correct_message.trim(),
    wrong_message:       f.wrong_message.trim(),
    status:              f.status,
    hints:               f.hints,
    character_id:        f.character_id   || null,
    target_segment:      f.target_segment || null,
    work_id:             f.work_id        || null,
  };
}

// ── バリデーション ───────────────────────────────────────

export function validateForm(f: FormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!f.title.trim())          errs.title        = "タイトルは必須です";
  if (f.question_type === "text"     && !f.question_text.trim())      errs.question_text      = "問題文を入力してください";
  if (f.question_type === "image"    && !f.question_image_url.trim()) errs.question_image_url = "画像URLを入力してください";
  if (f.question_type === "video"    && !f.question_video_url.trim()) errs.question_video_url = "動画URLを入力してください";
  if (f.question_type === "carousel" && f.question_carousel.length === 0)
    errs.question_carousel = "カードを1枚以上追加してください";
  if (!f.answer_text.trim())    errs.answer_text    = "正解テキストは必須です";
  if (!f.correct_message.trim()) errs.correct_message = "正解時メッセージは必須です";
  if (!f.wrong_message.trim())   errs.wrong_message   = "不正解時メッセージは必須です";
  return errs;
}

// ── Props ────────────────────────────────────────────────

interface RiddleFormProps {
  oaId:        string;
  oaTitle:     string;
  initialForm: FormState;
  isNew:       boolean;
  submitting:  boolean;
  deleting?:   boolean;
  onSubmit:    (form: FormState) => Promise<void>;
  onDelete?:   () => Promise<void>;
  canEdit?:    boolean;
  canDelete?:  boolean;
}

// ── コンポーネント ───────────────────────────────────────

export function RiddleForm({
  oaId, oaTitle, initialForm, isNew,
  submitting, deleting = false,
  onSubmit, onDelete,
  canEdit = true, canDelete = true,
}: RiddleFormProps) {
  const { showToast } = useToast();
  const [form, setForm]     = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // レイアウト（ワイド = 2カラム / ナロー = タブ切り替え）
  const [wideLayout,  setWideLayout]  = useState(true);
  const [activeTab,   setActiveTab]   = useState<"form" | "preview">("form");
  useEffect(() => {
    const check = () => setWideLayout(window.innerWidth >= 1000);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 作品一覧（work セレクタ + キャラクター用）
  const [works, setWorks]           = useState<WorkListItem[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  useEffect(() => {
    const token = getDevToken();
    workApi.list(token, oaId).then((list) => {
      setWorks(list);
      Promise.all(list.map((w) => characterApi.list(token, w.id))).then((arrays) => {
        const seen = new Set<string>();
        const flat: Character[] = [];
        for (const arr of arrays) {
          for (const c of arr) {
            if (!seen.has(c.id)) { seen.add(c.id); flat.push(c); }
          }
        }
        setCharacters(flat);
      });
    }).catch(() => {});
  }, [oaId]);

  // セグメント一覧（送信対象セグメント用）
  const [segments, setSegments] = useState<Segment[]>([]);
  useEffect(() => {
    segmentApi.list(getDevToken(), oaId)
      .then((list) => setSegments(list.filter((s) => s.status === "active")))
      .catch(() => {});
  }, [oaId]);

  // 画像アップロード
  const fileInputRef              = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState(initialForm.question_image_url);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key as string]; return n; });
  }

  // ── 画像アップロード ──────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);
    setUploading(true);
    try {
      const { url } = await uploadApi.uploadImage(getDevToken(), file);
      URL.revokeObjectURL(objectUrl);
      setImagePreview(url);
      setField("question_image_url", url);
      showToast("画像をアップロードしました", "success");
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setImagePreview(form.question_image_url);
      showToast(err instanceof Error ? err.message : "アップロードに失敗しました", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── カルーセルカード操作 ──────────────────────────────
  function addCard() {
    setField("question_carousel", [...form.question_carousel, { title: "", description: "", image_url: "" }]);
    setErrors((e) => { const n = { ...e }; delete n["question_carousel"]; return n; });
  }

  function updateCard(index: number, key: keyof CarouselCard, value: string) {
    const cards = form.question_carousel.map((c, i) => i === index ? { ...c, [key]: value } : c);
    setField("question_carousel", cards);
  }

  function removeCard(index: number) {
    setField("question_carousel", form.question_carousel.filter((_, i) => i !== index));
  }

  // ── ヒント操作 ────────────────────────────────────────
  function addHint() {
    const step = form.hints.length + 1;
    const defaultQRs: HintQuickReply[] = [
      { label: "次のヒント", action_type: "next_hint",   action_value: "" },
      { label: "やめる",     action_type: "cancel_hint", action_value: "" },
    ];
    setField("hints", [...form.hints, { step, text: "", character_id: null, quick_replies: defaultQRs }]);
  }

  function updateHint(index: number, key: keyof Hint, value: Hint[keyof Hint]) {
    const hints = form.hints.map((h, i) => i === index ? { ...h, [key]: value } : h);
    setField("hints", hints);
  }

  function moveHint(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= form.hints.length) return;
    const hints = [...form.hints];
    [hints[index], hints[target]] = [hints[target], hints[index]];
    setField("hints", hints.map((h, i) => ({ ...h, step: i + 1 })));
  }

  function removeHint(index: number) {
    const hints = form.hints.filter((_, i) => i !== index).map((h, i) => ({ ...h, step: i + 1 }));
    setField("hints", hints);
  }

  function addQuickReply(hintIndex: number) {
    const qr: HintQuickReply = { label: "次のヒント", action_type: "next_hint", action_value: "" };
    const hints = form.hints.map((h, i) =>
      i === hintIndex ? { ...h, quick_replies: [...h.quick_replies, qr] } : h
    );
    setField("hints", hints);
  }

  function updateQuickReply(hintIndex: number, qrIndex: number, key: keyof HintQuickReply, value: string) {
    const hints = form.hints.map((h, i) => {
      if (i !== hintIndex) return h;
      const qrs = h.quick_replies.map((qr, j) => j === qrIndex ? { ...qr, [key]: value } : qr);
      return { ...h, quick_replies: qrs };
    });
    setField("hints", hints);
  }

  function removeQuickReply(hintIndex: number, qrIndex: number) {
    const hints = form.hints.map((h, i) => {
      if (i !== hintIndex) return h;
      return { ...h, quick_replies: h.quick_replies.filter((_, j) => j !== qrIndex) };
    });
    setField("hints", hints);
  }

  // ── 送信 ─────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    await onSubmit(form);
  }

  // ── 削除 ─────────────────────────────────────────────
  async function handleDelete() {
    if (!onDelete) return;
    if (!confirm(`この謎を削除しますか？\n「${form.title}」`)) return;
    await onDelete();
  }

  // ── レンダリング ──────────────────────────────────────
  const qType = form.question_type;

  return (
    <>
      {/* ─── ページヘッダー ─── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "謎管理", href: `/oas/${oaId}/riddles` },
            { label: isNew ? "新規作成" : "編集" },
          ]} />
          <h2>{isNew ? "謎を作成" : "謎を編集"}</h2>
        </div>
      </div>

      {/* ─── ナロー画面タブ ─── */}
      {!wideLayout && (
        <div style={{ display: "flex", marginBottom: 16, borderBottom: "2px solid #e5e5e5" }}>
          {(["form", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              style={{
                flex: 1, padding: "10px 0",
                fontWeight: 600, fontSize: 13,
                border: "none", background: "none", cursor: "pointer",
                borderBottom: activeTab === t ? "2px solid #06C755" : "2px solid transparent",
                color: activeTab === t ? "#06C755" : "#6b7280",
                marginBottom: -2,
              }}
            >
              {t === "form" ? "編集" : "プレビュー"}
            </button>
          ))}
        </div>
      )}

      {/* ─── 2カラムレイアウト ─── */}
      <div style={{
        display: "flex", gap: 24, alignItems: "flex-start",
        flexWrap: wideLayout ? "nowrap" : "wrap",
      }}>

      {/* ─── 左：編集フォーム ─── */}
      {(wideLayout || activeTab === "form") && (
      <div className="card" style={{ flex: "1 1 540px", minWidth: 0, maxWidth: 660 }}>
        <form onSubmit={handleSubmit}>

          {/* ── タイトル ── */}
          <div className="form-group">
            <label htmlFor="title">
              タイトル <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="title"
              type="text"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="例: 第1問・部屋の謎"
              maxLength={100}
            />
            {errors.title && <p className="field-error">{errors.title}</p>}
          </div>

          {/* ── 問題形式 ── */}
          <div className="form-group">
            <label>問題形式 <span style={{ color: "#ef4444" }}>*</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
              {QUESTION_TYPE_OPTIONS.map(({ value, label, desc }) => (
                <label
                  key={value}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 4, padding: "12px 8px", cursor: "pointer",
                    border: `2px solid ${qType === value ? "#06C755" : "#e5e5e5"}`,
                    borderRadius: 10, background: qType === value ? "#E6F7ED" : "#fff",
                    textAlign: "center",
                  }}
                >
                  <input type="radio" name="question_type" value={value}
                    checked={qType === value}
                    onChange={() => setField("question_type", value)}
                    style={{ display: "none" }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600, color: qType === value ? "#06C755" : "#374151" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>{desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── 問題内容（形式に応じて切り替え） ── */}
          <div className="form-group">
            <label>
              問題内容 <span style={{ color: "#ef4444" }}>*</span>
            </label>

            {/* テキスト */}
            {qType === "text" && (
              <>
                <textarea
                  value={form.question_text}
                  onChange={(e) => setField("question_text", e.target.value)}
                  placeholder="問題文を入力してください"
                  rows={5}
                  maxLength={5000}
                />
                <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 2 }}>
                  {form.question_text.length} / 5000
                </span>
                {errors.question_text && <p className="field-error">{errors.question_text}</p>}
              </>
            )}

            {/* 画像 */}
            {qType === "image" && (
              <>
                {imagePreview ? (
                  <div style={{ marginBottom: 8 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="問題画像プレビュー"
                      style={{
                        width: "100%", maxWidth: 400, borderRadius: 8,
                        border: "1px solid #e5e5e5", display: "block", marginBottom: 8,
                      }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "4px 12px" }}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? <><span className="spinner" /> アップロード中...</> : "画像を変更"}
                      </button>
                      <button type="button" className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "4px 12px", color: "#ef4444", borderColor: "#fecaca" }}
                        onClick={() => { setImagePreview(""); setField("question_image_url", ""); }}
                        disabled={uploading}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button" tabIndex={0}
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && !uploading && fileInputRef.current?.click()}
                    style={{
                      border: "2px dashed #d1d5db", borderRadius: 10,
                      padding: "28px 20px", textAlign: "center",
                      cursor: uploading ? "wait" : "pointer", background: "#fafafa",
                      marginBottom: 8,
                    }}
                    onMouseEnter={(e) => {
                      if (!uploading) {
                        (e.currentTarget as HTMLDivElement).style.borderColor = "#06C755";
                        (e.currentTarget as HTMLDivElement).style.background   = "#E6F7ED";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "#d1d5db";
                      (e.currentTarget as HTMLDivElement).style.background   = "#fafafa";
                    }}
                  >
                    {uploading ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#6b7280", fontSize: 13 }}>
                        <span className="spinner" style={{ borderColor: "#6b7280", borderTopColor: "transparent" }} />
                        アップロード中...
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 26, marginBottom: 6 }}>🖼</div>
                        <p style={{ fontSize: 13, color: "#374151", fontWeight: 500, marginBottom: 2 }}>クリックして画像を選択</p>
                        <p style={{ fontSize: 11, color: "#9ca3af" }}>JPEG / PNG / WebP / GIF・最大 5 MB</p>
                      </>
                    )}
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: "none" }} onChange={handleFileChange}
                />
                {errors.question_image_url && <p className="field-error">{errors.question_image_url}</p>}
              </>
            )}

            {/* 動画 */}
            {qType === "video" && (
              <>
                <input
                  type="url"
                  value={form.question_video_url}
                  onChange={(e) => setField("question_video_url", e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  style={{ fontFamily: "monospace", fontSize: 13 }}
                />
                {errors.question_video_url && <p className="field-error">{errors.question_video_url}</p>}
              </>
            )}

            {/* カルーセル */}
            {qType === "carousel" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                  {form.question_carousel.map((card, index) => (
                    <div
                      key={index}
                      style={{
                        padding: "14px 16px", border: "1px solid #e5e5e5",
                        borderRadius: 8, background: "#fafafa", position: "relative",
                      }}
                    >
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: 10,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                          カード {index + 1}
                        </span>
                        <button
                          type="button" className="btn btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                          onClick={() => removeCard(index)}
                        >
                          削除
                        </button>
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>
                          タイトル <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={card.title}
                          onChange={(e) => updateCard(index, "title", e.target.value)}
                          placeholder="カードのタイトル"
                          maxLength={100}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>説明文（任意）</label>
                        <textarea
                          value={card.description}
                          onChange={(e) => updateCard(index, "description", e.target.value)}
                          placeholder="カードの説明文"
                          maxLength={500}
                          rows={2}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>画像 URL（任意）</label>
                        <input
                          type="url"
                          value={card.image_url}
                          onChange={(e) => updateCard(index, "image_url", e.target.value)}
                          placeholder="https://example.com/image.png"
                          style={{ fontFamily: "monospace", fontSize: 12 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button" className="btn btn-ghost"
                  style={{ fontSize: 13, padding: "6px 14px" }}
                  onClick={addCard}
                >
                  ＋ カードを追加
                </button>
                {errors.question_carousel && (
                  <p className="field-error" style={{ marginTop: 6 }}>{errors.question_carousel}</p>
                )}
              </>
            )}
          </div>

          <hr className="section-divider" />

          {/* ── 正解テキスト ── */}
          <div className="form-group">
            <label htmlFor="answer_text">
              正解テキスト <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="answer_text"
              type="text"
              value={form.answer_text}
              onChange={(e) => setField("answer_text", e.target.value)}
              placeholder="例: 部屋番号は 415"
              maxLength={200}
            />
            {errors.answer_text && <p className="field-error">{errors.answer_text}</p>}
          </div>

          {/* ── マッチ条件 ── */}
          <div className="form-group">
            <label>マッチ条件 <span style={{ color: "#ef4444" }}>*</span></label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MATCH_CONDITION_OPTIONS.map(({ value, label, desc }) => (
                <label
                  key={value}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "9px 12px",
                    border: `2px solid ${form.match_condition === value ? "#06C755" : "#e5e5e5"}`,
                    borderRadius: 8, cursor: "pointer",
                    background: form.match_condition === value ? "#E6F7ED" : "#fff",
                  }}
                >
                  <input
                    type="radio" name="match_condition" value={value}
                    checked={form.match_condition === value}
                    onChange={() => setField("match_condition", value)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <hr className="section-divider" />

          {/* ── 正解時メッセージ ── */}
          <div className="form-group">
            <label htmlFor="correct_message">
              正解時メッセージ <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              id="correct_message"
              value={form.correct_message}
              onChange={(e) => setField("correct_message", e.target.value)}
              placeholder="例: 正解です！よく気づきましたね。次の謎へ進みましょう。"
              rows={3}
              maxLength={1000}
            />
            {errors.correct_message && <p className="field-error">{errors.correct_message}</p>}
          </div>

          {/* ── 不正解時メッセージ ── */}
          <div className="form-group">
            <label htmlFor="wrong_message">
              不正解時メッセージ <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              id="wrong_message"
              value={form.wrong_message}
              onChange={(e) => setField("wrong_message", e.target.value)}
              placeholder="例: 残念、違います。もう一度よく考えてみてください。"
              rows={3}
              maxLength={1000}
            />
            {errors.wrong_message && <p className="field-error">{errors.wrong_message}</p>}
          </div>

          <hr className="section-divider" />

          {/* ── 応答キャラクター ── */}
          <div className="form-group">
            <label htmlFor="character_id">応答キャラクター（任意）</label>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, marginTop: 2 }}>
              この謎のメッセージ送信者として使うキャラクターを設定します。
              未設定の場合はシステムキャラクターが使われます。
            </p>
            <select
              id="character_id"
              value={form.character_id ?? ""}
              onChange={(e) => setField("character_id", e.target.value || null)}
              style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, background: "#fff", width: "100%" }}
            >
              <option value="">なし（システムキャラクター）</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {form.character_id && (() => {
              const c = characters.find((ch) => ch.id === form.character_id);
              if (!c) return null;
              return (
                <div style={{
                  marginTop: 8, display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 10px", background: "#f0fdf4", borderRadius: 6,
                  border: "1px solid #bbf7d0", fontSize: 12,
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: c.icon_color ?? "#6366f1",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#fff",
                  }}>
                    {c.icon_text ?? c.name.charAt(0)}
                  </span>
                  <span style={{ fontWeight: 600, color: "#374151" }}>{c.name}</span>
                </div>
              );
            })()}
          </div>

          {/* ── 送信対象セグメント ── */}
          <div className="form-group">
            <label htmlFor="target_segment">送信対象セグメント（任意）</label>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, marginTop: 2 }}>
              特定のセグメントのユーザーだけを対象にします。
              未設定の場合は<strong>全ユーザー対象</strong>となります。
            </p>
            <select
              id="target_segment"
              value={form.target_segment ?? ""}
              onChange={(e) => setField("target_segment", e.target.value || null)}
              style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, background: "#fff", width: "100%" }}
            >
              <option value="">🌐 全ユーザー対象（未設定）</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {!form.target_segment && (
              <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                セグメント未設定 — すべてのユーザーが対象です
              </p>
            )}
          </div>

          {/* ── 作品スコープ（任意） ── */}
          {works.length > 0 && (
            <div className="form-group">
              <label htmlFor="work_id">作品スコープ（任意）</label>
              <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, marginTop: 2 }}>
                この謎を特定の作品に紐づけます。設定すると作品単位での管理・フィルタリングが可能になります。
                未設定の場合はアカウント全体で共有されます。
              </p>
              <select
                id="work_id"
                value={form.work_id ?? ""}
                onChange={(e) => setField("work_id", e.target.value || null)}
                style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, background: "#fff", width: "100%" }}
              >
                <option value="">🌐 共有（作品スコープなし）</option>
                {works.map((w) => (
                  <option key={w.id} value={w.id}>{w.title}</option>
                ))}
              </select>
            </div>
          )}

          <hr className="section-divider" />

          {/* ── 状態 ── */}
          <div className="form-group">
            <label>状態</label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["draft", "published"] as RiddleStatus[]).map((s) => (
                <label
                  key={s}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 16px",
                    border: `2px solid ${form.status === s ? (s === "published" ? "#059669" : "#d97706") : "#e5e5e5"}`,
                    borderRadius: 8, cursor: "pointer",
                    background: form.status === s ? (s === "published" ? "#f0fdf4" : "#fffbeb") : "#fff",
                  }}
                >
                  <input
                    type="radio" name="status" value={s}
                    checked={form.status === s}
                    onChange={() => setField("status", s)}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>
                      {s === "published" ? "公開" : "非公開"}
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {s === "published" ? "Bot が参照できる" : "Bot からは参照されない"}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <hr className="section-divider" />

          {/* ── ヒント設定 ── */}
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>💡 ヒント設定</span>
              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>（任意・最大20ステップ）</span>
            </label>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, marginTop: 2 }}>
              プレイヤーが「ヒント」と送信したとき、ステップ順にヒントが配信されます。
            </p>

            {form.hints.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
                {form.hints.map((hint, hIdx) => (
                  <div key={hIdx} style={{
                    border: "1px solid #e5e5e5", borderRadius: 10, background: "#fafafa",
                    overflow: "hidden",
                  }}>
                    {/* ヒントヘッダー */}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", background: "#f3f4f6", borderBottom: "1px solid #e5e5e5",
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>
                        ヒント {hint.step}
                      </span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button type="button"
                          onClick={() => moveHint(hIdx, -1)}
                          disabled={hIdx === 0}
                          title="上へ"
                          style={{
                            background: "none", border: "1px solid #d1d5db", borderRadius: 4,
                            cursor: hIdx === 0 ? "default" : "pointer",
                            color: hIdx === 0 ? "#d1d5db" : "#6b7280",
                            padding: "1px 6px", fontSize: 11, lineHeight: 1.4,
                          }}
                        >
                          ↑
                        </button>
                        <button type="button"
                          onClick={() => moveHint(hIdx, 1)}
                          disabled={hIdx === form.hints.length - 1}
                          title="下へ"
                          style={{
                            background: "none", border: "1px solid #d1d5db", borderRadius: 4,
                            cursor: hIdx === form.hints.length - 1 ? "default" : "pointer",
                            color: hIdx === form.hints.length - 1 ? "#d1d5db" : "#6b7280",
                            padding: "1px 6px", fontSize: 11, lineHeight: 1.4,
                          }}
                        >
                          ↓
                        </button>
                        <button type="button" className="btn btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                          onClick={() => removeHint(hIdx)}
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* ヒントテキスト */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 4, display: "block" }}>
                          ヒントテキスト <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <textarea
                          value={hint.text}
                          onChange={(e) => updateHint(hIdx, "text", e.target.value)}
                          placeholder="例: 部屋の中に隠された数字を探してみよう"
                          rows={3} maxLength={1000}
                          style={{ fontSize: 13 }}
                        />
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>{hint.text.length} / 1000</span>
                      </div>

                      {/* 送信キャラクター */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "#374151", marginBottom: 4, display: "block" }}>
                          送信キャラクター（任意）
                        </label>
                        <select
                          value={hint.character_id ?? ""}
                          onChange={(e) => updateHint(hIdx, "character_id", e.target.value || null)}
                          style={{ fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", width: "100%" }}
                        >
                          <option value="">なし（デフォルト）</option>
                          {characters.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* クイックリプライ */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <label style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>
                            クイックリプライ（最大10個）
                          </label>
                          {hint.quick_replies.length < 10 && (
                            <button type="button" className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "2px 10px" }}
                              onClick={() => addQuickReply(hIdx)}
                            >
                              ＋ 追加
                            </button>
                          )}
                        </div>

                        {hint.quick_replies.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
                            クイックリプライなし。追加するとプレイヤーがタップできるボタンが表示されます。
                          </p>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {hint.quick_replies.map((qr, qIdx) => (
                              <div key={qIdx} style={{
                                display: "grid", gap: 6,
                                gridTemplateColumns: "1fr 1fr auto",
                                alignItems: "start",
                                background: "#fff", border: "1px solid #e5e5e5",
                                borderRadius: 8, padding: "8px 10px",
                              }}>
                                <div>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>ラベル</div>
                                  <input type="text"
                                    value={qr.label}
                                    onChange={(e) => updateQuickReply(hIdx, qIdx, "label", e.target.value)}
                                    placeholder="次のヒント"
                                    maxLength={20}
                                    style={{ fontSize: 12, padding: "4px 8px" }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>アクション</div>
                                  <select
                                    value={qr.action_type}
                                    onChange={(e) => updateQuickReply(hIdx, qIdx, "action_type", e.target.value)}
                                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", width: "100%" }}
                                  >
                                    {HINT_ACTION_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                  {qr.action_type === "custom" && (
                                    <input type="text"
                                      value={qr.action_value}
                                      onChange={(e) => updateQuickReply(hIdx, qIdx, "action_value", e.target.value)}
                                      placeholder="送信するテキスト"
                                      maxLength={200}
                                      style={{ fontSize: 12, padding: "4px 8px", marginTop: 4 }}
                                    />
                                  )}
                                </div>
                                <button type="button"
                                  onClick={() => removeQuickReply(hIdx, qIdx)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, padding: "4px", marginTop: 18 }}
                                  title="削除"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {form.hints.length < 20 && (
              <button type="button" className="btn btn-ghost"
                style={{ fontSize: 13, padding: "6px 14px" }}
                onClick={addHint}
              >
                💡 ヒントを追加
              </button>
            )}
          </div>

          {/* ── ボタン ── */}
          <div className="form-actions">
            <div style={{ display: "flex", gap: 8 }}>
              <Link href={`/oas/${oaId}/riddles`} className="btn btn-ghost">キャンセル</Link>
              {!isNew && onDelete && canDelete && (
                <button
                  type="button" className="btn btn-danger"
                  onClick={handleDelete} disabled={deleting || submitting}
                >
                  {deleting && <span className="spinner" />}
                  {deleting ? "削除中..." : "削除"}
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-primary" disabled={!canEdit || submitting || uploading}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : isNew ? "謎を登録" : "保存する"}
            </button>
          </div>

        </form>
      </div>
      )}

      {/* ─── 右：プレビュー ─── */}
      {(wideLayout || activeTab === "preview") && (
        <div style={{ flex: "0 0 320px", position: wideLayout ? "sticky" : "static", top: 24 }}>
          <RiddlePreview form={form} characters={characters} />
        </div>
      )}

      </div>{/* end 2カラム */}
    </>
  );
}
