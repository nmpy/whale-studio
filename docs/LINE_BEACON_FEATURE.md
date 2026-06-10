# LINE Beacon 運用手順

Whale Studio の LINE Beacon 連動（webhook `beacon` event → HWID に紐づくメッセージ自動送信）の
運用手順。MVP では **enter のみ**対応（日本では banner / stay の新規利用が難しいため）。

> 前提: LINE Beacon 連動は **Pro Max（= pro 相当 / `FEATURE.location`）機能**です。
> プラン未満の場合は管理 API / webhook 送信ともにガードされます。

## 1. LINE 側でビーコンを OA にリンクする

1. LINE Official Account Manager（または LINE Developers）でビーコンを対象 OA に登録する。
2. 発行・確認した **HWID**（LINE Simple Beacon は 10 桁 hex 想定）を控える。
   - 1 つのビーコンは **1 つの OA にのみ**紐づけられます。

## 2. Whale Studio にビーコン設定を登録する

管理画面 → 作品 → ロケーション管理の「ビーコン」タブ（または `/oas/[oaId]/works/[workId]/beacons`）で登録:

- **ビーコン名** / **HWID**（大文字小文字は区別しません。保存時に正規化）
- **発火イベント**: `enter`（MVP 推奨）
- **再発火防止時間（cooldown）**: 同一ユーザー・同一ビーコンの連続通知を抑制
- **発火時アクション**:
  - **登録済みメッセージを送信**（`action_type="message"`）: 同一作品のメッセージを選択。
    lag_ms / 「入力中…」/ 既読 / クイックリプライ / チェーン送信など通常メッセージと同じ演出で送信されます。
  - テキストメッセージを送信 / 遷移先 URL を送信 / ログのみ

制約:
- HWID は同一 OA 内で重複不可。
- 選択するメッセージは**同一作品**のメッセージのみ。

## 3. ユーザー側の確認事項

- 対象 OA を**友だち追加**している
- **Bluetooth ON**
- LINE 設定 > プライバシー管理 > **LINE Beacon を ON**
- 最新版 LINE 推奨

## 4. 実機確認手順

1. ビーコンの電源を ON にする
2. 端末をビーコンに近づける（受信圏に入る）
3. LINE webhook に `beacon`（type=enter）event が届く
4. Vercel ログ（`[LINE Beacon]` prefix）で結果を確認:
   - `[LINE Beacon] received` — 受信
   - `[LINE Beacon] sent` — 送信成功
   - `[LINE Beacon] unknown_beacon` — 設定が無い HWID（運用上重要）
   - `[LINE Beacon] suppressed_cooldown` — cooldown 内のため送信抑制
   - `[LINE Beacon] message_not_configured` — メッセージ未設定
   - `[LINE Beacon] service_stopped` / `plan_blocked` / `failed`
5. `BeaconEventLog`（`beacon_event_logs`）に `actionStatus` 付きで記録されます。

## 5. 挙動仕様（webhook `handleBeaconEvent`）

順に判定し、各段階で `BeaconEventLog` を記録:
1. `webhookEventId` 重複 → ignored（二重実行防止）
2. HWID 正規化失敗 → ignored
3. `(oaId, hwid)` で trigger 検索 → 無ければ **unknown_beacon**
4. `enabled=false` → ignored
5. OA 停止中（`serviceSuspendedAt`）→ **service_stopped**（送信しない）
6. プラン未満 → **plan_blocked**（送信しない）
7. `eventTypes` に `enter` が含まれない type → ignored
8. cooldown 内に同一ユーザーの sent 済み → **cooldown**（suppressed）
9. `action_type="message"` で messageId 未設定/解決不能 → **message_not_configured**
10. 条件を満たせば `replyToken` で reply（無ければ push）→ **sent** / 失敗時 **failed**

## 注意

- 1 つのビーコンは 1 つの OA にしか紐づけられません。
- 日本では MVP として **enter のみ**対応。
- 同一ユーザーへの連続通知を避けるため **cooldown を必ず設定**してください。
- DB スキーマ変更は不要（既存 `BeaconTrigger` / `BeaconEventLog` + `actionPayload` JSON に messageId を格納）。
