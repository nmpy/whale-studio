"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { richMenuEditorApi, oaApi, workApi, destinationApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";
import type { RichMenuWithAreas, RichMenuArea, CreateRichMenuAreaBody, RichMenuSize, LineDestination } from "@/types";

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────
const LINE_W = 2500;
const LINE_H_COMPACT = 843;
const LINE_H_FULL    = 1686;

type ActionType = "message" | "postback" | "uri";

interface AreaDraft {
  id?:             string;  // 既存エリアの場合のみ
  x:               number;
  y:               number;
  width:           number;
  height:          number;
  action_type:     ActionType;
  action_label:    string;
  action_text:     string;
  action_data:     string;
  action_uri:      string;
  destination_id:  string;  // "" = 未設定
  sort_order:      number;
}

// ────────────────────────────────────────────────
// テンプレート定義
// ────────────────────────────────────────────────
interface Template {
  id:    string;
  label: string;
  icon:  string;
  build: (size: "full" | "compact") => Omit<AreaDraft, "id">[];
}

const TEMPLATES: Template[] = [
  {
    id: "3col", label: "3列", icon: "|||",
    build: (size) => {
      const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
      const sw = Math.floor(LINE_W / 3);
      return [
        { x: 0,      y: 0, width: sw,            height: H, action_type: "message", action_label: "ボタン1", action_text: "ボタン1", action_data: "", action_uri: "", destination_id: "", sort_order: 0 },
        { x: sw,     y: 0, width: sw,            height: H, action_type: "message", action_label: "ボタン2", action_text: "ボタン2", action_data: "", action_uri: "", destination_id: "", sort_order: 1 },
        { x: sw * 2, y: 0, width: LINE_W - sw*2, height: H, action_type: "message", action_label: "ボタン3", action_text: "ボタン3", action_data: "", action_uri: "", destination_id: "", sort_order: 2 },
      ];
    },
  },
  {
    id: "2col", label: "2列", icon: "||",
    build: (size) => {
      const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
      const hw = Math.floor(LINE_W / 2);
      return [
        { x: 0,  y: 0, width: hw,          height: H, action_type: "message", action_label: "ボタン1", action_text: "ボタン1", action_data: "", action_uri: "", destination_id: "", sort_order: 0 },
        { x: hw, y: 0, width: LINE_W - hw, height: H, action_type: "message", action_label: "ボタン2", action_text: "ボタン2", action_data: "", action_uri: "", destination_id: "", sort_order: 1 },
      ];
    },
  },
  {
    id: "4grid", label: "2×2", icon: "⊞",
    build: (size) => {
      const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
      const hw = Math.floor(LINE_W / 2);
      const hh = Math.floor(H / 2);
      return [
        { x: 0,  y: 0,  width: hw,          height: hh,      action_type: "message", action_label: "ボタン1", action_text: "ボタン1", action_data: "", action_uri: "", destination_id: "", sort_order: 0 },
        { x: hw, y: 0,  width: LINE_W - hw, height: hh,      action_type: "message", action_label: "ボタン2", action_text: "ボタン2", action_data: "", action_uri: "", destination_id: "", sort_order: 1 },
        { x: 0,  y: hh, width: hw,          height: H - hh,  action_type: "message", action_label: "ボタン3", action_text: "ボタン3", action_data: "", action_uri: "", destination_id: "", sort_order: 2 },
        { x: hw, y: hh, width: LINE_W - hw, height: H - hh,  action_type: "message", action_label: "ボタン4", action_text: "ボタン4", action_data: "", action_uri: "", destination_id: "", sort_order: 3 },
      ];
    },
  },
  {
    id: "3col2row", label: "3列×2行", icon: "⋮⋮⋮",
    build: (size) => {
      const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
      const sw = Math.floor(LINE_W / 3);
      const hh = Math.floor(H / 2);
      const areas: Omit<AreaDraft, "id">[] = [];
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const idx = row * 3 + col;
          areas.push({
            x: sw * col,
            y: hh * row,
            width:  col < 2 ? sw : LINE_W - sw * 2,
            height: row < 1 ? hh : H - hh,
            action_type:  "message",
            action_label: `ボタン${idx + 1}`,
            action_text:  `ボタン${idx + 1}`,
            action_data:  "",
            action_uri:      "",
            destination_id:  "",
            sort_order:      idx,
          });
        }
      }
      return areas;
    },
  },
  {
    id: "fullscreen", label: "全面1ボタン", icon: "□",
    build: (size) => {
      const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
      return [
        { x: 0, y: 0, width: LINE_W, height: H, action_type: "message", action_label: "タップ", action_text: "タップ", action_data: "", action_uri: "", destination_id: "", sort_order: 0 },
      ];
    },
  },
];

// ────────────────────────────────────────────────
// エリアカラー
// ────────────────────────────────────────────────
const AREA_COLORS = [
  "#6366f1","#22c55e","#f59e0b","#ef4444","#3b82f6",
  "#ec4899","#14b8a6","#f97316","#8b5cf6","#06b6d4",
];

