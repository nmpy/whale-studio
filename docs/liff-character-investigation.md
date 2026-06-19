# LIFF Character Investigation

> PR-CR0 — 調査専用。コード挙動 / DB / API / CMS / migration の変更は一切なし（本 markdown の追加のみ）。
> base: `main` @ `e126e06`（PR #397 反映済み）。

## Summary

Character まわりには **2 つの別々の表示面**があり、現状どちらも「プレイヤーが出会ったキャラ」という概念は持っていない。

1. **`page_type="character"` ページ → `CharacterRenderer`**
   - 実体は「ブロック合成ページ」（heading / text / image / accordion などを並べるだけ）。
   - ファイル冒頭コメント通り **キャラクターデータ連携は未着手**。`character_list`/`n` ブロックも処理しない。
   - 空状態は `🎭 キャラクター情報はまだ登録されていません`。
2. **`n`（= `character_list`）ブロック → `renderers/CharacterListBlock.tsx`**
   - default / hint 等のページに差し込める「キャラ一覧」ブロック。
   - 作品の **`isActive=true` 全キャラ**を `sortOrder` 順に 3 列グリッド（アイコン + 名前）で表示。
   - menu / pages API がキャラを同梱して渡している（実機ホーム・編集プレビュー共通）。

最重要の発見:
- **`Character` モデルに説明文フィールド（description / profile / bio）が存在しない。**
- にもかかわらず、ブロック設定スキーマ `characterListSettingsSchema` には **`show_description` トグルが既に存在**する（= データ・描画が無いまま設定だけ先行した「半完成」状態）。
- **プレイヤー別の "met"（出会った）判定に使える保存データが無い。** `UserProgress` は現在フェーズ（`currentPhaseId`）等を持つが、「どのメッセージ / どのキャラと実際に接触したか」の配信ログが無い（`PuzzleDelivery` は謎専用）。

→ 推奨は **A: まず `Character.description` の migration を入れる**（小さく・安全・`show_description` の半完成を回収できる）。"met" は backing data が無く仕様も未確定のため後回し。

## Current Files

| 役割 | パス |
|---|---|
| Character ページ renderer（ブロック合成・未連携 stub） | `src/components/liff/CharacterRenderer.tsx` |
| Character 一覧ブロック（`n`/character_list の実体・現行の唯一のキャラ UI） | `src/components/liff/renderers/CharacterListBlock.tsx` （export 名 `lnBlock` / 型 `CharacterInfo`） |
| ページ種別 dispatch（`case "character"`） | `src/components/liff/LiffSinglePageRenderer.tsx` (`226-242`) |
| `n` ブロック描画経路 | `src/components/liff/LiffRenderer.tsx` (`case "n":`) / `block-type-registry.tsx` (`n`) |
| ブロック設定スキーマ（`show_icon` / `show_description`） | `src/lib/validations/index.ts` (`characterListSettingsSchema` ~1030) |
| Character DB model | `prisma/schema.prisma` (`model Character` 182-205, `@@map("characters")`) |
| Character API | `src/app/api/characters/[id]/route.ts`（GET / PATCH / DELETE。コメントは旧名 `/api/ln/:id`） |
| Character CMS editor | `src/app/oas/[id]/characters/page.tsx`（一覧 + 編集。型 alias `ln`） |
| キャラ同梱 API（`n` 用） | `src/app/api/liff/works/[workId]/menu/route.ts`, `.../pages/[pageId]/route.ts` |

> 補足: 型・一部 export が難読化リネーム（`Character` ↔ 型 `ln`、`character_list` ↔ blockType `"n"`、`CharacterListBlock` ↔ export `lnBlock`）。本書では実体名で記述する。

## Current Renderer Flow

- `/liff/.../p/[pagePublicId]` → `LiffSinglePageRenderer` →
  - ページ見出し（`page.title` h2 + `page.description` p）を **常に**描画（108-115 付近）。
  - `ActivePageContent` の `switch(pageType)`:
    - `case "character"` → `CharacterRenderer`（`page.blocks` をそのまま渡す）。
