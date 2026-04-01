"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { oaApi, getDevToken } from "@/lib/api-client";
import { MaskedField } from "@/components/MaskedField";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PublishStatus } from "@/types";

const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

export default function OaNewPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [title, setTitle]                         = useState("");
  const [description, setDescription]             = useState("");
  const [channelId, setChannelId]                 = useState("");
  const [channelSecret, setChannelSecret]         = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [publishStatus, setPublishStatus]         = useState<PublishStatus>("draft");

  const [errors, setErrors]       = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function clearError(key: string) {
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    // クライアントバリデーション
    const clientErrors: Record<string, string[]> = {};
    if (!title.trim())               clientErrors.title = ["作品名を入力してください"];
    if (title.length > 100)          clientErrors.title = ["作品名は100文字以内で入力してください"];
    if (!channelId.trim())           clientErrors.channel_id = ["Channel IDを入力してください"];
    if (!channelSecret.trim())       clientErrors.channel_secret = ["Channel Secretを入力してください"];
    if (!channelAccessToken.trim())  clientErrors.channel_access_token = ["Channel Access Tokenを入力してください"];
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setSubmitting(false);
      return;
    }

    try {
      await oaApi.create(getDevToken(), {
        title:                title.trim(),
        description:          description.trim() || undefined,
        channel_id:           channelId.trim(),
        channel_secret:       channelSecret.trim(),
        channel_access_token: channelAccessToken.trim(),
        publish_status:       publishStatus,
      });
      showToast("OAを作成しました", "success");
      router.push("/oas");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "作成に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "新規作成" },
          ]} />
          <h2>OA 新規作成</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          {/* ── 基本情報 ── */}
          <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151" }}>基本情報</p>

          <div className="form-group">
            <label htmlFor="title">作品名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); clearError("title"); }}
              placeholder="例: 謎解きミステリー Vol.1"
              maxLength={100}
              required
            />
            {errors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="description">説明（任意）</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="作品の概要を入力してください（500文字以内）"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label>公開ステータス</label>
            <div className="radio-group">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="publish_status"
                    value={value}
                    checked={publishStatus === value}
                    onChange={() => setPublishStatus(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <hr className="section-divider" />

          {/* ── LINE 設定 ── */}
          <p style={{ fontWeight: 600, marginBottom: 4, color: "#374151" }}>LINE 接続設定</p>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            LINE Developers コンソール →「Messaging API」タブから確認できます。
          </div>

          <div className="form-group">
            <label htmlFor="channel_id">Channel ID <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="channel_id"
              type="text"
              value={channelId}
              onChange={(e) => { setChannelId(e.target.value); clearError("channel_id"); }}
              placeholder="例: 1234567890"
              required
            />
            {errors.channel_id?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <MaskedField
            id="channel_secret"
            label="Channel Secret"
            value={channelSecret}
            onChange={(v) => { setChannelSecret(v); clearError("channel_secret"); }}
            placeholder="32桁の英数字"
            required
            errorMessages={errors.channel_secret}
          />

          <MaskedField
            id="channel_access_token"
            label="Channel Access Token"
            value={channelAccessToken}
            onChange={(v) => { setChannelAccessToken(v); clearError("channel_access_token"); }}
            placeholder="長期トークンを貼り付けてください"
            required
            errorMessages={errors.channel_access_token}
          />

          <div className="form-actions">
            <Link href="/oas" className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "作成中..." : "作成する"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
