"use client";

// src/components/FeedbackModal.tsx
// フィードバック送信モーダル。
// ・通常モード : バグ報告・UX フィードバックなど
// ・pricing モード(pathname === "/pricing" || pricingSource != null) :
//     editorプラン相談用文言・テンプレート・送信完了メッセージに切り替え
// ・現在の画面URL・ページ名・OA/作品IDを自動付与
// ・送信先: POST /api/feedback → service 層 → GAS (sheet: feedback)

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { useIsMobile } from "@/hooks/useIsMobile";

// ── ページ名マッピング ─────────────────────────────────────────────────────
function getPageName(pathname: string): string {
  const patterns: [RegExp, string][] = [
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages\/new$/,            "メッセージ作成"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages\/[^/]+$/,          "メッセージ編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages$/,                 "メッセージ一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/phases\/[^/]+$/,            "フェーズ編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/phases$/,                   "フェーズ管理"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters\/[^/]+\/edit$/,  "キャラクター編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters\/new$/,          "キャラクター作成"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters$/,               "キャラクター一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/scenario$/,                 "シナリオ管理"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/audience$/,                 "オーディエンス"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/dashboard\/flow-analysis$/, "フロー分析"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/dashboard$/,                "ダッシュボード"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/riddles$/,                  "謎一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/edit$/,                     "作品編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+$/,                           "作品トップ"],
    [/^\/oas\/[^/]+\/works\/new$/,                             "作品作成"],
    [/^\/oas\/[^/]+\/works$/,                                  "作品リスト"],
    [/^\/oas\/[^/]+\/characters\/[^/]+\/edit$/,                "キャラクター編集"],
    [/^\/oas\/[^/]+\/characters\/new$/,                        "キャラクター作成"],
    [/^\/oas\/[^/]+\/characters$/,                             "キャラクター管理"],
    [/^\/oas\/[^/]+\/riddles\/[^/]+$/,                         "謎編集"],
    [/^\/oas\/[^/]+\/riddles\/new$/,                           "謎作成"],
    [/^\/oas\/[^/]+\/riddles$/,                                "謎一覧"],
    [/^\/oas\/[^/]+\/richmenu-editor\/[^/]+$/,                 "リッチメニュー編集"],
    [/^\/oas\/[^/]+\/richmenu-editor$/,                        "リッチメニュー管理"],
    [/^\/oas\/[^/]+\/richmenu-sync$/,                          "リッチメニュー同期"],
    [/^\/oas\/[^/]+\/friend-add$/,                             "友だち追加設定"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/x-posts$/,                  "X投稿管理"],
    [/^\/oas\/[^/]+\/trackings$/,                              "トラッキング管理"],
    [/^\/oas\/[^/]+\/settings\/members$/,                      "メンバー管理"],
    [/^\/oas\/[^/]+\/settings$/,                               "設定"],
    [/^\/oas\/[^/]+\/account$/,                                "アカウント情報"],
    [/^\/oas\/[^/]+\/audience\/segments\/new$/,                "セグメント作成"],
    [/^\/oas\/[^/]+\/audience\/segments\/[^/]+$/,              "セグメント編集"],
    [/^\/oas\/[^/]+\/audience\/tracking\/new$/,                "トラッキング作成"],
    [/^\/oas\/[^/]+\/audience\/tracking\/[^/]+$/,              "トラッキング編集"],
    [/^\/oas\/[^/]+\/audience$/,                               "オーディエンス"],
    [/^\/oas\/[^/]+\/edit$/,                                   "OA編集"],
    [/^\/oas\/new$/,                                           "アカウント作成"],
    [/^\/oas$/,                                                "アカウント一覧"],
    [/^\/$/,                                                   "ホーム"],
  ];
  for (const [pattern, name] of patterns) {
    if (pattern.test(pathname)) return name;
  }
  return pathname;
}

// 通常フィードバックの「タイトル」最大文字数 / 「内容」最大文字数。
// 法人相談（pricing mode）は別仕様（content は長文可）なので分けて扱う。
const TITLE_MAX_LEN   = 50;
const CONTENT_MAX_LEN = 100;

