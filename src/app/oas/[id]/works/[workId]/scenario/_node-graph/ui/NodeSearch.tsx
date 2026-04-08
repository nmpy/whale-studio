"use client";

// _node-graph/ui/NodeSearch.tsx — ノード検索機能

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node } from "@xyflow/react";

interface NodeSearchProps {
  nodes: Node[];
  onFocus: (nodeId: string) => void;
}

export function NodeSearch({ nodes, onFocus }: NodeSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // debounce 100ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setMatchIndex(0);
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // 検索結果
  const matches = debouncedQuery.trim()
    ? nodes.filter(n => {
        const label = (n.data as { label?: string }).label ?? "";
        return label.toLowerCase().includes(debouncedQuery.toLowerCase());
      })
    : [];

  const currentMatch = matches[matchIndex] ?? null;

  // ヒットノードへフォーカス
  useEffect(() => {
    if (currentMatch) {
      onFocus(currentMatch.id);
    }
  }, [currentMatch, onFocus]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex(prev => (prev + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex(prev => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  // ショートカット: Ctrl+F で開く
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        aria-label="ノードを検索"
        title="ノードを検索 (Ctrl+F)"
        style={{
          position: "absolute",
          top: 52,
          left: 14,
          fontSize: 11,
          fontWeight: 600,
          padding: "5px 10px",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          background: "white",
          color: "#475569",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          zIndex: 10,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        🔍 検索
      </button>
    );
  }

  return (
    <div
      role="search"
      aria-label="ノード検索"
      style={{
        position: "absolute",
        top: 52,
        left: 14,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "4px 8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
        zIndex: 20,
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="ノード名で検索…"
        aria-label="ノード名で検索"
        style={{
          fontSize: 12,
          border: "none",
          outline: "none",
          width: 160,
          padding: "3px 4px",
        }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.shiftKey ? goPrev() : goNext(); }
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            setDebouncedQuery("");
          }
        }}
      />

      {/* 件数表示 */}
      {debouncedQuery.trim() && (
        <span style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap" }}>
          {matches.length > 0
            ? `${matchIndex + 1}/${matches.length}`
            : "0件"}
        </span>
      )}

      {/* 前/次ボタン */}
      <button
        onClick={goPrev}
        disabled={matches.length === 0}
        aria-label="前の検索結果"
        style={{
          fontSize: 12, border: "none", background: "none",
          cursor: matches.length > 0 ? "pointer" : "not-allowed",
          color: matches.length > 0 ? "#475569" : "#d1d5db",
          padding: "2px 4px",
        }}
      >
        ▲
      </button>
      <button
        onClick={goNext}
        disabled={matches.length === 0}
        aria-label="次の検索結果"
        style={{
          fontSize: 12, border: "none", background: "none",
          cursor: matches.length > 0 ? "pointer" : "not-allowed",
          color: matches.length > 0 ? "#475569" : "#d1d5db",
          padding: "2px 4px",
        }}
      >
        ▼
      </button>

      {/* 閉じる */}
      <button
        onClick={() => { setOpen(false); setQuery(""); setDebouncedQuery(""); }}
        aria-label="検索を閉じる"
        style={{
          fontSize: 14, border: "none", background: "none",
          cursor: "pointer", color: "#9ca3af", padding: "2px 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}
