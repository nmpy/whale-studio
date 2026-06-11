# メッセージ「まとめ送信」廃止方針（設計メモ）

> ステータス: **Phase 1 着手**（誤解防止文言・回帰テスト・本メモ）。送信挙動の変更は Phase 2 以降。
> 関連: `src/lib/line.ts`（`replyWithLagToLine` / `buildMessageChain` / `buildPhaseMessages` / `buildKeywordMessages`）、`src/app/api/line/[oaId]/webhook/route.ts`

## 背景・課題

LINE Reply API は 1 リクエストに最大 5 件の message を含められる（同時着）。Whale Studio は
これを使って複数メッセージを「まとめて」自動送信している。しかしこの方式には次の問題がある:

- **Reply 一括では message 間に「待機時間・入力中表示」を挟めない**（全件ほぼ同時着）。
- 制作者画面では各メッセージに演出を設定できるように見えるため、**2 通目以降にも演出が効くと誤解しやすい**。
- 実際には 1 通目送信前にしか演出が反映されず、プロダクト仕様として分かりにくい。
- Push 送信に切り替えれば per-message 演出は可能だが、**LINE 公式アカウントの月間メッセージ通数を消費**するためデフォルトにはできない。

→ 今後は「メッセージの塊をまとめて送る」のではなく、**「1 メッセージ = 1 ユーザー操作に対する 1 返信」**へ寄せる。

## 現状: まとめ送信が発生している 3 層

| 層 | 関数 | 内容 |
|---|---|---|
| A. チェーン自動送信 | `buildMessageChain(msg)` | `nextMessageId` を最大5件まで自動で辿って連結（freeInput で停止）。自由入力応答 / QR response / QR target_message / キーワード応答で使用。 |
| B. フェーズ入場の複数 head 一斉送信 | `buildPhaseMessages(phase)` | next 非参照の entry head を**全て**送る（各 head は A を内包）。フェーズ遷移 / QR target_phase / puzzle 正解 / 復帰で使用。 |
| C. キーワード / start の複数レコード送信 | `buildKeywordMessages(records)` | 複数マッチ / 複数 start メッセージを一括変換。 |

### 共通チョークポイント
A/B/C が生成した `LineMessage[]` は最終的に **`replyWithLagToLine`（`src/lib/line.ts`）** へ流れる:

- **5 件以内: 1 回の Reply にまとめて送信（`reply_all`）** ← Push 通数を消費しない・確実に届く。
  - ただし **Reply 一括のため 2 通目以降の待機/入力中/loading は反映されない**（演出は 1 通目のみ）。
- **6 件以上: 先頭 5 件を Reply + 6 件目以降を Push（`reply_first_5_push_rest`）** ← **既存仕様**。
  - ⚠️ **6 通目以降の Push は LINE 公式アカウントの月間メッセージ通数を消費する可能性がある**（月間上限超過時は届かないことがある）。これは現状の既存挙動であり Phase 1 では変更しない。
- 非 webhook 経路: `src/app/api/liff/qr/complete/route.ts` は QR 完了時に `pushToLine` で複数 Push（別経路）。

## 今後の基本方針

1. **1 メッセージ = 1 ユーザー操作に対する 1 返信**へ寄せる。各メッセージ送信前に、そのメッセージ自身の待機/入力中を反映する。
2. **複数メッセージを自動で連続送信しない**（`nextMessageId` は「自動送信」ではなく「遷移候補」として扱う）。
3. 次メッセージへ進むには **明示トリガー**を必須にする: Quick Reply / キーワード / QR / GPS / 自由入力 / 画像タップ など。

## 段階移行

- **Phase 1（本メモの範囲・挙動非変更）**
  - per-message 自動 Push 化（旧 PR #252）は **採用しない**（close 済み・superseded）。
  - 管理画面に誤解防止文言を追加（演出は「送信前」にのみ反映 / 旧チェーンは廃止予定 / 6通以上は Push 通数消費の可能性）。
  - 「演出ありチェーンでも 5 件以内は自動 Push されない（Reply 一括のまま）」を回帰テストで固定。
- **Phase 2（送信単位の変更・feature flag 付き）**
  - `buildMessageChain` を **head-only モード**へ（flag 切替）。`replyWithLagToLine` の「まとめ Reply」を段階廃止し「1 メッセージ = 1 Reply」へ。
  - 次メッセージへの遷移条件（Quick Reply/keyword/QR/GPS/自由入力）を各メッセージに設定する UI。
  - テスト: デフォルト Push 0 / 1 アクション = 1 Reply / 各メッセージの lag・loading が送信前に反映 / 次メッセージはユーザー操作まで自動送信されない。
- **Phase 3（既存チェーン移行）**
  - 旧チェーン（`nextMessageId` 連結）の移行導線・警告（B案: 自動付与せず警告のみ）。
  - 「次へ」Quick Reply 等の遷移設定補助。

## 破壊的変更をしない理由（重要）

既存作品は `nextMessageId` チェーンに依存している。特に **ending 本線（例: A→B の5通チェーン、QR target_message で E→D… と接続）**はチェーン自動送信を前提に整形済み。head-only 化を即時・無条件で行うと、これらの 2 通目以降が送られなくなる。

→ **Phase 2 の head-only 化は feature flag 付き**で導入し、デフォルトは現状維持。既存作品への影響を確認しながら段階的に移行する。
