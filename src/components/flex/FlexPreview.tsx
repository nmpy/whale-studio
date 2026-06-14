"use client";

// src/components/flex/FlexPreview.tsx
// Flex Message JSON の「簡易」LINE プレビュー（右側プレビュー内で使用）。
// - normalizeFlexJson（JSON.parse のみ・eval 不使用）で contents を取り出す。
// - bubble / carousel / wrapper({type:"flex",contents}) / contents のみ いずれも対応。
// - 完全再現はしない。hero画像 / body の text・image・button・separator・box を最小描画する。
// - action は実行しない（見た目のみ）。不正・想定外でもフォームをクラッシュさせない
//   （防御的アクセサ + ErrorBoundary + depth/node 上限）。保存値・送信ロジックには一切触れない。

import { Component, type ReactNode } from "react";
import { normalizeFlexJson } from "@/lib/flex";

const MAX_DEPTH = 10;
const MAX_NODES = 150;
const MAX_BUBBLES = 10;

type AnyObj = Record<string, unknown>;
const asObj = (v: unknown): AnyObj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as AnyObj) : null);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isHttp = (v: string): boolean => /^https?:\/\//i.test(v);

const SIZE_PX: Record<string, number> = { xxs: 10, xs: 11, sm: 12, md: 13, lg: 16, xl: 19, xxl: 22, "3xl": 26, "4xl": 30, "5xl": 34 };
const textSize = (v: unknown): number => SIZE_PX[str(v)] ?? 13;

const fallback = (
  <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
    Flex JSONをプレビューできません（JSON形式を確認してください）
  </div>
);

/** 想定外の構造で render が throw してもフォーム全体を壊さないための境界。 */
class FlexErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? fallback : this.props.children; }
}

/** Flex の 1 ノードを最小描画する（再帰）。未対応 type は無視。action は実行しない。 */
function FlexNode({ node, depth, counter }: { node: unknown; depth: number; counter: { n: number } }) {
  if (depth > MAX_DEPTH || counter.n > MAX_NODES) return null;
  const o = asObj(node);
  if (!o) return null;
  counter.n += 1;
  const type = str(o.type);

  if (type === "box") {
    const horizontal = o.layout === "horizontal" || o.layout === "baseline";
    return (
      <div style={{ display: "flex", flexDirection: horizontal ? "row" : "column", gap: 6, alignItems: horizontal ? "center" : "stretch", flexWrap: "wrap", minWidth: 0 }}>
        {asArr(o.contents).map((c, i) => <FlexNode key={i} node={c} depth={depth + 1} counter={counter} />)}
      </div>
    );
  }
  if (type === "text" || type === "span") {
    const t = str(o.text);
    return (
      <div style={{
        fontSize: textSize(o.size), fontWeight: o.weight === "bold" ? 700 : 400,
        color: isHttp(str(o.color)) ? "#111827" : (str(o.color) || "#111827"),
        textAlign: (str(o.align) as "left" | "center" | "right") || "left",
        wordBreak: "break-word", whiteSpace: "pre-wrap", lineHeight: 1.5, minWidth: 0,
      }}>
        {t || " "}
      </div>
    );
  }
  if (type === "image") {
    const url = str(o.url);
    if (!isHttp(url)) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 4, display: "block" }} />;
  }
  if (type === "icon") {
    const url = str(o.url);
    // eslint-disable-next-line @next/next/no-img-element
    return isHttp(url) ? <img src={url} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} /> : null;
  }
  if (type === "button") {
    const action = asObj(o.action);
    const label = str(action?.label) || str(o.label) || "ボタン";
    // action は実行しない（見た目だけのボタン風）。
    return (
      <div style={{
        padding: "6px 10px", borderRadius: 6, background: "#06C755", color: "#fff",
        fontSize: 12, fontWeight: 600, textAlign: "center", wordBreak: "break-word",
      }}>
        {label}
      </div>
    );
  }
  if (type === "separator") {
    return <div style={{ height: 1, background: "#e5e7eb", margin: "4px 0" }} />;
  }
  // spacer / filler / video / unknown 等は最小対応として無視。
  return null;
}

/** bubble 1 つを LINE 風カードで描画。 */
function FlexBubble({ bubble }: { bubble: AnyObj }) {
  const counter = { n: 0 };
  const hero = asObj(bubble.hero);
  const heroUrl = hero && str(hero.type) === "image" ? str(hero.url) : "";
  const body = asObj(bubble.body);
  const footer = asObj(bubble.footer);
  return (
    <div style={{ width: 240, flex: "0 0 auto", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
      {isHttp(heroUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={heroUrl} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", display: "block" }} />
      )}
      {body && <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}><FlexNode node={body} depth={0} counter={counter} /></div>}
      {footer && <div style={{ padding: 12, borderTop: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 6 }}><FlexNode node={footer} depth={0} counter={counter} /></div>}
      {!body && !footer && !isHttp(heroUrl) && <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>（表示できる要素がありません）</div>}
    </div>
  );
}

/** Flex JSON 文字列を簡易プレビューする。保存値・送信には一切影響しない。 */
export function FlexPreview({ json }: { json: string }) {
  const norm = normalizeFlexJson(json);
  if (!norm.ok) return fallback;

  const contents = norm.value.contents as AnyObj;
  let inner: ReactNode;
  if (str(contents.type) === "carousel") {
    const bubbles = asArr(contents.contents).map(asObj).filter((b): b is AnyObj => !!b);
    inner = bubbles.length === 0
      ? fallback
      : (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, maxWidth: "100%" }}>
          {bubbles.slice(0, MAX_BUBBLES).map((b, i) => <FlexBubble key={i} bubble={b} />)}
        </div>
      );
  } else {
    inner = (
      <div style={{ display: "flex", maxWidth: "100%", overflowX: "auto" }}>
        <FlexBubble bubble={contents} />
      </div>
    );
  }

  return <FlexErrorBoundary>{inner}</FlexErrorBoundary>;
}
