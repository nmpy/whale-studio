"use client";

// src/components/destination/LinkPicker.tsx
//
// メッセージ編集画面の URL 入力補助（ノーコード制作者向け）。
// - LinkPicker: LIFF URL / ロケーションURL の候補から選ぶとURL文字列を onPick で返すドロップダウン。
//   既存の URL 入力欄（TapDestinationSection の直接URL入力 / 画像アクションURL）に併設して使う。
//   「選択」自体は保存しない。選んだ結果の URL 文字列だけが既存フィールドへ入る（payload 不変）。
// - LinkCopyList: Flex Message 用。候補URLを一覧表示し、各行をクリップボードへコピーできる。
//   Flex JSON は自動変更しない（制作者が手動で貼り付ける想定）。
// - useWorkLinkOptions: 既存 API（fetchOaLiffId / locationApi.list）と既存ビルダー
//   （buildLiffUrl / buildLiffCheckinUrl）だけで候補を生成するフック。新 API は追加しない。

import { useEffect, useState } from "react";
import { getDevToken, fetchOaLiffId, locationApi } from "@/lib/api-client";
import { buildLiffUrl, buildLiffCheckinUrl } from "@/lib/liff/config";

export type LinkOptionGroup = "LIFF URL" | "ロケーションURL";

export type LinkOption = {
  label: string;
  url:   string;
  group: LinkOptionGroup;
};

const GROUP_ORDER: LinkOptionGroup[] = ["LIFF URL", "ロケーションURL"];

/**
 * 作品トップ LIFF URL + 各ロケーションのチェックインURL を、既存関数だけで生成する。
 * liffId が未設定（OA.liffId 無し）の場合は LIFF 由来の URL を作れないため空配列を返す。
 */
export function useWorkLinkOptions(oaId: string | undefined, workId: string): {
  options: LinkOption[];
  liffConfigured: boolean;
  loading: boolean;
} {
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [liffConfigured, setLiffConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = getDevToken();
        // liffId は URL 生成専用に OA.liffId を取得（env fallback なし）。失敗/未設定なら null。
        const [liffId, locations] = await Promise.all([
          oaId ? fetchOaLiffId(oaId) : Promise.resolve(null),
          locationApi.list(token, workId, { is_active: true }).catch(() => []),
        ]);
        if (cancelled) return;

        const opts: LinkOption[] = [];

        // 作品トップ LIFF（/liff/work/[workId] ルートへ liff.state で確実に復元）。
        const workTop = buildLiffUrl({ liffId, query: { "liff.state": `/liff/work/${workId}` } });
        if (workTop) opts.push({ label: "作品トップ LIFF", url: workTop, group: "LIFF URL" });

        // 各ロケーションのチェックインURL（QR/GPS チェックインと同一）。
        for (const loc of locations) {
          const url = buildLiffCheckinUrl({ liffId, workId, locationId: loc.id });
          if (url) opts.push({ label: `チェックイン: ${loc.name || loc.id.slice(0, 8)}`, url, group: "ロケーションURL" });
        }

        setLiffConfigured(!!liffId);
        setOptions(opts);
      } catch {
        if (!cancelled) { setOptions([]); setLiffConfigured(false); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [oaId, workId]);

  return { options, liffConfigured, loading };
}

function groupOptions(options: LinkOption[]): [LinkOptionGroup, LinkOption[]][] {
  return GROUP_ORDER
    .map((g) => [g, options.filter((o) => o.group === g)] as [LinkOptionGroup, LinkOption[]])
    .filter(([, list]) => list.length > 0);
}

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 8,
  fontSize: 12, color: "#374151", background: "#fff", outline: "none",
};

/**
 * URL候補ドロップダウン。候補を選ぶと onPick(url) を呼ぶ（選択値自体は保持しない）。
 * 候補が無い場合は LIFF 未設定の案内を出すか、何も描画しない（compact 時）。
 */
export function LinkPicker({
  options, liffConfigured, onPick, disabled, label = "URLを選択",
}: {
  options: LinkOption[];
  liffConfigured?: boolean;
  onPick: (url: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const grouped = groupOptions(options);

  if (grouped.length === 0) {
    // 候補ゼロ。LIFF 未設定が原因のときだけ控えめに理由を出す（手入力は引き続き可能）。
    return liffConfigured === false ? (
      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
        LIFF URL / ロケーションURL の候補は、OA の LIFF ID とロケーションを設定すると表示されます。手入力は引き続き可能です。
      </p>
    ) : null;
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <select
        aria-label={label}
        disabled={disabled}
        value=""
        onChange={(e) => { if (e.target.value) onPick(e.target.value); e.currentTarget.selectedIndex = 0; }}
        style={selectStyle}
      >
        <option value="">{label}（LIFF / ロケーションURLから選ぶ）</option>
        {grouped.map(([group, list]) => (
          <optgroup key={group} label={group}>
            {list.map((o) => (
              <option key={`${group}:${o.url}`} value={o.url}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
        LIFF画面やチェックインURLを選んで入力できます。手入力で編集もできます。
      </p>
    </div>
  );
}

/**
 * Flex Message 用のコピー補助。候補URLを一覧表示し、行クリックでクリップボードへコピーする。
 * Flex JSON 自体は変更しない（制作者が JSON 内へ貼り付ける）。
 */
export function LinkCopyList({
  options, liffConfigured,
}: {
  options: LinkOption[];
  liffConfigured?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const grouped = groupOptions(options);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setCopied(null);
    }
  }

  if (grouped.length === 0) {
    return (
      <p style={{ fontSize: 11, color: "#9ca3af" }}>
        {liffConfigured === false
          ? "コピーできる候補がありません。OA の LIFF ID とロケーションを設定すると表示されます。"
          : "コピーできる候補がありません。"}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 11, color: "#6b7280", margin: 0, lineHeight: 1.7 }}>
        Flex Message の JSON 内で URL を指定したい場合は、下の候補から URL をコピーして貼り付けてください。
        Flex Message の JSON 構造は自動変更しません。
      </p>
      {grouped.map(([group, list]) => (
        <div key={group}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>{group}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {list.map((o) => (
              <li key={`${group}:${o.url}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => copy(o.url)}
                  style={{
                    flex: "none", padding: "3px 10px", fontSize: 11, fontWeight: 600,
                    color: copied === o.url ? "#15803d" : "#2563eb",
                    background: copied === o.url ? "#f0fdf4" : "#eff6ff",
                    border: `1px solid ${copied === o.url ? "#bbf7d0" : "#bfdbfe"}`,
                    borderRadius: 6, cursor: "pointer",
                  }}
                >
                  {copied === o.url ? "コピー済" : "コピー"}
                </button>
                <span style={{ fontSize: 12, color: "#374151", minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{o.label}</span>
                  <span style={{ color: "#9ca3af", marginLeft: 6, wordBreak: "break-all" }}>{o.url}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
