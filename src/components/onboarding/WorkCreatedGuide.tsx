"use client";

import Link from "next/link";

interface Props {
  oaId:           string;
  workId:         string;
  hasCharacters:  boolean;
  hasPhases:      boolean;
  hasMessages:    boolean;
  hasTransitions: boolean;
  onDismiss:      () => void;
}

const STEPS = [
  {
    key:   "character",
    label: "キャラクターを作成する",
    desc:  "キャラクター名やアイコンを設定します",
    href:  "characters",
  },
  {
    key:   "phase",
    label: "フェーズを作成する",
    desc:  "開始・通常・エンディングの流れを作ります",
    href:  "scenario",
  },
  {
    key:   "message",
    label: "メッセージを追加する",
    desc:  "会話や問題を作成して、フェーズに紐づけます",
    href:  "messages",
  },
  {
    key:   "scenario",
    label: "シナリオフローを設定する",
    desc:  "各フェーズや分岐のつながりを整理します",
    href:  "scenario",
  },
  {
    key:  "preview",
    label: "実際にスマートフォンで確認する",
    desc: "実際の体験に近い形で確認できます",
    href: null as string | null,
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

// 補助的なセットアップ案内として控えめに見せるため、全体をひとまわりコンパクトにしている
// （余白・文字/見出し/アイコン/ボタンサイズを抑制。情報は読める範囲を維持）。
export function WorkCreatedGuide({
  oaId, workId,
  hasCharacters, hasPhases, hasMessages, hasTransitions,
  onDismiss,
}: Props) {
  const completion: Record<StepKey, boolean> = {
    character: hasCharacters,
    phase:     hasPhases,
    message:   hasMessages,
    scenario:  hasTransitions,
    preview:   false,
  };

  const firstIncomplete = STEPS.find((s) => !completion[s.key]);
  const basePath = `/oas/${oaId}/works/${workId}`;

  return (
    <div
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 relative"
      style={{ padding: "15px 17px", marginBottom: 16 }}
    >
      {/* 閉じるボタン */}
      <button
        onClick={onDismiss}
        aria-label="閉じる"
        className="absolute text-neutral-300 hover:text-neutral-500 transition-colors"
        style={{ top: 12, right: 12, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
      >
        ✕
      </button>

      <p className="font-bold text-emerald-800" style={{ fontSize: 13, marginBottom: 3 }}>
        作品を作成しました
      </p>
      <p className="text-emerald-700" style={{ fontSize: 11, marginBottom: 14 }}>
        次は、作品の体験を形にするための設定を進めましょう。
      </p>

      {/* ステップ一覧 */}
      <div className="flex flex-col" style={{ gap: 6, marginBottom: 14 }}>
        {STEPS.map((step, i) => {
          const done   = completion[step.key];
          const isNext = step.key === firstIncomplete?.key;
          const href   = step.href ? `${basePath}/${step.href}` : null;

          return (
            <div
              key={step.key}
              className={[
                "flex items-center rounded-xl transition-colors",
                isNext ? "bg-white border border-emerald-200 shadow-sm" : "",
              ].join(" ")}
              style={{ gap: 9, padding: isNext ? "8px 10px" : "3px 10px" }}
            >
              {/* 番号バッジ */}
              <span
                className={[
                  "flex-shrink-0 rounded-full font-bold flex items-center justify-center",
                  done   ? "bg-emerald-100 text-emerald-500"  :
                  isNext ? "bg-emerald-500 text-white"        :
                           "bg-neutral-100 text-neutral-400",
                ].join(" ")}
                style={{ width: 19, height: 19, fontSize: 10 }}
              >
                {done ? "✓" : i + 1}
              </span>

              {/* ラベル + 説明 */}
              <div className="flex-1 min-w-0">
                <span
                  className={done ? "line-through text-neutral-400" : isNext ? "font-semibold text-neutral-800" : "text-neutral-500"}
                  style={{ fontSize: 12 }}
                >
                  {step.label}
                </span>
                {isNext && (
                  <span className="text-neutral-400" style={{ fontSize: 11, marginLeft: 6 }}>
                    — {step.desc}
                  </span>
                )}
              </div>

              {/* 次へリンク */}
              {isNext && href && (
                <Link
                  href={href}
                  className="flex-shrink-0 font-semibold text-emerald-600 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors"
                  style={{ fontSize: 11, padding: "3px 9px" }}
                >
                  →
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* CTA ボタン */}
      <div className="flex" style={{ gap: 8 }}>
        {firstIncomplete && firstIncomplete.href && (
          <Link
            href={`${basePath}/${firstIncomplete.href}`}
            className="inline-flex items-center rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors"
            style={{ gap: 6, padding: "8px 15px", fontSize: 12, color: "#ffffff" }}
          >
            {firstIncomplete.label} →
          </Link>
        )}
        <button
          onClick={onDismiss}
          className="rounded-xl border border-neutral-200 text-neutral-500 hover:bg-neutral-50 transition-colors"
          style={{ padding: "8px 15px", fontSize: 12, background: "none", cursor: "pointer" }}
        >
          あとで設定する
        </button>
      </div>
    </div>
  );
}
