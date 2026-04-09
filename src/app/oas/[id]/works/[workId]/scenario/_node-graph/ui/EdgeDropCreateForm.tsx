"use client";

// _node-graph/ui/EdgeDropCreateForm.tsx — エッジドラッグ→空白で新規フェーズ作成

import { useState } from "react";
import type { PhaseType } from "@/types";
import { phaseApi, transitionApi, getDevToken } from "@/lib/api-client";

interface EdgeDropCreateFormProps {
  workId: string;
  fromPhaseId: string;
  position: { x: number; y: number };
  onCreated: (newPhaseId: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}

export function EdgeDropCreateForm({
  workId,
  fromPhaseId,
  position,
  onCreated,
  onCancel,
  onError,
}: EdgeDropCreateFormProps) {
  const [name, setName] = useState("");
  const [phaseType, setPhaseType] = useState<PhaseType>("normal");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const token = getDevToken();

      // 1. フェーズ作成
      const newPhase = await phaseApi.create(token, {
        work_id: workId,
        name: name.trim(),
        phase_type: phaseType,
      });

      // 2. 遷移作成（from → new）
      await transitionApi.create(token, {
        work_id: workId,
        from_phase_id: fromPhaseId,
        to_phase_id: newPhase.id,
        label: name.trim(),
      });

      onCreated(newPhase.id);
    } catch (err) {
      console.error(err);
      onError("フェーズの作成に失敗しました");
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
        border: "1px solid #bfdbfe",
        borderRadius: 10,
        padding: "12px 14px",
        zIndex: 60,
        width: 220,
        boxShadow: "0 4px 20px rgba(37,99,235,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#2563eb" }}>
        → 新規フェーズを追加して接続
      </div>
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
          {saving ? "作成中…" : "作成＆接続"}
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
