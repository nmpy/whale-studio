"use client";

// src/components/destination/QueryParamsEditor.tsx
// key-value 形式のクエリパラメータ編集UI。
// 非エンジニアでも触りやすいように、JSON ではなく行追加式。

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
      <label className="block text-xs font-medium text-gray-500 mb-1">
        追加パラメータ
      </label>

      {entries.length === 0 && !disabled && (
        <p className="text-[11px] text-gray-400 mb-1">
          LIFF URL に追加するクエリパラメータです（例: tab=evidence, entry=richmenu）
        </p>
      )}

      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-200"
            value={k}
            placeholder="key"
            disabled={disabled}
            onChange={(e) => updateKey(k, e.target.value, v)}
          />
          <span className="text-gray-300 text-xs">=</span>
          <input
            className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
            value={v}
            placeholder="value"
            disabled={disabled}
            onChange={(e) => updateValue(k, e.target.value)}
          />
          {!disabled && (
            <button
              onClick={() => removeEntry(k)}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors text-sm"
              title="削除"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <button
          onClick={addEntry}
          className="text-xs text-teal-600 hover:text-teal-800 font-medium"
        >
          + パラメータを追加
        </button>
      )}
    </div>
  );
}
