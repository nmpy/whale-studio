# perf-works-ssr ブランチ修正まとめ

Claude Code に引き継ぐための作業メモです。

## ブランチ情報

- Branch: `perf-works-ssr`
- Commit: `2b32119 Improve SSR loading for workspace pages`
- Remote: `origin/perf-works-ssr`
- PR URL: `https://github.com/nmpy/whale-studio/pull/new/perf-works-ssr`

## 背景

管理画面全体で、初回表示やページ遷移時に以下の問題があった。

- `/oas` がクライアント側で `/api/oas` を複数回叩いていた
- `/oas/[id]/works` の「作品リスト」「プランを見る」「作品数上限バナー」などが後から出てガタついた
- `/oas/[id]/works/[workId]` の「作品管理」初回遷移が遅かった
- ヘッダーの「オーナー」表示がロールAPI取得後に遅れて出ていた
- ルートページの「最近使ったアカウント」が後から出ていた
- 一部ページで `works.public_id` 参照など、現在のDB schemaと合わない箇所があった

このブランチでは、主に管理画面の初期表示をSSR寄せし、クライアント初回fetchとレイアウトシフトを減らしている。

## 主な修正内容

### 1. 管理画面ページをSSR + Client Component分離に変更

以下のページで、サーバー側で初期データを取得してClient Componentへ渡す構成に変更した。

- `/`
  - `src/app/page.tsx`
- `/oas`
  - `src/app/oas/page.tsx`
  - `src/app/oas/OaListClient.tsx`
- `/oas/[id]/works`
  - `src/app/oas/[id]/works/page.tsx`
  - `src/app/oas/[id]/works/WorkListClient.tsx`
- `/oas/[id]/works/[workId]`
  - `src/app/oas/[id]/works/[workId]/page.tsx`
  - `src/app/oas/[id]/works/[workId]/WorkHubClient.tsx`
- `/oas/[id]/works/[workId]/messages`
  - `MessagesClient.tsx`
- `/oas/[id]/works/[workId]/characters`
  - `CharactersClient.tsx`
- `/oas/[id]/works/[workId]/scenario`
  - `ScenarioClient.tsx`
- `/oas/[id]/riddles`
  - `RiddlesClient.tsx`
- `/oas/[id]/settings`
  - `SettingsClient.tsx`
- `/oas/[id]/account`
  - `AccountClient.tsx`

狙い:

- 初期HTMLに必要なデータを含める
- loading skeletonや後追い表示によるガタつきを減らす
- クライアント側API呼び出し回数を減らす

### 2. ロール取得の遅延表示を改善

対象:

- `src/hooks/useWorkspaceRole.ts`
- `src/components/AppHeader.tsx`
- `src/components/AppShell.tsx`
- `src/app/layout.tsx`
- `src/lib/server-auth-user.ts`

内容:

- `useWorkspaceRole` に初期ロール引数とメモリキャッシュを追加
- SSRで分かる `workspaceRole` をClient Componentへ渡す
- 初期ロールがある場合は `/api/oas/:id/members/me` を再取得しない
- AppHeaderの「オーナー」バッジが初期HTMLから出るようにした
- platform owner / dev owner の場合はOA個別ロール検索を省略

### 3. `/oas/[id]/works` の表示高速化

対象:

- `src/app/oas/[id]/works/page.tsx`
- `src/app/oas/[id]/works/WorkListClient.tsx`
- `src/hooks/useWorkLimit.ts`

内容:

- 作品一覧をSSRで取得
- `friendAddSettings` と `subscription/plan` もSSRで初期注入
- `useWorkLimit` に初期値対応を追加し、初期値がある場合は後追いfetchしない
- 作品数上限バナーと「プランを見る」ボタンが初期表示から出るようにした
- Prisma `_count` の重い集計を避け、必要な集計を `work_id` に絞ったSQLに変更
- 作品0件の場合は集計SQLを走らせない
- `OA+プラン / works / friendAdd / role` を並列取得

計測メモ:

- 修正後、落ち着いた状態で `/oas/[id]/works` は約 `0.27s` まで低下

### 4. 「作品管理」ページの初回遷移を改善

対象:

- `src/app/oas/[id]/works/[workId]/page.tsx`
- `src/app/oas/[id]/works/[workId]/WorkHubClient.tsx`
- `src/components/WorkCard.tsx`

内容:

- Prisma `_count` をやめ、単一 `workId` に絞った集計SQLへ変更
- `作品本体 / workspace role / 集計` を並列取得
- `WorkHubClient` に `initialWorkspaceRole` を渡す
- `WorkCard` 表示時に `router.prefetch(workHref)` を明示的に実行し、クリック前に遷移先RSCを温める

計測メモ:

- 修正前: 作品管理ページの直接アクセスで約 `4.0s`
- クエリ改善後: 約 `0.65s`
- 連続アクセス時: 約 `0.26s`

### 5. API側のschema不一致対策

対象:

- `src/app/api/works/route.ts`
- `src/app/api/works/[workId]/route.ts`
- `src/app/api/messages/route.ts`
- `src/app/api/characters/route.ts`
- `src/app/api/phases/route.ts`
- `src/app/api/oas/[id]/riddles/route.ts`
- `src/app/api/oas/route.ts`

内容:

- Prisma既知エラーをログに出す
- `P2022` などDB schema不一致の兆候を追いやすくする
- 一部APIで `public_id` / schema差分に弱い参照を避ける方向に修正

## 期待される挙動

- `/oas` の初回表示で `/api/oas` を何度も叩かない
- `/oas/[id]/works` の作品一覧、プランボタン、上限バナーが後から出ない
- `/oas/[id]/works/[workId]` の初回遷移が短くなる
- 戻る → 再度遷移時はNextのclient cacheとprefetchでさらに速い
- ヘッダーの「オーナー」が後から出ず、初期表示から表示される

## 検証済み

実施した確認:

- `curl` で `/oas/[id]/works` と `/oas/[id]/works/[workId]` のレスポンス時間を複数回測定
- 初期HTMLに「オーナー」「プランを見る」「作品数上限バナー」が含まれることを確認
- `git diff --check -- src` は問題なし

型チェック:

```bash
./node_modules/.bin/tsc --noEmit
```

結果:

- 既存の `src/__tests__/beacon-api-rbac.test.ts(45,69)` の型エラーで停止
- 今回の修正起因ではない

## 注意点

### 未コミットのローカル変更

以下はこのブランチのコミットには含めていない。

- `.env`
- `CLAUDE.md`
- `package-lock.json`

これらはローカルに未コミット変更として残っている可能性がある。

### 本番反映

`main` へ直接pushしていない。  
`perf-works-ssr` ブランチをpush済みなので、PR経由で確認・mergeする想定。

### DB接続

ローカルでSupabase direct connectionを使う場合、環境によって `db.xxx.supabase.co:5432` に届かないことがある。  
その場合はSupabaseのSession pooler接続文字列を `DATABASE_URL` に使う。

## Claude Codeに見てほしいポイント

1. SSR化したページで不要なクライアントfetchが残っていないか
2. `router.prefetch` の粒度が過剰ではないか
3. raw SQL集計がPostgreSQL前提として妥当か
4. `workspaceRole` の初期値キャッシュが権限変更時に問題を起こさないか
5. API側のschema不一致ハンドリングが過剰・不足していないか