- `CharacterRenderer`:
  - `liff-font` ラッパ + `config.description` を `<p>` で描画（**SinglePageRenderer 側と二重表示**。Survey/FAQ/Contact/Location と同じ既知パターン）。
  - `blocks.length === 0` → `LiffEmptyState 🎭`。
  - blocks を `CharacterBlockSwitch` で heading/text/warning/image/button_link/divider/accordion に振り分け。**`character_list`/`n` は未対応（default で `null`）**。
- `n` ブロック（character_list）は `LiffRenderer`（default ページ等）側で処理され、`CharacterListBlock` が API 同梱の `characters` を 3 列グリッド表示。

## Current Data Model

`model Character`（`@@map("characters")`）:

| field | 型 | 備考 |
|---|---|---|
| id | String (uuid) | PK |
| workId | String | `Work` に従属（`onDelete: Cascade`） |
| name | String | 名前 |
| iconType | String `"text"\|"image"` | 既定 `text` |
| iconText | String? | テキストアイコン |
| iconImageUrl | String? | 画像アイコン |
| iconColor | String? | 背景色 |
| sortOrder | Int | 並び順 |
| isActive | Boolean | 既定 true（= visibility/published 相当） |
| createdAt / updatedAt | DateTime | |

関連:
- `Character.messages : Message[]` — キャラは**メッセージの発話者**（`Message.characterId`）。
- `Work.systemCharacterId` — 作品のシステム発話者。
- `Message`（317-）: `characterId?`, `phaseId?`, `sortOrder`, `isActive` 等。謎は `correctCharacterId` / `incorrectCharacterId` も持つ。

**description / profile / bio / role / tag に相当する field は存在しない**（schema・types・CMS editor すべてに無いことを grep 確認済み）。あるのは name / icon / color / sortOrder / isActive のみ。

## Current CMS Editing Flow

- `src/app/oas/[id]/characters/page.tsx`: キャラ一覧 + 編集 UI（`CharAvatar` 等）。`toggleActive` で `isActive` 切替。新規は `/oas/[id]/ln/new`。
- 編集可能 field: name / icon（type, text, image, color）/ sortOrder / isActive。**説明文の入力欄は無い**（grep `description|profile|bio` → 0）。
- API: `/api/characters/[id]`（GET / PATCH / DELETE）。更新は `updatelnSchema`（validations）。
- `n` ブロック設定 CMS: `show_icon` / `show_description` を持つ（`characterListSettingsSchema`）。**`show_description` を ON にしても表示する説明文が無い**（データ・描画とも未対応）。

## Current API / Data Fetching

- キャラ一覧（`n` ブロック用）は専用エンドポイントではなく **menu / pages API が同梱**:
  - `GET /api/liff/works/[workId]/menu`, `GET /api/liff/works/[workId]/pages/[pageId]`
  - `prisma.character.findMany({ where: { workId, isActive: true }, orderBy: [{sortOrder},{createdAt}], select: { id, name, iconType, iconText, iconImageUrl, iconColor } })`
  - レスポンス整形: `{ id, name, icon_type, icon_text, icon_image_url, icon_color }` — **description は select もマッピングも無し**。
- `CharacterRenderer`（`page_type="character"`）は **キャラデータを一切受け取らない**（blocks のみ）。
- プレイヤー別のキャラ取得・met 取得 API は**存在しない**。

## Current UI Behavior

- **`CharacterRenderer`（page_type=character）**: description（重複）+ blocks。キャラ未連携。空 = `🎭`。旧 UI トーンだが中身が汎用ブロックなので「キャラ画面」というより「自由ページ」。
- **`CharacterListBlock`（n）**: `grid grid-cols-3 gap-3`。各セル = `w-12 h-12 rounded-full`（画像 or `icon_color` 背景に `icon_text`/頭文字）+ `text-[12px]` 名前。`show_icon!==false` を尊重、**`show_description` は未参照**。空 = `キャラクターが登録されていません`。
- loading / error: どちらの面も専用 state を持たない（データ同梱が親 API のため、親 viewer の loading/error に依存）。not-logged-in 概念も無い（キャラ一覧はプレイヤー非依存＝全 active 表示）。

