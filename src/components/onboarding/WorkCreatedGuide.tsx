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
    label: "メッセージ・謎を追加する",
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
    label: "プレビューで見え方を確認する",
    desc: "実際の体験に近い形で確認できます",
    href: null as string | null,
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

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
      className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 relative"
      style={{ padding: "20px 22px", marginBottom: 20 }}
    >
      {/* 閉じるボタン */}
      <button
        onClick={onDismiss}
        aria-label="閉じる"
        className="absolute text-neutral-300 hover:text-neutral-500 transition-colors"
        style={{ top: 14, right: 14, background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
      >
        ✕
      </button>

      <p className="font-bold text-emerald-800" style={{ fontSize: 15, marginBottom: 4 }}>
        作品を作成しました
      </p>
      <p className="text-emerald-700" style={{ fontSize: 12, marginBottom: 18 }}>
        次は、作品の体験を形にするための設定を進めましょう。
      </p>

      {/* ステップ一覧 */}
      <div className="flex flex-col" style={{ gap: 8, marginBottom: 18 }}>
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
              style={{ gap: 10, padding: isNext ? "10px 12px" : "4px 12px" }}
            >
              {/* 番号バッジ */}
              <span
                className={[
                  "flex-shrink-0 rounded-full font-bold flex items-center justify-center",
                  done   ? "bg-emerald-100 text-emerald-500"  :
                  isNext ? "bg-emerald-500 text-white"        :
                           "bg-neutral-100 text-neutral-400",
                ].join(" ")}
                style={{ width: 22, height: 22, fontSize: 10 }}
              >
                {done ? "✓" : i + 1}
              </span>

              {/* ラベル + 説明 */}
              <div className="flex-1 min-w-0">
                <span
                  className={done ? "line-through text-neutral-400" : isNext ? "font-semibold text-neutral-800" : "text-neutral-500"}
                  style={{ fontSize: 13 }}
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
                  style={{ fontSize: 11, padding: "3px 10px" }}
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
            style={{ gap: 6, padding: "9px 18px", fontSize: 13 }}
          >
            {firstIncomplete.label} →
          </Link>
        )}
        <button
          onClick={onDismiss}
          className="rounded-xl border border-neutral-200 text-neutral-500 hover:bg-neutral-50 transition-colors"
          style={{ padding: "9px 18px", fontSize: 13, background: "none", cursor: "pointer" }}
        >
          あとで設定する
        </button>
      </div>
    </div>
  );
}
