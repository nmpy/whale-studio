import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths  from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals:     true,
    // .claude/worktrees 配下の stale worktree コピーを走査しない（別ブランチの古いテストを拾わないため）
    exclude:     [...configDefaults.exclude, "**/.claude/**"],
  },
});