## Description Field Status

- **DB: 無し**（`Character` に description 系カラム無し）。
- **CMS 入力: 無し**。
- **API 送出: 無し**（menu/pages の select に無い）。
- **描画: 無し**（`CharacterListBlock` は名前のみ。`show_description` は dead）。
- 追加するなら自然な置き場は **`Character` モデル**。命名は既存規則（`Phase.description`, `LiffPageConfig.description` 等が `description`）に合わせ **`description String?`（nullable）** を推奨。
- backfill 不要（nullable・既定で非表示の `show_description=false` 運用なら既存挙動不変）。
- 影響範囲（migration 単独では完結しない）: schema + migration / `updatelnSchema`（+ create schema）/ `/api/characters` GET・PATCH / CMS editor 入力欄 / menu・pages API の select + mapping / `CharacterInfo` 型 + `CharacterListBlock` 描画（`show_description` 配線）/ seed・fixture / 関連テスト。

## "Met Character" Status

- **"met"（このプレイヤーが出会ったキャラ）に相当する保存データは無い。**
- `UserProgress`（per `lineUserId`×`workId`）: `currentPhaseId`, `reachedEnding`, `flags`(JSON), `variables`(JSON), `lastSentMessageIds`, `lastInteractedAt`。→ **現在フェーズは分かるが、接触したキャラ/メッセージの履歴は持たない**。
- メッセージ配信/既読ログ: `PuzzleDelivery`（謎専用）のみ。一般メッセージの per-user 配信ログ・既読ログ **無し**。
- 近似は可能だが不正確: `Phase.sortOrder` ＋ `UserProgress.currentPhaseId` ＋ `Message.characterId/phaseId` から「到達フェーズ以下のメッセージに登場するキャラ」を導出可。ただし `targetSegment` / QR 分岐 / `isActive` 等により**実際に届いたメッセージとは一致しない**（ネタバレ・取りこぼし両リスク）。
- preview 時: 全表示（疑似プレイ）か、preview 専用フラグで全 unlock が無難。
- not-logged-in 時: met 判定不可 → 全表示 or 「登場人物」表現にフォールバック。
- **正確な met には新規データ/API が必要**（後述 候補C/D）。

## "Met" Definition Options

| 候補 | 内容 | 実装コスト | DB/migration | API変更 | ネタバレ | CMS負荷 | プレイヤー体験 | 推奨度 | Whale Studio 適合 |
|---|---|---|---|---|---|---|---|---|---|
| **A** | 全キャラ表示（現状の `n` 相当） | 低（UI のみ） | 不要 | 不要 | 高（全員見える） | 低 | 「登場人物一覧」 | △（UI polish には可） | ○（既存挙動） |
| **B** | 作品で使用中（=メッセージに紐づく）キャラのみ | 中 | 不要（既存 query） | 軽微（select 追加） | 中 | 低 | 作品単位の使用キャラ | △ | ○ |
| **C** | プレイヤー到達フェーズに登場したキャラのみ | 中〜高 | 近似なら不要 / 正確なら要 | 要（player別 API） | 低〜中（近似は取りこぼし） | 低 | "出会った" に近い | ○（近似は注意書き必須） | ◎（理想形だが要設計） |
| **D** | CMS で unlock 条件を明示設定 | 高 | 要（条件保存） | 要 | 最小（制御可） | 高 | 正確 | △（コスト高） | ○（大型作品向け） |
| **E** | 当面 A（全/登場人物表現）→将来 "出会った" に拡張 | 低→段階 | 段階 | 段階 | A 同等→改善 | 低 | 安全に出せる | ◎（現実的） | ◎ |

備考:
- **C の "正確版"** は per-user の「met キャラ set」を持つ必要がある。最小実装は `UserProgress.flags`/`variables` 同様の JSON か、専用テーブル（`UserMetCharacter` 等）。発話メッセージ送信時に met を追記するフックが要る（送信パイプライン改修）。
- **C の "近似版"**（phase 到達ベース）は新規 DB 不要だが、ネタバレ・取りこぼしの両リスクをプロダクト判断する必要がある。
- 表現は "met" 確定までは「登場人物」寄り（= E）にしておくと、後から「出会ったキャラのみ」へ安全に切替できる。

