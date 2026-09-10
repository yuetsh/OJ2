# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OJ2 的前端**（`OJ2/apps/web`），代码从上一代 `ojnext/` 原样搬来、只替换了 API 层
（`ojnext` 与 `../OnlineJudge` 都已下线且**完全冻结，一行都不改**）。Vue 3 + TypeScript，
Vite（Rolldown 内核）、Naive UI、Pinia、Vue Router。

**要兼容机房的老 Chrome（< 94）**：`vite.config.ts` 的 legacy 配置与
`mermaid-legacy` 等 fallback 依赖不能动，理由写在该文件的注释里。

## Commands

```bash
npm start              # Start dev server on port 5173
npm run build          # Production build
npm run build:staging  # Staging build
npm run build:test     # Test build
npm fmt                # Format with Prettier
```

No test suite is configured. Linting is via Prettier only.

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
- `views/` — page-level Vue components
- `components/` — feature-specific components
- `api.ts` — API calls specific to the feature

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
`z.infer` 派生与少量前端专有的收窄（都写了理由）。读接口应当走守卫：

```ts
const endpoint = `problems/${encodeURIComponent(id)}`
return contract("GET /problems/:id", problemDetailSchema, await api.get<unknown>(endpoint))
```

**失败策略是「记日志 + 放行原始数据」，不抛错。** 形状对不上时：控制台打一条带
端点和字段路径的记录、去重后记进 `window.__OJ2_CONTRACT_DRIFT__`、然后**返回原始
数据让页面继续渲染**。面向学生的生产站点，少一个字段的代价远小于白屏。

排查线上分歧就是打开控制台敲 `window.__OJ2_CONTRACT_DRIFT__`；某条路径长期为空之后，
那条路径可以升级成硬失败（直接 `schema.parse`），在那之前不要改。

改动 schema 时要记住**同一个 schema 后端也在 `parse`**（如
`submissionDetailSchema.parse` 在路由里），所以收紧一个字段前先用生产数据核一遍，
否则一条不符合的历史记录会让整个列表 500。

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
