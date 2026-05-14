"use client";

// src/components/liff/primitives/LiffField.tsx
//
// LIFF プレイヤー用の入力フィールド primitive。
// LINE Design System の Input / Textarea / Radio / Checkbox に揃える。
//
// 提供コンポーネント:
//   - <LiffFieldLabel>      ... ラベル + 必須マーク
//   - <LiffFieldHelper>     ... ヘルパー / エラーテキスト
//   - <LiffFieldWrapper>    ... ラベル + control + helper を 1 つのカード状にまとめる共通箱
//   - <LiffInput>           ... 1 行テキスト
//   - <LiffTextarea>        ... 複数行テキスト
//   - <LiffRadioGroup>      ... 単一選択
//   - <LiffCheckboxGroup>   ... 複数選択
//
// 状態 (Input / Textarea):
//   - default       : 通常
//   - focused       : :focus 時にリング + 緑ボーダー
//   - error         : red ボーダー + helper 赤字
//   - disabled      : 不透明度低下 + bg グレー
//
// アクセシビリティ:
//   - LiffInput / Textarea は <label> でラベルを内包し、必須マークに aria-label
//   - RadioGroup / CheckboxGroup は role + aria-labelledby で legend を擬似的に
//     (ブラウザ既定の fieldset / legend は border-radius カードと噛み合わないため div で実装)

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

// ── 共通スタイル ──────────────────────────────────────────────────────────
// 入力欄は LINE Design System の Input に倣い、左右 12px / 上下 8px、角丸 8px。
// 高さは 40px (h-10) を基本に textarea は min-h を指定する。
const INPUT_BASE_CLS =
  "w-full px-3 py-2 rounded-[8px] text-[15px] leading-[1.6] " +
  "bg-[color:var(--liff-surface,#fff)] text-[color:var(--liff-primary-text,#111)] " +
  "placeholder:text-[color:var(--liff-tertiary-text,#999)] " +
  "border border-[color:var(--liff-border,#E5E5E5)] " +
  "focus:outline-none focus:ring-2 focus:ring-[color:var(--liff-line-green,#06C755)] focus:border-[color:var(--liff-line-green,#06C755)] " +
  "disabled:bg-[color:var(--liff-background,#F7F8FA)] disabled:opacity-70 disabled:cursor-not-allowed";

const INPUT_ERROR_CLS =
  "border-[color:var(--liff-danger,#E22B2B)] focus:ring-[color:var(--liff-danger,#E22B2B)] focus:border-[color:var(--liff-danger,#E22B2B)]";

// LIFF プレイヤーの設問カード共通箱。Question wrapper として使う。
// border-radius カードを使うが、子要素は通常フローで描画されるので
// fieldset/legend の位置決め問題は起きない。
const FIELD_WRAPPER_CLS =
  "bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border,#E5E5E5)] rounded-[12px] px-4 py-3 flex flex-col gap-2";

// ── ラベル / ヘルパー ──────────────────────────────────────────────────────

export interface LiffFieldLabelProps {
  /** aria-labelledby などから参照される id */
  id?: string;
  /** ラベル文字列 */
  children: ReactNode;
  /** 必須項目に赤い * を付ける (aria-label="必須") */
  required?: boolean;
}

export function LiffFieldLabel({ id, children, required }: LiffFieldLabelProps) {
  return (
    <span
      id={id}
      className="text-[14px] font-bold leading-[1.5] text-[color:var(--liff-primary-text,#111)] break-words"
    >
      {children}
      {required && (
        <span
          aria-label="必須"
          className="ml-1 text-[color:var(--liff-danger,#E22B2B)] font-bold"
        >
          *
        </span>
      )}
    </span>
  );
}

export interface LiffFieldHelperProps {
  /** エラー文言があるか。あれば赤字で表示 */
  error?: string | null;
  /** 通常のヘルパー文言 (例: "100 文字以内"). error があるときは無視される */
  helper?: ReactNode;
  /** 文字数カウンタ用 (現在 / 上限) */
  counter?: { current: number; max: number };
}