// ────────────────────────────────────────────────
// ヘルパー: RichMenuArea → AreaDraft
// ────────────────────────────────────────────────
function areaToDraft(a: RichMenuArea): AreaDraft {
  return {
    id:           a.id,
    x:            a.x,
    y:            a.y,
    width:        a.width,
    height:       a.height,
    action_type:  a.action_type as ActionType,
    action_label: a.action_label,
    action_text:  a.action_text ?? "",
    action_data:  a.action_data ?? "",
    action_uri:      a.action_uri  ?? "",
    destination_id:  a.destination_id ?? "",
    sort_order:      a.sort_order,
  };
}

function draftToBody(d: AreaDraft): CreateRichMenuAreaBody {
  return {
    x:            d.x,
    y:            d.y,
    width:        d.width,
    height:       d.height,
    action_type:  d.action_type,
    action_label: d.action_label,
    action_text:  d.action_text  || null,
    action_data:  d.action_data  || null,
    action_uri:      d.action_uri   || null,
    destination_id:  d.destination_id || null,
    sort_order:      d.sort_order,
  };
}

// ────────────────────────────────────────────────
// 適用前バリデーション
// ────────────────────────────────────────────────

interface ValidationError {
  /** undefined = メニュー全体の問題。0 以上の数値 = 該当エリアのインデックス */
  areaIndex?: number;
  message:    string;
}