## UI Foundation Reuse

| component | Character で使えるか | メモ |
|---|---|---|
| `LiffEmptyState` | ◎ | 既に CharacterRenderer/CharacterListBlock の空状態で利用可（CharacterRenderer は primitives 版を使用中、ui 版に寄せ可） |
| `LiffCard` | ○ | キャラ詳細カード化する場合 |
| `LiffQuestionCard` | △ | Survey 専用構造寄り。キャラには不自然、無理に使わない |
| `LiffChoiceRow` | × | 選択肢 UI 用途。キャラ一覧に不要 |
| `LiffActionButton` | △ | 詳細/CTA を作る場合のみ |
| `LiffTagBadge` / `LiffQuestionBadge` | ○ | role/tag 表示（将来）に流用余地。ただし role/tag データは現状無い |
| tokens（`--liff-ui-*`, `LIFF_CARD_CLASS` 等） | ◎ | 他 polish PR と同方針で利用 |
| `LiffLoadingState` / `LiffErrorState` | △ | キャラ一覧は親 API 依存のため renderer 側では基本不要 |

→ **shared ui component の変更は不要**（既存をそのまま再利用できる）。新規が要るとしてもキャラ専用のローカル小 component（カード/アバター）で吸収可。

## Risks

- **二重 description**: CharacterRenderer も description を出している（SinglePageRenderer と二重）。polish PR で要除去（他画面と同じ修正）。
- **`show_description` の dead 設定**: 既に CMS に露出しているが効かない → ユーザー混乱の温床。description migration で回収するのが筋。
- **met の不正確さ**: 近似実装はネタバレ/取りこぼしリスク。プロダクト判断なしに "出会った" と銘打つのは危険。
- **送信パイプライン改修**（正確 met）: メッセージ送信ロジックに met 追記フックを足すのは影響範囲が広く、慎重対応が必要。
- **難読化リネーム**: `ln`/`n`/`lnBlock` 等で grep しづらい。実装時はマッピング表（本書 Current Files 脚注）を参照。
- **Character ↔ Message 結合**: Character は発話者として Message に深く結合。表示用 field 追加（description）は安全だが、表示ロジックを送信側に絡めると影響大。

## Recommended Implementation Plan

**推奨方針: A —「まず `Character.description` の migration からやるべき」。**

理由:
1. `show_description` 設定が**既に出荷済みだが dead**＝半完成の回収（プロダクト負債解消）になる。
2. migration が**最小・最安全**（nullable 1 カラム追加・backfill 不要・既定 OFF なら既存挙動不変）。
3. これがあって初めて Character の visual polish が「アイコン+名前」以上の意味を持つ（説明文付きカード）。description 無しの polish は限界的。
4. "met" は **backing data が無く仕様も未確定**＝先に DB/API 設計とプロダクト判断が必要なため後回しが安全。

順序: **CR1（description migration + CMS/API/render 配線）→ CR2（Character visual polish）→ CR3（met 設計調査/プロダクト判断）→ CR4（met UI、承認後）→ CR5（tests/fixtures）**。

> 代替: ゼロ DB のまま他 LIFF 画面と同じ「純 visual polish」を先にやりたい場合は **B**（既存 icon+name のまま `CharacterListBlock`/`CharacterRenderer` を handoff に寄せる）も可。ただし description 不在のため見栄えの伸びしろは小さい。"met" 先行（C 深掘り）は仕様確定前のため非推奨。

## Proposed PR Split