export function LiffFieldHelper({ error, helper, counter }: LiffFieldHelperProps) {
  if (!error && !helper && !counter) return null;
  const text = error ?? helper ?? null;
  const overLimit = counter ? counter.current > counter.max : false;
  return (
    <div className="flex items-start justify-between gap-2 text-[12px] leading-[1.5]">
      {text && (
        <span
          className={
            error
              ? "text-[color:var(--liff-danger,#E22B2B)]"
              : "text-[color:var(--liff-tertiary-text,#999)]"
          }
          role={error ? "alert" : undefined}
        >
          {text}
        </span>
      )}
      {counter && (
        <span
          aria-label={`${counter.current} / ${counter.max} 文字`}
          className={`ml-auto tabular-nums ${overLimit ? "text-[color:var(--liff-danger,#E22B2B)]" : "text-[color:var(--liff-tertiary-text,#999)]"}`}
        >
          {counter.current} / {counter.max}
        </span>
      )}
    </div>
  );
}

// ── ラッパー: 1 設問 = カード ───────────────────────────────────────────────

export interface LiffFieldWrapperProps {
  /** ラベル文字列 (string) もしくは ReactNode */
  label?: ReactNode;
  required?: boolean;
  /** ラベル / ヘルパーの aria 関連付け用に外から id を渡したい場合 */
  labelId?: string;
  /** ラベルとは別の説明文 (例: "上限 100 文字" "MM/DD で入力" など) */
  description?: ReactNode;
  helper?: ReactNode;
  error?: string | null;
  counter?: { current: number; max: number };
  /** role 指定 (radiogroup / group など)。指定がなければ通常の div */
  role?: "group" | "radiogroup";
  children: ReactNode;
  className?: string;
}

export function LiffFieldWrapper({
  label, required, labelId, description, helper, error, counter, role, children, className,
}: LiffFieldWrapperProps) {
  const generatedId = useId();
  const id = labelId ?? generatedId;
  const ariaProps = role
    ? { role, "aria-labelledby": label ? id : undefined }
    : {};
  return (
    <div className={`${FIELD_WRAPPER_CLS} ${className ?? ""}`} {...ariaProps}>
      {label && <LiffFieldLabel id={id} required={required}>{label}</LiffFieldLabel>}
      {description && (
        <p className="text-[12px] leading-[1.5] text-[color:var(--liff-secondary-text,#666)]">
          {description}
        </p>
      )}
      {children}
      <LiffFieldHelper error={error} helper={helper} counter={counter} />
    </div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────

interface LiffInputBaseProps {
  label?: ReactNode;
  required?: boolean;
  description?: ReactNode;
  helper?: ReactNode;
  error?: string | null;
  /** counter 表示用。max を渡すと現在文字数を入力値から自動計算する */
  showCounter?: boolean;
  counterMax?: number;
}

export type LiffInputProps = LiffInputBaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & {
    type?: "text" | "email" | "tel" | "url" | "search";
    className?: string;
  };

export const LiffInput = forwardRef<HTMLInputElement, LiffInputProps>(
  function LiffInput(props, ref) {
    const {
      label, required, description, helper, error,
      showCounter, counterMax,
      className, type = "text", value, ...rest
    } = props;

    const currentLength = typeof value === "string" ? value.length : 0;
    const counter = showCounter && typeof counterMax === "number"
      ? { current: currentLength, max: counterMax }
      : undefined;

    const inputEl = (
      <input
        {...rest}
        type={type}
        value={value as string | number | readonly string[] | undefined}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`${INPUT_BASE_CLS} ${error ? INPUT_ERROR_CLS : ""} ${className ?? ""}`}
      />
    );

    if (label || description || helper || error || counter) {
      return (
        <LiffFieldWrapper
          label={label} required={required}
          description={description}
          helper={helper} error={error} counter={counter}
        >
          {inputEl}
        </LiffFieldWrapper>
      );
    }
    return inputEl;
  }
);

// ── Textarea ───────────────────────────────────────────────────────────────

export type LiffTextareaProps = LiffInputBaseProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
    className?: string;
  };