/** URL として有効かどうかを判定する */
function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 2 つの矩形が重複しているか（辺の接触は重複と見なさない） */
function rectsOverlap(a: AreaDraft, b: AreaDraft): boolean {
  return (
    a.x          < b.x + b.width  &&
    a.x + a.width  > b.x           &&
    a.y          < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * リッチメニューの設定を LINE 適用前に検証する。
 * @returns エラーの配列。空配列なら問題なし。
 */
function validateRichMenu(params: {
  areas:    AreaDraft[];
  size:     RichMenuSize;
  imageUrl: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  const { areas, size, imageUrl } = params;
  const menuW = LINE_W;
  const menuH = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;

  // ── 必須: エリアが 1 つ以上 ──────────────────
  if (areas.length === 0) {
    errors.push({
      message: "エリアが1つもありません。テンプレートを選択するか「エリアを追加」してください。",
    });
    // 以降のエリア単位チェックは不要なので早期リターン
    return errors;
  }

  // ── 必須: 背景画像 URL ────────────────────────
  if (!imageUrl.trim()) {
    errors.push({ message: "背景画像 URL が設定されていません。" });
  } else if (!isValidUrl(imageUrl.trim())) {
    errors.push({ message: `背景画像 URL が不正です（http / https で始まる URL を入力してください）。` });
  }

  // ── エリアごとのチェック ──────────────────────
  areas.forEach((area, i) => {
    const label = area.action_label.trim() || `エリア ${i + 1}`;

    // action_type ごとの値チェック
    if (area.action_type === "message") {
      if (!area.action_text.trim()) {
        errors.push({
          areaIndex: i,
          message:   `「${label}」の送信テキスト（action_text）が空です。`,
        });
      }
    } else if (area.action_type === "postback") {
      if (!area.action_data.trim()) {
        errors.push({
          areaIndex: i,
          message:   `「${label}」の postback data が空です。Webhook に送信するデータを入力してください。`,
        });
      }
    } else if (area.action_type === "uri") {
      if (!area.action_uri.trim() && !area.destination_id) {
        errors.push({
          areaIndex: i,
          message:   `「${label}」の URL が空です。`,
        });
      } else if (!isValidUrl(area.action_uri.trim())) {
        errors.push({
          areaIndex: i,
          message:   `「${label}」の URL が不正です: ${area.action_uri}`,
        });
      }
    }

    // ラベル長チェック（LINE 制限: 20 文字）
    if (area.action_label.length > 20) {
      errors.push({
        areaIndex: i,
        message:   `「${label}」のラベルが20文字を超えています（現在 ${area.action_label.length} 文字）。`,
      });
    }

    // 座標・サイズが有効か
    if (area.x < 0 || area.y < 0) {
      errors.push({
        areaIndex: i,
        message:   `「${label}」の座標が負の値です（x=${area.x}, y=${area.y}）。`,
      });
    }
    if (area.width <= 0 || area.height <= 0) {
      errors.push({
        areaIndex: i,
        message:   `「${label}」の幅または高さが 0 以下です（${area.width}×${area.height}）。`,
      });
    }

    // メニューサイズ内に収まっているか
    const rightEdge  = area.x + area.width;
    const bottomEdge = area.y + area.height;
    if (rightEdge > menuW || bottomEdge > menuH) {
      errors.push({
        areaIndex: i,
        message:
          `「${label}」がメニュー領域（2500×${menuH}）をはみ出しています` +
          `（右端: ${rightEdge}, 下端: ${bottomEdge}）。`,
      });
    }
  });

  // ── エリア同士の重複チェック ──────────────────
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      if (rectsOverlap(areas[i], areas[j])) {
        const labelA = areas[i].action_label.trim() || `エリア ${i + 1}`;
        const labelB = areas[j].action_label.trim() || `エリア ${j + 1}`;
        errors.push({
          message: `「${labelA}」と「${labelB}」のエリアが重複しています。`,
        });
      }
    }
  }

  return errors;
}

// ────────────────────────────────────────────────
// リッチメニュー用 destination セレクト（OA配下の全作品の destination を表示）
// ────────────────────────────────────────────────
function RichMenuDestinationSelect({ oaId, value, onChange }: {
  oaId: string;
  value: string;
  onChange: (destId: string, resolvedUrl: string | null) => void;
}) {
  const [destinations, setDestinations] = useState<LineDestination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getDevToken();
    workApi.list(token, oaId).then(async (works) => {
      const allDests: LineDestination[] = [];
      for (const w of works) {
        try {
          const dests = await destinationApi.list(token, w.id);
          allDests.push(...dests.filter((d) => d.is_enabled));
        } catch { /* ignore */ }
      }
      setDestinations(allDests);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [oaId]);

  if (loading) return <div style={{ height: 36, background: "#f3f4f6", borderRadius: 8 }} />;

  const selected = value ? destinations.find((d) => d.id === value) : null;
  const resolvedUrl = selected ? (selected.resolved_url ?? resolveDestinationUrlFromApi(selected)) : null;

  const TYPE_LABELS: Record<string, string> = { liff: "LIFF", internal_url: "内部URL", external_url: "外部URL" };

  // 空状態
  if (destinations.length === 0) {
    return (
      <div style={{ padding: 12, background: "#f0fdfa", borderRadius: 8, border: "1px solid #ccfbf1", textAlign: "center" }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: "#0d9488", marginBottom: 4 }}>
          保存済みの遷移先がまだありません
        </p>
        <p style={{ fontSize: 11, color: "#5eead4", marginBottom: 8 }}>
          作品の「遷移先URL設定」で作成すると、ここから選べるようになります
        </p>
      </div>
    );
  }

  return (
    <div>
      <select
        className="input"
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const dest = destinations.find((d) => d.id === id);
          const url = dest ? (dest.resolved_url ?? resolveDestinationUrlFromApi(dest)) : null;
          onChange(id, url);
        }}
      >
        <option value="">遷移先を選択...</option>
        {destinations.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.key}) — {TYPE_LABELS[d.destination_type] ?? d.destination_type}
          </option>
        ))}
      </select>
      {/* 選択中の補助情報 */}
      {selected && (
        <div style={{ marginTop: 6, padding: "6px 8px", background: "#f9fafb", borderRadius: 6, border: "1px solid #f3f4f6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>{selected.name}</span>
            <code style={{ fontSize: 10, background: "#e5e7eb", color: "#6b7280", padding: "1px 4px", borderRadius: 3 }}>{selected.key}</code>
          </div>
          {resolvedUrl && (
            <p style={{ fontSize: 10, color: "#9ca3af", wordBreak: "break-all" }}>{resolvedUrl}</p>
          )}
        </div>
      )}
      <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
        繰り返し使うURLは「遷移先URL設定」に保存すると再利用できます
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────
// ページコンポーネント
// ────────────────────────────────────────────────
export default function RichMenuEditorPage() {
  const params  = useParams<{ id: string; richMenuId: string }>();
  const router  = useRouter();
  const oaId    = params.id;
  const menuId  = params.richMenuId;
  const { showToast } = useToast();

  const [oaTitle,   setOaTitle]   = useState("");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [applying,  setApplying]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // メニュー基本設定
  const [menuName,     setMenuName]     = useState("");
  const [chatBarText,  setChatBarText]  = useState("メニュー");
  const [size,         setSize]         = useState<RichMenuSize>("compact");
  const [imageUrl,     setImageUrl]     = useState("");
  const [lineMenuId,   setLineMenuId]   = useState<string | null>(null);

  // エリア
  const [areas,      setAreas]      = useState<AreaDraft[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // バリデーションエラー（適用ボタン押下時にセット。編集で自動クリア）
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

  // 背景画像の読み込み状態（RichMenuPreview からコールバックで受け取る）
  const [imgLoadState, setImgLoadState] = useState<ImgLoadState>("idle");

  // ── データロード ──
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, menu] = await Promise.all([
        oaApi.get(token, oaId),
        richMenuEditorApi.get(token, menuId),
      ]);
      setOaTitle(oa.title);
      setMenuName(menu.name);
      setChatBarText(menu.chat_bar_text);
      setSize(menu.size as RichMenuSize);
      setImageUrl(menu.image_url ?? "");
      setLineMenuId(menu.line_rich_menu_id);
      setAreas(menu.areas.map(areaToDraft));
      if (menu.areas.length > 0) setSelectedIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [oaId, menuId]);

  useEffect(() => { load(); }, [load]);

  // ── テンプレート適用 ──
  function applyTemplate(tpl: Template) {
    if (!confirm(`テンプレート「${tpl.label}」を適用します。現在のエリア設定は上書きされます。`)) return;
    const newAreas = tpl.build(size);
    setAreas(newAreas);
    setSelectedIdx(0);
    setValidationErrors([]); // テンプレート変更でエラーをリセット
  }

  // ── エリア更新 ──
  function updateArea(idx: number, patch: Partial<AreaDraft>) {
    setAreas((prev) => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
    setValidationErrors([]); // 編集時はエラーをリセット
  }

  // ── 保存 ──
  async function handleSave() {
    if (areas.length === 0) {
      showToast("エリアを1つ以上設定してください", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await richMenuEditorApi.update(getDevToken(), menuId, {
        name:          menuName,
        chat_bar_text: chatBarText,
        size,
        image_url:     imageUrl.trim() || null,
        areas:         areas.map(draftToBody),
      });
      // DB に保存された値でローカル state を上書き（保存漏れ・型変換ズレを即検知）
      setAreas(saved.areas.map(areaToDraft));
      showToast("保存しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── LINE 適用 ──
  async function handleApply() {
    // ── バリデーション（LINE API 呼び出し前） ──────────────────────────
    const errs = validateRichMenu({ areas, size, imageUrl });
    if (errs.length > 0) {
      setValidationErrors(errs);
      showToast(
        `適用できません（${errs.length}件の問題があります）。下のエラー一覧を確認してください。`,
        "error"
      );
      // エラー一覧の先頭へスクロール
      document.getElementById("validation-errors")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // バリデーション通過 → エラーをクリア
    setValidationErrors([]);

    if (!confirm("現在の設定を LINE に適用します。このチャンネルのデフォルトメニューと置き換わります。")) return;
    setApplying(true);
    try {
      // まず保存してから適用（保存結果で state を同期し、apply は DB の最新値を使う）
      const saved = await richMenuEditorApi.update(getDevToken(), menuId, {
        name:          menuName,
        chat_bar_text: chatBarText,
        size,
        image_url:     imageUrl.trim() || null,
        areas:         areas.map(draftToBody),
      });
      setAreas(saved.areas.map(areaToDraft));
      const result = await richMenuEditorApi.apply(getDevToken(), menuId);
      setLineMenuId(result.line_rich_menu_id);
      showToast("LINE に適用しました！", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "適用に失敗しました", "error");
    } finally {
      setApplying(false);
    }
  }

  const lineH = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
  const selectedArea = selectedIdx !== null ? areas[selectedIdx] : null;

  if (loading) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "リッチメニュー" },
            { label: "編集" },
          ]} />
          <h2>🎨 リッチメニューエディター</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
          <div className="skeleton" style={{ height: 300, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 300, borderRadius: 10 }} />
        </div>
      </>
    );
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "リッチメニュー" },
            { label: "編集" },
          ]} />
          <h2>🎨 {menuName || "リッチメニュー編集"}</h2>
          {lineMenuId && (
            <p style={{ fontSize: 12, color: "#15803d", marginTop: 4 }}>
              LINE 適用済み（ID: {lineMenuId}）
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" onClick={handleSave} disabled={saving || applying}>
            {saving ? <><span className="spinner" /> 保存中…</> : "💾 保存（下書き）"}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleApply}
            disabled={saving || applying}
            style={validationErrors.length > 0 ? { background: "#dc2626", borderColor: "#dc2626" } : undefined}
          >
            {applying ? (
              <><span className="spinner" /> 適用中…</>
            ) : validationErrors.length > 0 ? (
              <>📲 保存して LINE 適用 <span style={{
                background: "#fff", color: "#dc2626",
                borderRadius: 20, fontSize: 11, fontWeight: 700,
                padding: "1px 7px", marginLeft: 6,
              }}>❌ {validationErrors.length}</span></>
            ) : (
              "📲 保存して LINE 適用"
            )}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>

        {/* ── 左: ビジュアルプレビュー ── */}
        <div>
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>
              レイアウトプレビュー
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>
              エリアをクリックして選択・編集。座標系: 2500 × {lineH} px
            </p>
            <RichMenuPreview
              areas={areas}
              size={size}
              selectedIdx={selectedIdx}
              onAreaClick={setSelectedIdx}
              imageUrl={imageUrl}
              onImgStateChange={setImgLoadState}
            />

            {/* エリア一覧 */}
            <div style={{ marginTop: 16 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 8,
              }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>
                  エリア一覧 ({areas.length})
                </p>
              </div>
              {areas.length === 0 ? (
                <p style={{ fontSize: 12, color: "#9ca3af", padding: "12px 0" }}>
                  テンプレートを選択するか右パネルで追加してください
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {areas.map((area, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedIdx(i)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px",
                        background: selectedIdx === i ? "#E6F7ED" : "#f9fafb",
                        border: `1px solid ${selectedIdx === i ? "#93c5fd" : "#e5e7eb"}`,
                        borderRadius: 8, cursor: "pointer",
                      }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: 3,
                        background: AREA_COLORS[i % AREA_COLORS.length],
                        flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: "#374151" }}>
                          {area.action_label || `エリア ${i + 1}`}
                        </span>
                        <span style={{ color: "#9ca3af", marginLeft: 8, fontSize: 11 }}>
                          {area.x},{area.y} — {area.width}×{area.height}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        background: area.action_type === "message" ? "#E6F7ED" :
                                    area.action_type === "postback" ? "#faf5ff" : "#fff7ed",
                        color:      area.action_type === "message" ? "#3b82f6" :
                                    area.action_type === "postback" ? "#8b5cf6" : "#f97316",
                        padding: "2px 7px", borderRadius: 20,
                      }}>
                        {area.action_type}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAreas((prev) => prev.filter((_, j) => j !== i));
                          if (selectedIdx === i) setSelectedIdx(null);
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#d1d5db", fontSize: 16, padding: 0, lineHeight: 1 }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 右: 設定パネル ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* メニュー基本設定 */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>
              基本設定
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  メニュー名（管理用）
                </span>
                <input
                  type="text"
                  className="input"
                  value={menuName}
                  onChange={(e) => setMenuName(e.target.value)}
                  placeholder="例: メインメニュー"
                  maxLength={100}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  バーテキスト（最大14文字）
                </span>
                <input
                  type="text"
                  className="input"
                  value={chatBarText}
                  onChange={(e) => setChatBarText(e.target.value)}
                  placeholder="メニュー"
                  maxLength={14}
                />
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  トーク画面下部のバーに表示されるテキスト
                </span>
              </label>

              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  メニューサイズ
                </span>
                <select
                  className="input"
                  value={size}
                  onChange={(e) => setSize(e.target.value as RichMenuSize)}
                >
                  <option value="compact">コンパクト (2500×843)</option>
                  <option value="full">フル (2500×1686)</option>
                </select>
              </label>

              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                  背景画像 URL（任意）
                </span>
                <input
                  type="url"
                  className="input"
                  value={imageUrl}
                  onChange={(e) => { setImageUrl(e.target.value); setImgLoadState("idle"); }}
                  placeholder="https://example.com/menu.png"
                  style={imgLoadState === "error" ? { borderColor: "#fca5a5" } : undefined}
                />
                {/* 読み込み状態インジケーター */}
                <div style={{ marginTop: 4, fontSize: 11, minHeight: 16, display: "flex", alignItems: "center", gap: 4 }}>
                  {imgLoadState === "idle" && (
                    <span style={{ color: "#9ca3af" }}>
                      PNG または JPEG。サイズは {size === "full" ? "2500×1686" : "2500×843"}px 推奨
                    </span>
                  )}
                  {imgLoadState === "loading" && (
                    <span style={{ color: "#6b7280", display: "flex", alignItems: "center", gap: 4 }}>
                      <span className="spinner" style={{ width: 10, height: 10, borderWidth: 2 }} />
                      画像を読み込み中…
                    </span>
                  )}
                  {imgLoadState === "success" && (
                    <span style={{ color: "#15803d" }}>
                      画像を確認できました（左のプレビューに反映）
                    </span>
                  )}
                  {imgLoadState === "error" && (
                    <span style={{ color: "#dc2626" }}>
                      ❌ 画像を読み込めません。URL が画像ファイルを直接指しているか確認してください
                    </span>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* テンプレート */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 10 }}>
              テンプレート
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>
              選択するとエリアが自動設定されます（現在の設定は上書き）
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => applyTemplate(tpl)}
                  style={{
                    padding: "10px 8px",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8, cursor: "pointer",
                    fontSize: 13, fontWeight: 600, color: "#374151",
                    textAlign: "center",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#E6F7ED")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#f9fafb")}
                >
                  <div style={{ fontSize: 18, marginBottom: 3 }}>{tpl.icon}</div>
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* 選択エリアの設定 */}
          {selectedArea !== null && selectedIdx !== null && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: "#374151" }}>
                  <span style={{
                    display: "inline-block",
                    width: 12, height: 12, borderRadius: 2,
                    background: AREA_COLORS[selectedIdx % AREA_COLORS.length],
                    marginRight: 6, verticalAlign: "middle",
                  }} />
                  エリア {selectedIdx + 1} 設定
                </p>
                <button
                  onClick={() => {
                    setAreas((prev) => prev.filter((_, j) => j !== selectedIdx));
                    setSelectedIdx(null);
                  }}
                  style={{ background: "none", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer", color: "#ef4444", fontSize: 12, padding: "3px 8px" }}
                >
                  削除
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
                {/* 座標・サイズ */}
                <div>
                  <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                    位置・サイズ（LINE 座標系 2500×{lineH}px）
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(["x","y","width","height"] as const).map((field) => (
                      <label key={field}>
                        <span style={{ color: "#6b7280", display: "block", marginBottom: 2 }}>{field}</span>
                        <input
                          type="number"
                          className="input"
                          style={{ fontSize: 13 }}
                          value={selectedArea[field]}
                          min={0}
                          onChange={(e) => updateArea(selectedIdx, { [field]: Number(e.target.value) })}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* アクションタイプ */}
                <label>
                  <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                    アクションタイプ
                  </span>
                  <select
                    className="input"
                    value={selectedArea.action_type}
                    onChange={(e) => updateArea(selectedIdx, { action_type: e.target.value as ActionType })}
                  >
                    <option value="message">message — テキストを送信</option>
                    <option value="postback">postback — Webhook に送信</option>
                    <option value="uri">uri — URL を開く</option>
                  </select>
                </label>

                {/* ラベル */}
                <label>
                  <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                    ボタンラベル（最大20文字）
                  </span>
                  <input
                    type="text"
                    className="input"
                    value={selectedArea.action_label}
                    onChange={(e) => updateArea(selectedIdx, { action_label: e.target.value })}
                    placeholder="例: はじめる"
                    maxLength={20}
                  />
                </label>

                {/* action_type ごとのフィールド */}
                {selectedArea.action_type === "message" && (
                  <label>
                    <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                      送信テキスト
                    </span>
                    <input
                      type="text"
                      className="input"
                      value={selectedArea.action_text}
                      onChange={(e) => updateArea(selectedIdx, { action_text: e.target.value })}
                      placeholder="例: はじめる"
                      maxLength={300}
                    />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      タップ時にユーザーがチャットに送信するテキスト
                    </span>
                  </label>
                )}

                {selectedArea.action_type === "postback" && (
                  <>
                    <label>
                      <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                        postback data
                      </span>
                      <input
                        type="text"
                        className="input"
                        value={selectedArea.action_data}
                        onChange={(e) => updateArea(selectedIdx, { action_data: e.target.value })}
                        placeholder="例: ACTION:START"
                        maxLength={300}
                      />
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        Webhook に送信される data 文字列
                      </span>
                    </label>
                    <label>
                      <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                        displayText（任意）
                      </span>
                      <input
                        type="text"
                        className="input"
                        value={selectedArea.action_text}
                        onChange={(e) => updateArea(selectedIdx, { action_text: e.target.value })}
                        placeholder="例: はじめる"
                        maxLength={300}
                      />
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        タップ時にチャットに表示されるテキスト（省略可）
                      </span>
                    </label>
                  </>
                )}

                {selectedArea.action_type === "uri" && (
                  <div>
                    <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                      タップ時の遷移先
                    </span>

                    {/* モード切替（保存済み遷移先を推奨・左に配置） */}
                    <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 8, padding: 2, marginBottom: 8 }}>
                      <button type="button"
                        onClick={() => updateArea(selectedIdx, { destination_id: "__select__" })}
                        style={{
                          flex: 1, padding: "6px 0", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer",
                          background: selectedArea.destination_id ? "#fff" : "transparent",
                          color: selectedArea.destination_id ? "#111" : "#6b7280",
                          boxShadow: selectedArea.destination_id ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                        }}>
                        保存済みの遷移先を使う
                      </button>
                      <button type="button"
                        onClick={() => updateArea(selectedIdx, { destination_id: "", action_uri: selectedArea.action_uri })}
                        style={{
                          flex: 1, padding: "6px 0", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer",
                          background: !selectedArea.destination_id ? "#fff" : "transparent",
                          color: !selectedArea.destination_id ? "#111" : "#6b7280",
                          boxShadow: !selectedArea.destination_id ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                        }}>
                        URLを直接入力
                      </button>
                    </div>

                    {selectedArea.destination_id ? (
                      <RichMenuDestinationSelect
                        oaId={oaId}
                        value={selectedArea.destination_id === "__select__" ? "" : selectedArea.destination_id}
                        onChange={(destId, resolvedUrl) => {
                          updateArea(selectedIdx, {
                            destination_id: destId || "",
                            action_uri: resolvedUrl || selectedArea.action_uri,
                          });
                        }}
                      />
                    ) : (
                      <>
                        <input
                          type="url"
                          className="input"
                          value={selectedArea.action_uri}
                          onChange={(e) => updateArea(selectedIdx, { action_uri: e.target.value })}
                          placeholder="https://example.com"
                          maxLength={1000}
                        />
                        <span style={{ fontSize: 10, color: "#9ca3af" }}>
                          一時的にURLを直接指定したい場合に使います
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* エリア追加 */}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={() => {
              const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;
              const newArea: AreaDraft = {
                x: 0, y: 0, width: 500, height: H,
                action_type:    "message",
                action_label:   `ボタン${areas.length + 1}`,
                action_text:    `ボタン${areas.length + 1}`,
                action_data:    "",
                action_uri:     "",
                destination_id: "",
                sort_order:     areas.length,
              };
              setAreas((prev) => [...prev, newArea]);
              setSelectedIdx(areas.length);
              setValidationErrors([]);
            }}
          >
            + エリアを追加
          </button>

          {/* ── バリデーションエラー一覧 ── */}
          {validationErrors.length > 0 && (
            <div
              id="validation-errors"
              style={{
                border:       "1px solid #fca5a5",
                borderRadius: 10,
                background:   "#fff1f2",
                padding:      "14px 16px",
              }}
            >
              {/* ヘッダー */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>❌</span>
                <p style={{ fontWeight: 700, fontSize: 13, color: "#991b1b" }}>
                  適用前に {validationErrors.length} 件の問題を解決してください
                </p>
              </div>

              {/* エラーリスト */}
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {validationErrors.map((err, i) => (
                  <li
                    key={i}
                    style={{
                      display:    "flex",
                      alignItems: "flex-start",
                      gap:        8,
                      fontSize:   12,
                      color:      "#7f1d1d",
                      lineHeight: 1.5,
                    }}
                  >
                    {/* エリアインデックスバッジ */}
                    {err.areaIndex !== undefined ? (
                      <span
                        onClick={() => setSelectedIdx(err.areaIndex!)}
                        style={{
                          flexShrink:   0,
                          background:   AREA_COLORS[err.areaIndex % AREA_COLORS.length],
                          color:        "#fff",
                          borderRadius: 20,
                          fontSize:     10,
                          fontWeight:   700,
                          padding:      "1px 7px",
                          cursor:       "pointer",
                          whiteSpace:   "nowrap",
                        }}
                        title="クリックしてエリアを選択"
                      >
                        エリア {err.areaIndex + 1}
                      </span>
                    ) : (
                      <span style={{ flexShrink: 0, color: "#dc2626", fontSize: 13 }}>•</span>
                    )}
                    <span>{err.message}</span>
                  </li>
                ))}
              </ul>

              {/* 解除ボタン */}
              <button
                onClick={() => setValidationErrors([])}
                style={{
                  marginTop:    12,
                  background:   "none",
                  border:       "1px solid #fca5a5",
                  borderRadius: 6,
                  cursor:       "pointer",
                  fontSize:     11,
                  color:        "#991b1b",
                  padding:      "3px 10px",
                }}
              >
                一覧を閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────
// リッチメニュープレビューコンポーネント
// ────────────────────────────────────────────────

/** 背景画像の読み込み状態 */
type ImgLoadState = "idle" | "loading" | "success" | "error";

/**
 * リッチメニューのビジュアルプレビュー。
 *
 * 描画レイヤー（下 → 上）:
 *   1. フォールバック背景（グレー）
 *   2. 背景画像 <img>（URL あり時）
 *   3. ローディングシマー（loading 時）
 *   4. full サイズ中央区切り線
 *   5. エリアオーバーレイ群（クリックで選択）
 *   6. 空エリア案内テキスト
 *   7. 画像エラーバッジ（最前面）
 */
function RichMenuPreview({
  areas, size, selectedIdx, onAreaClick, imageUrl, onImgStateChange,
}: {
  areas:              AreaDraft[];
  size:               "full" | "compact";
  selectedIdx:        number | null;
  onAreaClick:        (idx: number) => void;
  /** プレビューに表示する背景画像 URL（省略可） */
  imageUrl?:          string;
  /** 画像読み込み状態が変化したときに親へ通知するコールバック */
  onImgStateChange?:  (state: ImgLoadState) => void;
}) {
  const W = LINE_W;
  const H = size === "full" ? LINE_H_FULL : LINE_H_COMPACT;

  // プレビュー表示サイズ（2500px 原寸に対するスケール比）
  const previewW = 580;
  const previewH = Math.round((H / W) * previewW);
  const scale    = previewW / W;

  // 画像読み込み状態（3 状態: idle / loading / success / error）
  const [imgState,    setImgState]    = useState<ImgLoadState>("idle");
  // デバウンス後の確定 URL（入力中の部分URLへのリクエストを抑制）
  const [currentUrl,  setCurrentUrl]  = useState<string>("");

  // imageUrl prop が変わったら 400ms デバウンスで currentUrl を更新
  useEffect(() => {
    const url = imageUrl?.trim() ?? "";
    if (!url) {
      setCurrentUrl("");
      const next: ImgLoadState = "idle";
      setImgState(next);
      onImgStateChange?.(next);
      return;
    }
    // 入力途中のフラッシュを抑えるため、少し待ってから URL を確定させる
    const timer = setTimeout(() => {
      setCurrentUrl(url);
      const next: ImgLoadState = "loading";
      setImgState(next);
      onImgStateChange?.(next);
    }, 400);
    return () => clearTimeout(timer);
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleImgLoad() {
    setImgState("success");
    onImgStateChange?.("success");
  }
  function handleImgError() {
    setImgState("error");
    onImgStateChange?.("error");
  }

  return (
    <div style={{
      width:        previewW,
      height:       previewH,
      position:     "relative",
      // 背景画像未設定・ローディング中・エラー時はグレーを見せる
      background:   "#c9d3dd",
      border:       "2px solid #d1d5db",
      borderRadius: 10,
      overflow:     "hidden",
      userSelect:   "none",
    }}>

      {/* ── レイヤー 2: 背景画像 ── */}
      {/* URL がある間は常にマウント（onLoad/onError を受け取るため） */}
      {currentUrl && (
        <img
          src={currentUrl}
          alt=""
          draggable={false}
          onLoad={handleImgLoad}
          onError={handleImgError}
          style={{
            position:   "absolute",
            inset:      0,
            width:      "100%",
            height:     "100%",
            objectFit:  "fill",   // 推奨サイズ通りの画像を想定するため fill
            // ロード完了前は非表示（グレー背景を見せる）
            visibility: imgState === "success" ? "visible" : "hidden",
            zIndex:     1,
          }}
        />
      )}

      {/* ── レイヤー 3: ローディングシマー ── */}
      {imgState === "loading" && (
        <div style={{
          position:   "absolute",
          inset:      0,
          zIndex:     2,
          background: "linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)",
          backgroundSize: "200% 100%",
          animation:  "shimmer 1.4s infinite",
          display:    "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>
            画像を読み込み中…
          </span>
          {/* shimmer アニメーション定義 */}
          <style>{`
            @keyframes shimmer {
              0%   { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
          `}</style>
        </div>
      )}

      {/* ── レイヤー 4: full サイズ中央区切り線 ── */}
      {size === "full" && (
        <div style={{
          position:      "absolute",
          left: 0, right: 0,
          top:           previewH / 2,
          height:        1,
          background:    "rgba(255,255,255,0.5)",
          pointerEvents: "none",
          zIndex:        3,
        }} />
      )}

      {/* ── レイヤー 5: エリアオーバーレイ ── */}
      {areas.map((area, i) => (
        <div
          key={i}
          onClick={() => onAreaClick(i)}
          style={{
            position:       "absolute",
            left:           area.x      * scale,
            top:            area.y      * scale,
            width:          area.width  * scale,
            height:         area.height * scale,
            // 背景画像あり時は透過度を上げてラベルが読めるようにする
            background:     AREA_COLORS[i % AREA_COLORS.length] +
                              (selectedIdx === i
                                ? (imgState === "success" ? "99" : "cc")
                                : (imgState === "success" ? "44" : "88")),
            border:         `${selectedIdx === i ? 3 : 1}px solid ${AREA_COLORS[i % AREA_COLORS.length]}`,
            boxSizing:      "border-box",
            cursor:         "pointer",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexDirection:  "column",
            gap:            3,
            zIndex:         selectedIdx === i ? 5 : 4,
            boxShadow:      selectedIdx === i ? "0 0 0 2px #fff inset" : "none",
          }}
        >
          <span style={{
            fontSize:   Math.max(10, Math.min(16, area.width * scale * 0.12)),
            fontWeight: 700,
            color:      "#fff",
            // 背景画像上でも読めるよう影を強める
            textShadow: "0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)",
            textAlign:  "center",
            padding:    "0 4px",
            overflow:   "hidden",
            maxWidth:   "100%",
            wordBreak:  "break-all",
          }}>
            {area.action_label || `エリア ${i + 1}`}
          </span>
          <span style={{
            fontSize:   9,
            color:      "rgba(255,255,255,0.95)",
            textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          }}>
            {area.action_type}
          </span>
        </div>
      ))}

      {/* ── レイヤー 6: 空エリア案内 ── */}
      {areas.length === 0 && imgState !== "loading" && (
        <div style={{
          position:  "absolute", inset: 0,
          display:   "flex", alignItems: "center", justifyContent: "center",
          color:     imgState === "success" ? "rgba(255,255,255,0.9)" : "#9ca3af",
          fontSize:  13,
          fontWeight: 600,
          textShadow: imgState === "success" ? "0 1px 4px rgba(0,0,0,0.7)" : "none",
          zIndex:    4,
        }}>
          テンプレートを選択するかエリアを追加してください
        </div>
      )}

      {/* ── レイヤー 7: 画像エラーバッジ（最前面）── */}
      {imgState === "error" && (
        <div style={{
          position:      "absolute",
          bottom:        8,
          left:          "50%",
          transform:     "translateX(-50%)",
          zIndex:        6,
          pointerEvents: "none",
          display:       "flex",
          flexDirection: "column",
          alignItems:    "center",
          gap:           4,
        }}>
          <span style={{
            background:   "rgba(153, 27, 27, 0.88)",
            color:        "#fff",
            fontSize:     10,
            fontWeight:   700,
            padding:      "4px 12px",
            borderRadius: 20,
            whiteSpace:   "nowrap",
          }}>
            🚫 背景画像を表示できません
          </span>
          <span style={{
            background:   "rgba(0,0,0,0.55)",
            color:        "#fecaca",
            fontSize:     9,
            padding:      "2px 10px",
            borderRadius: 20,
            whiteSpace:   "nowrap",
          }}>
            URL が画像ファイルを直接指しているか確認してください
          </span>
        </div>
      )}
    </div>
  );
}
