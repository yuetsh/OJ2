# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OJ2 的前端**（`OJ2/apps/web`），代码从上一代 `ojnext/` 原样搬来、只替换了 API 层
（`ojnext` 与 `../OnlineJudge` 都已下线且**完全冻结，一行都不改**）。Vue 3 + TypeScript，
Vite（Rolldown 内核）、Naive UI、Pinia、Vue Router。

**要兼容机房的老 Chrome（< 94）**：`vite.config.ts` 的 legacy 配置与
`mermaid-legacy` 等 fallback 依赖不能动，理由写在该文件的注释里。

## Commands

前端一般不单独起，`OJ2/` 根目录 `bun run dev` 会把 api + worker + web 一起拉起来。
只跑前端或要验证时：

```bash
bun run dev            # 只起前端 dev server（5173），后端得另外起
bun run type-check     # 类型检查。改完 .vue / .ts 必须跑这个
bun run build          # 生产构建
bun run fmt            # Prettier
```

⚠️ **验证只认 `bun run type-check`。** `vue-tsc --noEmit -p tsconfig.json` 会**静默
通过**——那个 tsconfig 是 `files: []` + references 的壳，真正的配置在
`tsconfig.app.json`（0.2 秒跑完就是没在检查的信号）；`vite build` 也不做类型检查。

不写测试（沿用项目约定），验证靠实跑。lint 只有 Prettier。

## Architecture

### Directory Structure

```
src/
├── shared/        # Cross-cutting concerns: layout, stores, composables, API
├── oj/            # User-facing features (problems, submissions, contests, etc.)
├── admin/         # Admin panel features
├── utils/         # Constants, types, HTTP client, helpers
├── routes.ts      # Route definitions (two top-level: ojs, admins)
├── main.ts        # App entry point
└── App.vue        # Root component with Naive UI theme setup
```

### Module Pattern

Each feature module (under `oj/` or `admin/`) typically has:
- 页面组件直接放模块根下（`problem/list.vue`、`problem/detail.vue`），**没有 `views/` 这一层**
- `components/` — feature-specific components
- `composables/` / `utils/` — 模块自己的组合式函数与纯函数（按需，不是每个模块都有）

API 调用不按模块分：学生端全在 `oj/api.ts`、后台全在 `admin/api.ts`、
跨端的（登录、资料、标签、验证码）在 `shared/api.ts`。

Shared logic lives in `shared/`:
- `store/` — Pinia stores: `user` (auth/roles), `config` (site-wide settings), `authModal` (login/signup form state), `screenMode` (problem split-screen layout), `loginSummary` (AI activity summary), `collab` (help-request queue + collab room)
- `composables/` — `pagination` (URL-synced), `websocket` (reconnect + heartbeat), `collabDoc` (Yjs binding for the collab channel), `configUpdate` (WS-pushed config sync), `useMermaid` (lazy Mermaid render), `breakpoints`, `maxkb`
- `layout/` — `default.vue` and `admin.vue` layout wrappers
- `api.ts` — shared API calls (auth, profile, tags, captcha)

### Auto-Imports

Configured via `unplugin-auto-import` and `unplugin-vue-components`. You do **not** need to manually import:
- Vue APIs (`ref`, `computed`, `watch`, etc.)
- Vue Router (`useRouter`, `useRoute`)
- Pinia (`defineStore`, `storeToRefs`)
- VueUse composables
- Naive UI composables (`useDialog`, `useMessage`, `useNotification`, `useLoadingBar`)
- Naive UI components (all `N*` components)
- Naive UI types (`DataTableColumn`, `FormRules`, `FormItemRule`, `SelectOption`, `UploadCustomRequestOptions`, `UploadFileInfo`, `MenuOption`, `DropdownOption`)

Generated type declaration files: `src/auto-imports.d.ts`, `src/components.d.ts`.

### Path Aliases

```
utils  →  ./src/utils
oj     →  ./src/oj
admin  →  ./src/admin
shared →  ./src/shared
```

### HTTP Client

`utils/api.ts` — Axios instance with interceptors (`baseURL: "/api"`,
`withCredentials`). It unwraps both the axios envelope and the backend's
`{ data }` envelope, so callers get the payload directly. All API calls proxy
through the dev server (see `vite.config.ts`).

### Contract guard (`utils/contract.ts`)

