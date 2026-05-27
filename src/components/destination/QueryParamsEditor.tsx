"use client";

// src/components/destination/QueryParamsEditor.tsx
// key-value 形式のクエリパラメータ編集UI。
// 非エンジニアでも触りやすいように、JSON ではなく行追加式。
//
// Phase 4.2c: UI を Phase 0 トークン + compactInputClass に揃える。
// updateKey / updateValue / removeEntry / addEntry / placeholder key
// (`param${i+1}`) / 全文言・disabled 制御は完全維持。

// 行内 input 共通 className (= Phase 3.1 compactInputClass と同パターン)
const compactInputClass =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

interface Props {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  disabled?: boolean;
}

export function QueryParamsEditor({ value, onChange, disabled }: Props) {
  const entries = Object.entries(value);

  const updateKey = (oldKey: string, newKey: string, val: string) => {
    const next = { ...value };
    delete next[oldKey];
    next[newKey] = val;
    onChange(next);
  };

  const updateValue = (key: string, val: string) => {
    onChange({ ...value, [key]: val });
  };

  const removeEntry = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const addEntry = () => {
    // 空キーで追加（ユーザーが入力する）
    const placeholder = `param${entries.length + 1}`;
    onChange({ ...value, [placeholder]: "" });
  };

  return (
    <div className="space-y-2">
      <label className="mb-1 block text-[13px] font-bold text-ink">
        追加パラメータ
      </label>

      {entries.length === 0 && !disabled && (
        <p className="mb-1 text-[11px] text-ink-3">
          LIFF URL に追加するクエリパラメータです（例: tab=evidence, entry=richmenu）
        </p>
      )}

      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={compactInputClass + " flex-1 font-mono"}
            value={k}
            placeholder="key"
            disabled={disabled}
            onChange={(e) => updateKey(k, e.target.value, v)}
          />
          <span className="text-[12px] text-ink-3">=</span>
          <input
            className={compactInputClass + " flex-1"}
            value={v}
            placeholder="value"
            disabled={disabled}
            onChange={(e) => updateValue(k, e.target.value)}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => removeEntry(k)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
              title="削除"
              aria-label="パラメータを削除"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <button
          type="button"
          onClick={addEntry}
          className="text-[12px] font-medium text-brand transition-colors hover:text-brand-ink"
        >
          + パラメータを追加
        </button>
      )}
    </div>
  );
}