export const LiffTextarea = forwardRef<HTMLTextAreaElement, LiffTextareaProps>(
  function LiffTextarea(props, ref) {
    const {
      label, required, description, helper, error,
      showCounter, counterMax,
      className, value, rows = 4, ...rest
    } = props;

    const currentLength = typeof value === "string" ? value.length : 0;
    const counter = showCounter && typeof counterMax === "number"
      ? { current: currentLength, max: counterMax }
      : undefined;

    const textareaEl = (
      <textarea
        {...rest}
        value={value as string | readonly string[] | number | undefined}
        ref={ref}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={`${INPUT_BASE_CLS} resize-y min-h-[96px] ${error ? INPUT_ERROR_CLS : ""} ${className ?? ""}`}
      />
    );

    if (label || description || helper || error || counter) {
      return (
        <LiffFieldWrapper
          label={label} required={required}
          description={description}
          helper={helper} error={error} counter={counter}
        >
          {textareaEl}
        </LiffFieldWrapper>
      );
    }
    return textareaEl;
  }
);

// ── RadioGroup / CheckboxGroup ─────────────────────────────────────────────

interface ChoiceGroupCommonProps {
  label?: ReactNode;
  required?: boolean;
  description?: ReactNode;
  helper?: ReactNode;
  error?: string | null;
  /** option 配列 (string or {value, label}) */
  options: ReadonlyArray<string | { value: string; label: ReactNode }>;
  /** 設問ごとの input name (radio で使う、checkbox では使用しない) */
  name?: string;
  disabled?: boolean;
}

function normalizeOptions(
  options: ReadonlyArray<string | { value: string; label: ReactNode }>,
): Array<{ value: string; label: ReactNode }> {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
}

export interface LiffRadioGroupProps extends ChoiceGroupCommonProps {
  value: string;
  onChange: (next: string) => void;
}

export function LiffRadioGroup({
  label, required, description, helper, error,
  options, name, disabled, value, onChange,
}: LiffRadioGroupProps) {
  const fallbackName = useId();
  const inputName = name ?? fallbackName;
  const normalized = normalizeOptions(options);
  return (
    <LiffFieldWrapper
      role="radiogroup"
      label={label} required={required}
      description={description}
      helper={helper} error={error}
    >
      <div className="flex flex-col gap-2">
        {normalized.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-2 text-[15px] leading-[1.5] py-1 min-h-[28px] ${
              disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name={inputName}
              value={opt.value}
              checked={value === opt.value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className="mt-[3px] accent-[color:var(--liff-line-green,#06C755)]"
            />
            <span className="flex-1 min-w-0 break-words">{opt.label}</span>
          </label>
        ))}
      </div>
    </LiffFieldWrapper>
  );
}

export interface LiffCheckboxGroupProps extends ChoiceGroupCommonProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function LiffCheckboxGroup({
  label, required, description, helper, error,
  options, disabled, value, onChange,
}: LiffCheckboxGroupProps) {
  const normalized = normalizeOptions(options);
  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <LiffFieldWrapper
      role="group"
      label={label} required={required}
      description={description}
      helper={helper} error={error}
    >
      <div className="flex flex-col gap-2">
        {normalized.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-2 text-[15px] leading-[1.5] py-1 min-h-[28px] ${
              disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={value.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              disabled={disabled}
              className="mt-[3px] accent-[color:var(--liff-line-green,#06C755)]"
            />
            <span className="flex-1 min-w-0 break-words">{opt.label}</span>
          </label>
        ))}
      </div>
    </LiffFieldWrapper>
  );
}
