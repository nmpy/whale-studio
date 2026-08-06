import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths  from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig の jsx は Next 用に "preserve" のため、変換側で明示的に automatic runtime を指定する。
  // これが無いと .tsx を含むテストが JSX のまま実行されてパースに失敗する。
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  test: {
    // 既定は従来どおり node。DOM が要るテストはファイル先頭の
    // `// @vitest-environment jsdom` で個別に切り替える（既存テストの実行環境は変えない）。
    environment: "node",
    globals:     true,
    // .claude/worktrees 配下の stale worktree コピーを走査しない（別ブランチの古いテストを拾わないため）
    exclude:     [...configDefaults.exclude, "**/.claude/**"],
  },
});