// ── モーダル共通ラッパー (= 必ず top-level で宣言する) ──────────────────
// **注意**: 以前 FeedbackModal の内部関数として定義していたが、レンダリングごとに
// 新しい関数参照が作られ、React が「異なる component type」と判定して毎キーストロークで
// modal 全体を unmount → remount してしまうバグがあった (= textarea のフォーカスが
// 1 文字ごとに失われる症状)。top-level で定義することで関数参照が安定し、内部 state
// (= textarea のカーソル / フォーカス) が保持される。
function ModalShell({
  isMobile,
  onBackdropClick,
  children,
}: {
  isMobile: boolean;
  onBackdropClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        // SP: 画面下部に張り付くボトムシート風
        alignItems:     isMobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          // SP: 上角のみ丸め、画面幅いっぱいに広がるシート
          borderRadius: isMobile ? "16px 16px 0 0" : 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth: isMobile ? "100%" : 480,
          // SP: スクロール可能領域に制限
          maxHeight: isMobile ? "92dvh" : "90vh",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── pricing モード用テンプレート ───────────────────────────────────────────
const PRICING_TEMPLATE = `Whale Studio のプランについて相談したいです。

【利用用途】
（例：マーダーミステリー / ARG / 物語体験 / その他）

【現在の状況】
（例：1作品試作中 / 導入を検討中 / クライアント案件で利用予定）

【相談したいこと】
（例：料金、利用開始時期、できること、導入の流れ など）`;

// ── Props ───────────────────────────────────────────────────────────────────
interface Props {
  pathname:      string;
  onClose:       () => void;
  /** pricing ページ起点で開いた場合の流入元（"header" / "banner" / "gate" / "preview" など） */
  pricingSource?: string;
  /** 法人プランカードから開いた場合の希望プラン表示名（"Basic" / "委託プラン" など）。
   *  「希望プラン」select の初期選択に使う。 */
  hopedPlan?: string;
}

/** 法人プランの希望プラン選択肢（= 表示名ベース、PLAN_LABELS と一致）。 */
const HOPED_PLAN_OPTIONS = ["Basic", "Standard", "Pro", "Pro Max", "委託プラン", "未定 / 相談したい"] as const;

// ── コンポーネント ──────────────────────────────────────────────────────────
export default function FeedbackModal({ pathname, onClose, pricingSource, hopedPlan }: Props) {
  const { showToast } = useToast();
  const sp = useIsMobile();

  // pricing 起点かどうかで UI モードを切り替える
  const isPricingMode = pathname === "/pricing" || pricingSource != null;

  const [content,    setContent]    = useState(isPricingMode ? PRICING_TEMPLATE : "");
  // 通常フィードバックのタイトル（必須・最大 50 字）。旧「カテゴリ」を置き換える。
  const [title,      setTitle]      = useState("");
  // 希望プラン: 法人カード起点なら押されたプランを初期選択、それ以外は「未定」。
  const [selectedHopedPlan, setSelectedHopedPlan] = useState<string>(
    hopedPlan && (HOPED_PLAN_OPTIONS as readonly string[]).includes(hopedPlan)
      ? hopedPlan
      : "未定 / 相談したい"
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);  // 送信完了画面の表示フラグ（全モード共通）
  const [copied,     setCopied]     = useState(false);  // メールコピー完了フィードバック
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const CONTACT_EMAIL = "whale.studio.app@gmail.com";

  function handleCopyEmail() {
    navigator.clipboard.writeText(CONTACT_EMAIL)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard API 非対応ブラウザ向けフォールバック
        try {
          const el = document.createElement("textarea");
          el.value = CONTACT_EMAIL;
          el.style.position = "fixed";
          el.style.opacity  = "0";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // 無言で失敗
        }
      });
  }

  // 開いたらテキストエリアにフォーカス
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // ESC で閉じる: listener はマウント時に 1 回だけ追加する (= dep [] で再 bind を抑制)。
  // 旧実装は [content] を dep に持っていたため、textarea を 1 文字打つたびに
  // listener が remove → add されていた。本バグの主因ではないが、無駄なので解消する。
  // handleClose 内で最新 state を ref 経由ではなくクロージャ経由で読むため、
  // handleClose を ref に格納してハンドラから呼ぶ形に変更。
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleClose() {
    // 送信完了後はダイアログなしで閉じる
    if (submitted) { onClose(); return; }

    // pricing モード: テンプレートから変更があった場合のみ確認
    // 通常モード  : content か title のいずれかに入力があれば確認
    const shouldWarn = isPricingMode
      ? content !== PRICING_TEMPLATE && content.trim().length > 0
      : content.trim().length > 0 || title.trim().length > 0;

    if (shouldWarn) {
      if (!confirm("入力内容が送信されていません。閉じてよいですか？")) return;
    }
    onClose();
  }

  async function handleSubmit() {
    if (!content.trim()) {
      textareaRef.current?.focus();
      return;
    }
    // 通常フィードバックはタイトル必須。
    if (!isPricingMode && !title.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      const pageUrl   = typeof window !== "undefined" ? window.location.href : pathname;
      const oaMatch   = pathname.match(/\/oas\/([^/]+)/);
      const workMatch = pathname.match(/\/works\/([^/]+)/);

      const body = {
        content:    content.trim(),
        // 通常フィードバックはタイトル必須（旧カテゴリの置き換え）。pricing は使わない。
        title:      isPricingMode ? "" : title.trim(),
        // pricing mode (= 「法人プランに申し込む」CTA 経由) は専用カテゴリ "enterprise"
        // に振り分け、API 側で専用 Slack チャネルに通知する。通常フィードバックはカテゴリ廃止 → "".
        category:   isPricingMode ? "enterprise" : "",
        page_name:  getPageName(pathname),
        page_url:   pageUrl,
        // 送信者表示は API 側で Supabase Auth user → Profile.username から解決する。
        // ここで送る値はサーバーで無視されるため空文字のままで良い（client 値は信用しない）。
        user_name:  "",
        user_email: "",
        oa_id:      oaMatch?.[1]  ?? null,
        oa_name:    null,
        work_id:    workMatch?.[1] ?? null,
        work_name:  null,
        // 法人プラン相談時のみ希望プランを添付（それ以外は null）。
        hoped_plan: isPricingMode ? selectedHopedPlan : null,
      };

      // ── API 呼び出し ──
      let res: Response;
      try {
        res = await fetch("/api/feedback", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      } catch (networkErr) {
        console.error("[FeedbackModal] ネットワークエラー:", networkErr);
        showToast("送信できませんでした（ネットワークエラー）。接続を確認してください。", "error");
        return;
      }

      // ── レスポンス解析 ──
      let json: { ok: boolean; error?: string; dev_skip?: boolean };
      try {
        json = await res.json() as { ok: boolean; error?: string; dev_skip?: boolean };
      } catch {
        console.error("[FeedbackModal] レスポンス JSON パース失敗 status=" + res.status);
        showToast(`送信エラー（HTTP ${res.status}）。しばらく後にもう一度お試しください。`, "error");
        return;
      }

      if (!json.ok) {
        const errMsg = json.error ?? "送信に失敗しました";
        console.error("[FeedbackModal] API エラー:", errMsg);
        // API 側で既にユーザー向けに整形された文言を返す設計 (= env 名や URL を出さない)。
        showToast(errMsg, "error");
        return;
      }

      // ── 成功 ──
      if (json.dev_skip) {
        // 開発モード: トーストだけ出して閉じる（スプレッドシートに送信されていない旨を示す）
        showToast("（開発モード）送信内容はサーバーコンソールに出力されました", "success");
        onClose();
        return;
      }

      // pricing 起点は課金イベントを記録
      if (isPricingMode) {
        trackBillingEvent("pricing_feedback_submit", undefined, pricingSource);
      }

      // 全モード共通: モーダル内の送信完了画面に切り替え（閉じない）
      setSubmitted(true);

    } catch (err) {
      console.error("[FeedbackModal] 予期しない例外:", err);
      showToast("送信中にエラーが発生しました。もう一度お試しください。", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const pageName  = getPageName(pathname);
  // 通常フィードバックは「タイトル」も必須。法人相談（pricing）は従来どおり content のみ。
  const canSubmit =
    !submitting &&
    content.trim().length > 0 &&
    (isPricingMode || title.trim().length > 0);

  // ── 送信完了画面（全モード共通） ─────────────────────────────────────────
  if (submitted) {
    return (
      <ModalShell isMobile={sp} onBackdropClick={handleClose}>
        <div style={{ padding: sp ? "28px 18px 32px" : "36px 28px 28px", textAlign: "center" }}>

          {/* アイコン */}
          <div style={{
            width: 52, height: 52,
            borderRadius: "50%",
            background: "var(--color-primary-soft, #EAF4F1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
            margin: "0 auto 20px",
          }}>
          </div>

          {/* 見出し */}
          <h2 style={{
            fontSize: 16, fontWeight: 800,
            color: "var(--text-primary, #111827)",
            marginBottom: 12,
            letterSpacing: "-0.01em",
          }}>
            ご相談ありがとうございます！
          </h2>

          {/* 本文 */}
          <p style={{
            fontSize: 13, color: "#374151", lineHeight: 1.9,
            marginBottom: 24,
          }}>
            内容を確認し、順次ご連絡させていただきます。<br />
            <span style={{ fontSize: 12, color: "var(--text-muted, #9ca3af)" }}>
              （通常1日以内）
            </span>
          </p>

          {/* 急ぎの場合 */}
          <div style={{
            padding:      "16px 20px",
            background:   "var(--bg, #f9fafb)",
            border:       "1px solid var(--border-light, #e5e7eb)",
            borderRadius: 10,
            marginBottom: 20,
          }}>
            <p style={{
              fontSize: 12, color: "var(--text-secondary, #6b7280)",
              lineHeight: 1.7, marginBottom: 12,
            }}>
              もしお急ぎの場合は、<br />
              以下のメールアドレスまでご連絡ください 🙌
            </p>

            {/* メールアドレス表示 */}
            <div style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            sp ? 8 : 10,
              flexDirection:  sp ? "column" : "row",
              flexWrap:       "wrap",
            }}>
              <span style={{
                fontSize:    sp ? 13 : 14,
                fontWeight:  700,
                color:       "var(--text-primary, #111827)",
                letterSpacing: "0.01em",
                userSelect:  "all",
                wordBreak:   "break-all",
              }}>
                {CONTACT_EMAIL}
              </span>

              {/* コピーボタン — SP ではフル幅 */}
              <button
                type="button"
                onClick={handleCopyEmail}
                style={{
                  display:      "inline-flex",
                  alignItems:   "center",
                  justifyContent: "center",
                  gap:          4,
                  padding:      sp ? "9px 12px" : "5px 12px",
                  fontSize:     12,
                  fontWeight:   600,
                  borderRadius: 6,
                  border:       `1px solid ${copied ? "#b9ddd6" : "var(--border-light, #e5e7eb)"}`,
                  background:   copied ? "var(--color-primary-soft, #EAF4F1)" : "#fff",
                  color:        copied ? "var(--color-primary, #2F6F5E)" : "var(--text-secondary, #6b7280)",
                  cursor:       "pointer",
                  transition:   "all 0.15s",
                  whiteSpace:   "nowrap",
                  width:        sp ? "100%" : "auto",
                }}
              >
                {copied ? "コピーしました" : "メールをコピー"}
              </button>
            </div>
          </div>

          {/* 閉じるボタン */}
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary"
            style={{
              width: "100%", justifyContent: "center",
              fontSize: 13, padding: "11px 0",
            }}
          >
            閉じる
          </button>
        </div>
      </ModalShell>
    );
  }

  // ── 通常フォーム（pricing モード / 通常モード 共用） ─────────────────────
  return (
    <ModalShell isMobile={sp} onBackdropClick={handleClose}>
      {/* ── ヘッダー ── */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "16px 20px 14px",
        borderBottom: "1px solid #e5e7eb",
      }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
            {isPricingMode ? "プランのアップグレードについて" : "フィードバックを送る"}
          </h2>
          <p style={{ fontSize: 11, color: "#9ca3af", margin: "2px 0 0" }}>
            {isPricingMode ? "個別にご確認のうえ、ご案内します" : `現在のページ: ${pageName}`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          style={{
            marginLeft: "auto", background: "none", border: "none",
            cursor: "pointer", color: "#9ca3af", fontSize: 20,
            lineHeight: 1, padding: "2px 6px", borderRadius: 6,
          }}
          aria-label="閉じる"
        >
          ×
        </button>
      </div>

      {/* ── フォーム ── */}
      <div style={{ padding: sp ? "16px 16px 20px" : "18px 20px 20px" }}>

        {/* pricing モード: 案内文 */}
        {isPricingMode && (
          <div style={{
            marginBottom: 16,
            padding: "12px 14px",
            background: "var(--color-primary-soft, #EAF4F1)",
            border: "1px solid #b9ddd6",
            borderRadius: 8,
            fontSize: 13,
            color: "#2d5a4e",
            lineHeight: 1.8,
          }}>
            法人プランにご興味をお持ちいただきありがとうございます。<br />
            ご利用予定や検討状況を確認のうえ、個別にご案内します。<br />
            まだ検討中の段階でも、お気軽にご相談ください。
          </div>
        )}

        {/* pricing モード: 希望プラン選択（法人カードから開いた場合は初期選択済み） */}
        {isPricingMode && (
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="feedback-hoped-plan"
              style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "#374151", marginBottom: 6,
              }}
            >
              希望プラン
            </label>
            <select
              id="feedback-hoped-plan"
              value={selectedHopedPlan}
              onChange={(e) => setSelectedHopedPlan(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 12px",
                fontSize: 13,
                lineHeight: 1.6,
                border: "1.5px solid #e5e7eb",
                borderRadius: 8,
                background: "#fff",
                color: "#374151",
                cursor: "pointer",
              }}
            >
              {HOPED_PLAN_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        {/* 通常モード: タイトル（必須・最大50字 / 旧カテゴリの置き換え） */}
        {!isPricingMode && (
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="feedback-title"
              style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "#374151", marginBottom: 6,
              }}
            >
              タイトル
              <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
            </label>
            <input
              id="feedback-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：作品名がSlack通知に表示されない"
              maxLength={TITLE_MAX_LEN}
              style={{
                width: "100%",
                padding: "9px 12px",
                fontSize: 13,
                border: "1.5px solid #e5e7eb",
                borderRadius: 8,
                outline: "none",
                fontFamily: "inherit",
                color: "#111827",
                background: "#fafafa",
                transition: "border-color 0.15s, background 0.15s",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#06C755";
                e.target.style.background  = "#fff";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#e5e7eb";
                e.target.style.background  = "#fafafa";
              }}
            />
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>
              {title.length} / {TITLE_MAX_LEN}
            </p>
          </div>
        )}

        {/* 内容テキストエリア */}
        <div style={{ marginBottom: 14 }}>
          <label
            htmlFor="feedback-content"
            style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "#374151", marginBottom: 6,
            }}
          >
            {isPricingMode
              ? "ご相談内容"
              : "フィードバック内容"}
            <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
          </label>
          <textarea
            id="feedback-content"
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={isPricingMode ? "" : "改善してほしい点、使いにくかった箇所、欲しい機能などを入力してください"}
            maxLength={isPricingMode ? 2000 : CONTENT_MAX_LEN}
            rows={isPricingMode ? (sp ? 7 : 10) : 5}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              lineHeight: 1.6,
              border: "1.5px solid #e5e7eb",
              borderRadius: 8,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
              color: "#111827",
              background: "#fafafa",
              transition: "border-color 0.15s, background 0.15s",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "#06C755";
              e.target.style.background  = "#fff";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#e5e7eb";
              e.target.style.background  = "#fafafa";
            }}
          />
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>
            {content.length} / {isPricingMode ? 2000 : CONTENT_MAX_LEN}
          </p>
        </div>

        {/* 自動付与情報の説明 */}
        <p style={{
          fontSize: 11, color: "#9ca3af", lineHeight: 1.6,
          marginBottom: 16,
          padding: "8px 12px",
          background: "#f9fafb",
          borderRadius: 6,
        }}>
          送信時に現在のURL・ページ名・OA情報・ブラウザ情報が自動的に添付されます。
        </p>

        {/* ボタン行 */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: "8px 18px", fontSize: 13, fontWeight: 500,
              background: "#f3f4f6", color: "#374151",
              border: "none", borderRadius: 8, cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "8px 20px", fontSize: 13, fontWeight: 600,
              background: canSubmit ? "#06C755" : "#d1d5db",
              color: "#fff",
              border: "none", borderRadius: 8,
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", gap: 6,
              transition: "background 0.15s",
            }}
          >
            {submitting && (
              <span style={{
                width: 13, height: 13,
                border: "2px solid rgba(255,255,255,0.4)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
              }} />
            )}
            {submitting
              ? "送信中..."
              : isPricingMode
                ? "相談を送る"
                : "送信する"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