### PR-CR1 — Character description schema/migration + CMS/API 保存
- 目的: `Character.description String?` 追加と保存・取得・送出までの配線。
- 変更候補: `prisma/schema.prisma`（+ migration）/ `src/lib/validations`（create/update ln schema）/ `src/app/api/characters/[id]`（GET/PATCH）/ `src/app/oas/[id]/characters/page.tsx`（入力欄）/ menu・pages API の select+mapping / `CharacterInfo` 型。
- DB/migration: **有**（nullable・backfill 不要）。API: **有**（field 追加のみ）。CMS: **有**。
- リスク: 中（複数層）。ただし additive で後方互換。Migration policy（PostgreSQL 専用・sort-last 連番・ADD COLUMN を先行適用→merge でゼロウィンドウ）に従う。
- 依存: なし（最初）。rollback: カラム未使用なら容易（描画は次 PR）。**先にやるべき**。

### PR-CR2 — Character visual polish（全表示 / 既存仕様維持）
- 目的: `CharacterListBlock`（n）と `CharacterRenderer` を handoff に寄せる。description（CR1 後）を `show_description` 連動で表示。CharacterRenderer の二重 description 削除。
- 変更候補: `CharacterListBlock.tsx` / `CharacterRenderer.tsx`（原則この 2 ファイル）。
- DB/migration: **無**。API: **無**（CR1 で field 送出済み前提）。CMS: **無**。
- リスク: 低（visual のみ）。依存: CR1（description 表示する場合）。rollback: 容易。
- ※ description 表示を含めないなら CR1 なしでも単独実施可（= B 案）。

### PR-CR3 — "met" 定義の設計調査 / player-specific API 調査
- 目的: 候補 C/D の実現可能性を確定（近似 vs 正確）、プロダクトと "met" 定義を合意。
- 変更候補: docs のみ（調査）。必要なら最小 spike。
- DB/migration: 無（調査）。リスク: 低。依存: なし。**CR2 と並行可**。

### PR-CR4 — met/unmet UI（承認後）
- 目的: met に応じた表示（unmet をロック/シルエット/非表示）。
- 変更候補: renderer + （正確 met なら）API/DB/送信フック。
- DB/migration: 候補次第（近似=無 / 正確=有）。リスク: 中〜高。依存: CR3 の決定。**後回し**。

### PR-CR5 — tests / fixtures 整備
- 目的: description / met の純関数・renderer・API のテストと seed/fixture 更新。
- 変更候補: `src/__tests__/**`, `prisma/seed.mjs` 等。
- DB/migration: 無。リスク: 低。依存: 対応する実装 PR。

## Open Questions

1. "出会ったキャラ" の正式定義は？（作品内登場キャラ / プレイヤー到達フェーズ / 明示 unlock のどれ？）
2. ネタバレ許容度は？ unmet は「非表示 / シルエット / ロックアイコン」のどれにする？
3. description は 1 行プロフィール程度？ 長文も許容？（文字数上限の要否）
4. `page_type="character"` ページ（CharacterRenderer）と `n` ブロックのどちらを「正」とするか？ 両方ともキャラ一覧化する？
5. 正確 met を採る場合、送信パイプラインに met 追記フックを足してよいか（影響範囲が広い）。
6. role / tag（キャラ属性）は将来必要か？（現状データ無し → 別 migration）。

## Commands Run

```
git switch -c chore/liff-character-investigation
rg -n "^model " prisma/schema.prisma
sed -n '182,205p' prisma/schema.prisma                 # model Character（description 無し確認）
sed -n '272,316p' prisma/schema.prisma                 # model UserProgress（met 用データ無し確認）
sed -n '206,241p' prisma/schema.prisma                 # model Phase（sortOrder あり）
sed -n '317,345p' prisma/schema.prisma                 # model Message（characterId/phaseId）
rg -rn "character_list" src                            # → blockType "n" / CharacterListBlock
rg -n "characters" .../works/[workId]/menu/route.ts    # select に description 無し
rg -n -A6 "characterListSettingsSchema" validations    # show_description（dead 設定）発見
cat src/components/liff/CharacterRenderer.tsx
cat src/components/liff/renderers/CharacterListBlock.tsx
rg -in "description|profile|bio" src/app/oas/[id]/characters/page.tsx   # → 0（CMS に説明欄無し）
npx tsc --noEmit
```