`@oj2/contract` 的 zod schema 是**前后端唯一的形状来源**，`utils/types.ts` 只做
`z.infer` 派生与少量前端专有的收窄（都写了理由）。

运行时闸门**只挂三处**：题目详情、提交详情、`shared/api.ts` 的用户资料 ——
原本就写了 `.parse()` 的那三条。留着它们的理由是**别抛错**，不是校验：

```ts
// 原来是 problemDetailSchema.parse(v) as Problem —— `as` 让校验白做，
// 而 parse 抛错会让整个题目页白屏
return contract("GET /problems/:id", problemDetailSchema, value)
```

失败时记一条控制台日志再**放行原始数据**，页面照常渲染。

**不要把它铺到更多端点上。** 试过一次（41 个），收益是 41 次 safeParse 加一条
没人读的 console.error：前后端同仓、共享同一份 schema，「后端改字段前端不知道」
`tsc` 已经抓了。

### 什么该收紧，什么不该

**JSONB 原文（`submission.info` / `statistic_info` / `exercise.data`）不在读出侧
校验。** 它们的形状真相在写入侧 —— 判题机、`services/exercise.ts`。在读出侧再收
一遍的结果实测过两次：

- `info` 按采样键集收紧后，124192 条提交里 9163 条（RE、TLE、MLE 全中）对不上，
  被 union 的空对象分支**静默剥成 `{}`**，管理员的测试点表格无声消失；
- `exercise.data` 按题型收紧后，后端读路径（`routes/content.ts` 硬 parse）变成
  一道闸，一行脏数据能让整条练习列表 500。

**后端出参已经不 `parse` 了**（原来 136 处，全部改成 `satisfies`；撤的时候炸出两个
一直存在的线上 500，见 `../CLAUDE.md` 的「出参不 `parse`，用 `satisfies`」）。
所以现在收紧一个字段的直接后果落在 **`tsc` 编译期**，而不再是运行时 500 —— 这是好事，
但别因此就放心大胆收：契约里的形状仍然要对得上库里的存量数据，前端拿到对不上的值
一样会渲染错。收紧任何字段之前，拿根目录那份生产备份把全量数据跑一遍，
尤其要看**空值**而不只是键集合。

### Key Utilities

- `utils/constants.ts` — Judge status codes, language IDs, difficulty levels, contest types
- `utils/types.ts` — 契约类型的派生与前端专有收窄（不是手写的一份平行类型）
- `utils/contract.ts` — 运行时契约闸门，见上
- `utils/judge.ts` — Judge-related utilities
- `utils/renders.ts` — Table column render helpers for Naive UI DataTable

### Environment Variables

Variables prefixed with `PUBLIC_` are injected at build time. Env files: `.env`, `.env.staging`, `.env.test`.

| Variable | Purpose |
|---|---|
| `PUBLIC_OJ_URL` | Backend REST API base URL |
| `PUBLIC_WS_URL` | WebSocket server URL |
| `PUBLIC_ENV` | Environment name (dev/staging/production) |
| `PUBLIC_CODE_URL` | Code execution service |
| `PUBLIC_JUDGE0_URL` | Judge0 API |
| `PUBLIC_MAXKB_URL` | Knowledge base service |
| `PUBLIC_ICONIFY_URL` | Iconify icon CDN |

### Routing

Routes are defined in `src/routes.ts` with two root routes: `ojs` (user-facing) and `admins` (admin panel). Route meta fields used:
- `requiresAuth` — redirect to login if not authenticated
- `requiresSuperAdmin` — super admin only
- `requiresProblemPermission` — problem management access

### Real-time Features

- WebSocket via composable in `shared/composables/` for submission status updates
- Yjs over the `/ws/collab` channel for classroom help requests and collaborative
  code editing (students raise a hand, teachers join their editor). The server is a
  dumb relay — it authenticates, assigns rooms, and forwards frames without parsing
  them. See `docs/specs/2026-08-28-collab-help-request-design.md`.

## Related Repository

后端就在同一个仓库的 `../api`（Bun + Hono + Drizzle，编译成单二进制），
契约在 `../../packages/contract`。**不要再去看 `OnlineJudge/`** —— 那是已下线的
Django 后端，只作参照、完全冻结。详见 `../CLAUDE.md`。
