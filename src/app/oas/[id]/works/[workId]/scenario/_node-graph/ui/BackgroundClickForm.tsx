"use client";

// _node-graph/ui/BackgroundClickForm.tsx — 背景クリックでフェーズ作成ポップオーバー

import { useState } from "react";
import type { PhaseType } from "@/types";
import { phaseApi, getDevToken } from "@/lib/api-client";

interface BackgroundClickFormProps {
  workId: string;
  position: { x: number; y: number };
  hasStart: boolean;
  onCreated: () => void;
  onCancel: () => void;
}

export function BackgroundClickForm({
  workId,
  position,
  hasStart,
  onCreated,
  onCancel,
}: BackgroundClickFormProps) {
  const [name, setName] = useState("");
  const [phaseType, setPhaseType] = useState<PhaseType>("normal");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await phaseApi.create(getDevToken(), {
        work_id:    workId,
        name:       name.trim(),
        phase_type: phaseType,
      });
      onCreated();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "12px 14px",
        zIndex: 60,
        width: 220,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>＋ フェーズを追加</div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="フェーズ名"
        style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
        onKeyDown={e => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") onCancel();
        }}
      />
      <select
        value={phaseType}
        onChange={e => setPhaseType(e.target.value as PhaseType)}
        style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 6px" }}
      >
        {!hasStart && <option value="start">開始</option>}
        <option value="normal">通常</option>
        <option value="ending">エンディング</option>
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim()}
          style={{
            fontSize: 11, padding: "5px 12px",
            background: "#2563eb", color: "white",
            border: "none", borderRadius: 4, cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {saving ? "作成中…" : "作成"}
        </button>
        <button
          onClick={onCancel}
          style={{
            fontSize: 11, padding: "5px 10px",
            background: "#f3f4f6", color: "#374151",
            border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
          }}
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
