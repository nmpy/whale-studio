"use client";

// src/components/destination/TapDestinationSection.tsx
// 「画像タップ時の遷移先」「ボタンの遷移先」で共通使用するセクション。
// destination 選択 or 直接URL入力 の2択UI。

import { DestinationSelect } from "./DestinationSelect";
import type { LineDestination } from "@/types";

export type TapMode = "destination" | "direct_url" | "none";

interface Props {
  label?: string;
  workId: string;
  oaId?: string;
  mode: TapMode;
  destinationId: string | null;
  directUrl: string;
  disabled?: boolean;
  /** destination 一覧を外部から注入（重複フェッチ防止） */
  destinations?: LineDestination[];
  onModeChange: (mode: TapMode) => void;
  onDestinationChange: (id: string | null, dest: LineDestination | null) => void;
  onDirectUrlChange: (url: string) => void;
}

export function TapDestinationSection({
  label = "画像タップ時の遷移先",
  workId, oaId, mode, destinationId, directUrl, disabled,
  destinations, onModeChange, onDestinationChange, onDirectUrlChange,
}: Props) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-gray-500">{label}</label>

      {/* モード切替 */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => onModeChange("destination")}
          disabled={disabled}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === "destination"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          保存済みの遷移先を使う
        </button>
        <button
          type="button"
          onClick={() => onModeChange("direct_url")}
          disabled={disabled}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === "direct_url"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          URLを直接入力する
        </button>
      </div>

      {/* destination モード */}
      {mode === "destination" && (
        <DestinationSelect
          workId={workId}
          oaId={oaId}
          value={destinationId}
          onChange={onDestinationChange}
          disabled={disabled}
          destinations={destinations}
        />
      )}

      {/* 直接URL入力モード */}
      {mode === "direct_url" && (
        <input
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:bg-gray-50"
          value={directUrl}
          onChange={(e) => onDirectUrlChange(e.target.value)}
          disabled={disabled}
          placeholder="https://..."
        />
      )}

      {/* none モード（何も設定しない） */}
      {mode === "none" && (
        <p className="text-xs text-gray-400">
          遷移先が未設定です。上のボタンで設定方法を選んでください。
        </p>
      )}
    </div>
  );
}
