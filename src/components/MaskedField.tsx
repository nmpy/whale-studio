"use client";

import { useState } from "react";

interface Props {
  id?: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  errorMessages?: string[];
}

/**
 * channel_secret / channel_access_token などの機密フィールド用コンポーネント。
 * デフォルトはマスク表示（type="password"）。「表示」ボタンで平文に切り替え可能。
 * readOnly=true の場合は表示専用として使用可（コピーボタン付き）。
 */
export function MaskedField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  readOnly = false,
  errorMessages,
}: Props) {
  const [shown, setShown]     = useState(false);
  const [copied, setCopied]   = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API が使えない場合は無視
    }
  }

  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label}
        {required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
      </label>

      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          required={required}
          readOnly={readOnly}
          style={{
            flex: 1,
            fontFamily: shown ? "ui-monospace, monospace" : undefined,
            fontSize: shown ? 12 : undefined,
            letterSpacing: shown ? undefined : "0.1em",
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "8px 12px", flexShrink: 0, fontSize: 13 }}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "非表示にする" : "表示する"}
        >
          {shown ? "隠す" : "表示"}
        </button>
        {readOnly && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "8px 12px", flexShrink: 0, fontSize: 13 }}
            onClick={handleCopy}
          >
            {copied ? "コピー済" : "コピー"}
          </button>
        )}
      </div>

      {!readOnly && (
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
          「表示」ボタンで内容を確認できます
        </p>
      )}

      {errorMessages?.map((m) => (
        <p key={m} className="field-error">{m}</p>
      ))}
    </div>
  );
}
