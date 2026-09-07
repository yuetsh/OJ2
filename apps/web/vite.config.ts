import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import legacy from "@vitejs/plugin-legacy"
import AutoImport from "unplugin-auto-import/vite"
import Components from "unplugin-vue-components/vite"
import { NaiveUiResolver } from "unplugin-vue-components/resolvers"

// 显式保留 Chrome 90 所需的运行时兼容项，避免 plugin-legacy 对每个产物执行 Babel 扫描。
// 升级前端依赖后需要重新审计此列表。
const polyfills = [
  "es.aggregate-error.cause",
  "es.array-buffer.detached",
  "es.array-buffer.transfer-to-fixed-length",
  "es.array-buffer.transfer",
  "es.array.at",
  "es.array.find-last-index",
  "es.array.push",
  "es.array.to-reversed",
  "es.array.to-sorted",
  "es.array.to-spliced",
  "es.array.with",
  "es.error.cause",
  "es.iterator.constructor",
  "es.iterator.drop",
  "es.iterator.every",
  "es.iterator.filter",
  "es.iterator.find",
  "es.iterator.flat-map",
  "es.iterator.for-each",
  "es.iterator.map",
  "es.iterator.reduce",
  "es.iterator.some",
  "es.iterator.to-array",
  "es.json.parse",
  "es.json.stringify",
  "es.map.get-or-insert-computed",
  "es.map.get-or-insert",
  "es.object.has-own",
  "es.regexp.flags",
  "es.set.difference.v2",
  "es.set.intersection.v2",
  "es.set.is-disjoint-from.v2",
  "es.set.is-subset-of.v2",
  "es.set.is-superset-of.v2",
  "es.set.symmetric-difference.v2",
  "es.set.union.v2",
  "es.string.at-alternative",
  "es.typed-array.at",
  "es.typed-array.find-last-index",
  "es.typed-array.find-last",
  "es.typed-array.set",
  "es.typed-array.to-reversed",
  "es.typed-array.to-sorted",
  "es.typed-array.with",
  "es.uint8-array.set-from-base64",
  "es.uint8-array.set-from-hex",
  "es.uint8-array.to-base64",
  "es.uint8-array.to-hex",
  "es.weak-map.get-or-insert-computed",
  "es.weak-map.get-or-insert",
  "esnext.array.group",
  "web.dom-exception.stack",
  "web.immediate",
  "web.structured-clone",
  "web.url-search-params.delete",
  "web.url-search-params.has",
  "web.url-search-params.size",
  "web.url.can-parse",
]

// MaxKB 脚本**不要**在这里注入 index.html。
//
// 原来有个 inject-maxkb 插件把 <script src> 写进 head，于是构建产物在 Vue 启动之前
// 就把挂件拉下来执行了 —— 后台那个「启用 MaxKB」开关根本拦不住它，关掉也只是
// 事后把标签和 DOM 删掉，代码早跑完了（表现之一：MaxKB 自带的性能上报在每个页面
// 抛 `Cannot read properties of undefined (reading 'startTime')`，且关不掉）。
//
// 现在只走运行时那一条路：App.vue 的 useMaxKB() 等站点配置回来，
// enableMaxkb 为真才建 script 标签。

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "PUBLIC_")

  // 开发时一律指向本机后端（apps/api，3000）。
  // **必须写 IP，不能写 localhost**：api 用 Bun.serve 起，只绑 IPv4 的
  // 0.0.0.0:3000，而 Node 解析 localhost 时 ::1 排在前面。别的项目的 dev server
  // 一旦占着 [::1]:3000，两边端口不冲突（一个 v4 一个 v6，谁都不报错），
  // 浏览器发出的 /api/* 就整个落到那个站上 —— 表现是后台一进就被弹回首页。
  const backend = {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
  }

  return {
    plugins: [
      vue(),
      // 机房存在 Chrome 91 等旧浏览器：不做 SystemJS 双构建，
      // 只按使用情况给现代产物注入 core-js API polyfill（Array.at 等）
      legacy({
        renderLegacyChunks: false,
        modernTargets: "chrome>=90",
        modernPolyfills: polyfills,
      }),
      AutoImport({
        imports: [
          "vue",
          "vue-router",
          "@vueuse/core",
          "pinia",
          {
            "naive-ui": [
              "useDialog",
              "useMessage",
              "useNotification",
              "useLoadingBar",
            ],
          },
          {
            from: "naive-ui",
            imports: [
              "DataTableColumn",
              "FormRules",
              "FormItemRule",
              "SelectOption",
              "UploadCustomRequestOptions",
              "UploadFileInfo",
              "MenuOption",
              "DropdownDividerOption",
              "DropdownOption",
            ],
            type: true,
          },
        ],
        dts: "./src/auto-imports.d.ts",
      }),
      Components({
        resolvers: [NaiveUiResolver()],
        dts: "./src/components.d.ts",
      }),
    ],
    envPrefix: "PUBLIC_",
    resolve: {
      alias: {
        // mermaid-legacy (mermaid@9) 写死了 UMD 路径，新版 cytoscape 的 exports
        // 不允许 import 条件访问它，转到 ESM 产物
        "cytoscape/dist/cytoscape.umd.js": "cytoscape/dist/cytoscape.esm.mjs",
        utils: fileURLToPath(new URL("./src/utils", import.meta.url)),
        oj: fileURLToPath(new URL("./src/oj", import.meta.url)),
        admin: fileURLToPath(new URL("./src/admin", import.meta.url)),
        shared: fileURLToPath(new URL("./src/shared", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // 只有这三段过后端，和生产的 Caddy 认的是同一套（docker/Caddyfile），
        // 别在这里加代理规则而不同步改 Caddyfile。
        "/api": backend,
        "/public": backend,
        "/ws": { ...backend, ws: true },
      },
    },
  }
})
