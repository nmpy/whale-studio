# LINE Push 送信失敗の可観測性 / トラブルシュート

## 背景

LINE への複数メッセージ送信 (`replyWithLagToLine`) は次の構成:

- **1通目**: Reply API (`replyToLine`) — replyToken 使用。**無料・月間上限にカウントされない**。
- **2通目以降**: Push API (`pushToLine`) — userId 宛。**月間メッセージ通数にカウントされる**。

`pushToLine` は失敗しても **throw せず** `{ ok: false, status }` を返すだけ（呼出側の後方互換のため）。
そのため push が失敗しても **webhook は 200 で返り**、作者/管理者からは「**1通目だけ届いて止まった**」ように見える。

代表的な症状: **チェーンの1通目だけ届き、2通目以降が届かない**。
→ DB chain や `buildMessageChain` が正しくても、**push 送信自体が失敗**しているケース。最有力は **LINE OA の月間 push 上限超過**（検証で連続メッセージを多数送ると無料枠は早く尽きる）。

## 確認できる構造化ログ（PII・本文なし）

| ログ名 | 出所 | 内容 |
|---|---|---|
| `[line:push:failed]` | `pushToLine` | `{ userId(先頭8), count, status, lineMessage }`（または network 時 `error`）。`lineMessage` は LINE API のエラーメッセージ（例: `You have reached your monthly limit.`） |
| `[line:reply-lag:summary]` | `replyWithLagToLine` | `{ replyOk, pushTotal, pushOk, pushFail, failures:[{idx,msgId,status}] }`。1送信あたりの reply/push 成否サマリ |
| `[line:delivery:final-order]` | `reply/push` 直前 | `{ route, count, messageIds, types }` 最終送信順 |
| `[line:chain:expanded]` | `buildMessageChain` | `{ rootMessageId, messageIds, sortOrders, nextMessageIds }` chain 展開結果 |

### 切り分け早見表

- `[line:chain:expanded]` の `messageIds` が **期待通りの通数**（例: 3通）なのに実機が1通
  → **push 失敗**。`[line:reply-lag:summary]` の `pushFail>0` と `[line:push:failed]` の `status`/`lineMessage` を確認。
  - `lineMessage` が monthly limit 系 → **月間 push 上限超過**（運用対応: 月初リセット待ち / プラン上限引上げ / 検証用 OA 分離 / テスト時の連続通数を減らす）。
  - `status=401/403` → channel access token / 権限。
  - `status=400` + userId 系 → 宛先 userId 不正。
- `[line:chain:expanded]` の `messageIds` が **1通だけ**
  → build/データ側。`nextMessageId` 配線・`freeInputEnabled`（=自由入力プロンプトで chain 停止）を確認。

## LINE Official Account Manager 側の確認

- LINE Official Account Manager → 分析 / 利用状況 → **当月のメッセージ通数と上限**。
- 上限到達時は **Reply は届くが Push だけ失敗**するため、本ドキュメントの症状と一致する。

## Vercel ログの引き方

- Vercel Dashboard → 該当 deployment → Runtime Logs → 送信時刻付近の `/api/line/<oaId>/webhook` を開く。
- 上表のログ名で絞り込み、`[line:push:failed]` の `status` / `lineMessage` を確認する。
- ※ ログ閲覧ツールによっては JSON が省略表示されることがあるため、**ダッシュボードで全文**を確認するのが確実。
