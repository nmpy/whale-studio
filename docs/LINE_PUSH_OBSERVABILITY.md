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

## 送信戦略と Reply 5件上限（重要）

`replyWithLagToLine` の送信戦略:

| 件数 | strategy | reply | push |
|---|---|---|---|
| **≤5** | `reply_all` | 全件（1リクエスト） | 0（Push 不使用＝月間通数を消費しない・確実に届く） |
| **>5** | `reply_first_5_push_rest`（`reason="line_reply_limit_5"`） | 先頭5件 | 6件目以降 |

- **LINE Reply API は 1 回最大 5 件**。`replyToken` は 1 回限りだが、その 1 回で 5 件まで送れる。
- **Reply は月間メッセージ通数にカウントされない**。**Push はカウントされる**。
- そのため **5 件以内は Reply 一括**で送り、Push 通数を消費しない（Push 上限超過中でも届く）。
- **6 件以上**は LINE 仕様上 6 件目以降を **Push** にせざるを得ない。Push 上限到達時は **6 件目以降が届かない**（`[line:reply-lag:summary]` が `strategy=reply_first_5_push_rest` / `[line:push:failed]` が `status=429 monthly limit`）。

### 単一チェーンが 5 件超のとき（さらに注意）

`buildMessageChain` / `buildPhaseMessages` は **1 チェーンを 5 件で打ち切る**。そのため**単一チェーンが 6 件以上ある場合、6 件目以降は Push ですらなく無言で消える**。チェーンは 5 件以内推奨。管理画面の連続メッセージバッジは実チェーン長を「合計N通（このメッセージを含む）」で表示し、5 件超は警告を出す。

### 演出（lag / typing / loading）のトレードオフ

- **Reply 一括（≤5）では、メッセージ間の lag / 2 通目以降の typing / loading は再現できない**（LINE 仕様上、1 reply 内のメッセージ間に個別待機を挟めないため）。全件ほぼ同時着になる。
- **演出を効かせるには Push（時間差送信）が必要**だが、Push は月間通数を消費し、上限超過時に届かない。
- 現状は **配信確実性を優先**（届かない / 1通目だけ届いて止まる方が致命的）。
- 制作上は **1 回の送信を 5 通以内に分ける**（途中に QR / 入力 / フェーズ遷移を挟む）のが安全。
- 将来案: 作品 / チェーン単位で「安定優先（Reply一括）/ 演出優先（Reply+Push分割）」を選べる送信モード（別途設計）。
