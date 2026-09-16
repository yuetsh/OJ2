import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import legacy from "@vitejs/plugin-legacy"
import AutoImport from "unplugin-auto-import/vite"
import Components from "unplugin-vue-components/vite"
import { NaiveUiResolver } from "unplugin-vue-components/resolvers"

// 机房电脑的 Chrome 是 105 一档，比 plugin-legacy 的现代基线（chrome>=105）正好压线，
// 但比 vite 8 的默认构建 target（chrome111）低。所以这个插件必须留着：它同时管两件事
// —— 把 build.target 压到 chrome105/es2020，再给现代产物补 core-js 的 API polyfill。
//
// 下面这份清单是 `modernPolyfills: true` 自动探测出来的 50 项，抄下来写死：自动探测要
// 对每个产物跑一遍 Babel 扫描，构建从 3 秒涨到 12 秒。**升级前端依赖后重新审计一次**：
//   DEBUG=vite:legacy bun run build   # 会打印 modern polyfills 的全集
// 少一项就是老机器上一个静默的 TypeError（这批缺的大多是 Chrome 110+ 的
// Array.prototype.toSorted / Set 运算 / 迭代器辅助）。
const polyfills = [
  "es.array-buffer.detached",
  "es.array-buffer.transfer",
  "es.array-buffer.transfer-to-fixed-length",
  "es.array.includes",
  "es.array.push",
  "es.array.to-reversed",
  "es.array.to-sorted",
  "es.array.to-spliced",
  "es.array.with",
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
  "es.map.get-or-insert",
  "es.map.get-or-insert-computed",
  "es.regexp.escape",
  "es.regexp.flags",
  "es.set.difference.v2",
  "es.set.intersection.v2",
  "es.set.is-disjoint-from.v2",
  "es.set.is-subset-of.v2",
  "es.set.is-superset-of.v2",
  "es.set.symmetric-difference.v2",
  "es.set.union.v2",
  "es.typed-array.to-reversed",
  "es.typed-array.to-sorted",
  "es.typed-array.with",
  "es.uint8-array.set-from-base64",
  "es.uint8-array.set-from-hex",
  "es.uint8-array.to-base64",
  "es.uint8-array.to-hex",
  "es.weak-map.get-or-insert",
  "es.weak-map.get-or-insert-computed",
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
      // 不做 SystemJS 双构建，只给现代产物注入 polyfill；modernTargets 不写，
      // 用插件自带的基线（chrome>=105 / firefox>=106 / safari>=16.4），正好是机房那档。
      legacy({
        renderLegacyChunks: false,
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
