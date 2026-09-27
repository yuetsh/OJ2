import { defineConfig } from "vite-plus"

/**
 * 全仓的格式化（Oxfmt）、lint（Oxlint）和任务编排（vp run）都在这一份里。
 * 前端自己的构建配置在 apps/web/vite.config.ts，和这里无关。
 */
export default defineConfig({
  fmt: {
    semi: false,
    // Oxfmt 在 Vite+ 下默认 100 列，全仓一直是 80 —— 不写的话一格式化就是几百个文件的 diff
    printWidth: 80,
    ignorePatterns: [
      // drizzle-kit 生成的迁移快照。内容等价的重排也别做 —— 这些文件是
      // db:generate 拿来比对上一版结构的输入，只该由 drizzle-kit 写。
      "apps/api/src/db/meta/",
      // unplugin 每次 dev 都会重写，格式化了也留不住
      "apps/web/src/auto-imports.d.ts",
      "apps/web/src/components.d.ts",
      // 只管代码，和原来 Prettier 的范围一致：文档里的中文表格、compose / workflow
      // 里逐行写的注释都是手排的，别让格式化器重排
      "**/*.md",
      "**/*.yml",
      "**/*.yaml",
      "**/*.json",
      "**/*.toml",
    ],
  },
  lint: {
    options: {
      // 有一条 warning 就算失败：放任 warning 攒起来，等于没有 lint
      denyWarnings: true,
    },
    ignorePatterns: [
      "apps/api/src/db/meta/",
      "apps/web/src/auto-imports.d.ts",
      "apps/web/src/components.d.ts",
    ],
  },
  /**
   * `vp run <任务>`。定义在这里的任务默认带缓存：读到的文件没变就直接复用上次的结果，
   * 改了哪个包只重跑哪个包的检查。cwd 相对仓库根。
   */
  run: {
    tasks: {
      // 一律经 `bun run <脚本>` 调，不直接写 tsc：任务定义在根包里，PATH 是根目录的
      // node_modules/.bin，直接写 tsc 拿到的是根目录的 TS 5.9 而不是 apps/api 的 TS 7，
      // 报一堆假错（实测）。经脚本走，用的是各包自己的依赖，命令也只在 package.json 写一份
      "typecheck:api": { command: "bun run typecheck", cwd: "apps/api" },
      "typecheck:web": { command: "bun run type-check", cwd: "apps/web" },
      "check:routes": { command: "bun run check:routes", cwd: "apps/api" },
      "check:ast": { command: "bun run check:ast", cwd: "apps/api" },
      // 提交前、CI 里跑这一条：格式 + lint + 两边类型检查 + 路由遮蔽 + AST 节点
      verify: {
        command: "vp check",
        dependsOn: [
          "typecheck:api",
          "typecheck:web",
          "check:routes",
          "check:ast",
        ],
      },
    },
  },
})
