# OJ2 镜像。一次构建产出两个 target：
#
#   api  —— 单二进制后端（serve / worker / sql-child 三个子命令共用一份运行时）
#   web  —— Caddy + 前端构建产物
#
# 构建上下文是**仓库根**，不是 docker/：
#   docker compose -f docker/compose.debian.yml build
#
# ## 产物从哪来：ARTIFACTS
#
# 两个产物（后端单二进制 + 前端 dist）可以在镜像里现编，也可以用外面编好的：
#
#   ARTIFACTS=build     （默认）builder 阶段自己编。服务器上手动部署走这条，
#                       只要有 docker 就行，不依赖 CI、不依赖别处传产物。
#   ARTIFACTS=prebuilt  直接拿构建上下文里现成的 dist/oj2-api 和 apps/web/dist，
#                       builder 阶段整个不进构建图（连 bun 镜像都不会拉）。
#
# ⚠️ prebuilt 省时间的前提是 **BuildKit**：只有它按依赖图构建、跳过用不到的阶段。
# 没装 buildx 的机器上 compose 会退回 classic builder，那个把所有阶段挨个跑一遍，
# 于是 builder 照样编一次，产物白编（结果仍然正确，只是没省下时间）。
# docker/deploy.sh --prebuilt 会检查并提醒。
#
# 加这个开关是因为服务器性能差：builder 里 1238 个包的 bun install + bun compile +
# vite build，首次约 5 分钟，光前端就 160s。GitHub Actions 的 runner 编完 rsync
# 过来，服务器这边只剩几条 COPY。见 .github/workflows/deploy.yml。
#
# 两条路都得留着 —— CI 挂了 / 改不动网络时，服务器上 `docker/deploy.sh` 原样能跑。
#
# 手工产出 prebuilt 产物（仓库根）：
#   bun install --frozen-lockfile
#   bun run --filter '@oj2/api' build      # → dist/oj2-api
#   cd apps/web && bun run build           # → apps/web/dist
#
ARG ARTIFACTS=build

# 旧后端是一个容器里用 supervisord 跑 caddy + gunicorn + dramatiq 三个进程。
# 这里拆开：Docker 自己就是进程管理器，拆开之后 worker 挂了能单独重启、
# 也能单独看日志，少一层 supervisord 要维护。

# ---------------------------------------------------------------- 构建
FROM oven/bun:1 AS builder
WORKDIR /build

# 走国内镜像源。不是图快（总耗时差不多），是图能装上：
# mermaid@9.4.3 那个 11.9MB 的包从容器里连 registry.npmjs.com 稳定失败
# （主机上没问题，容器网络这一跳过不去），换源之后 1238 个包一次装齐。
# 这个包是机房老 Chrome 的 mermaid-legacy 依赖，不能砍。
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=${NPM_REGISTRY}

# 先只拷 manifest，依赖没变时这一层能命中缓存。
# bunfig.toml 必须一起拷：它设了 linker = "hoisted"，漏掉的话容器里会用默认的
# isolated 布局（包都在 node_modules/.bun/ 下），于是本地靠"提升"才解析得到的包
# 在容器里一律 Could not resolve —— 而本地构建始终是好的，只有镜像构建才炸。
# 真正的修法是把直接 import 的包声明成直接依赖（已做），这里让两边布局一致是第二道保险。
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
# 重试两次：网络抖动不该让整次构建从头再来
RUN bun install --frozen-lockfile \
  || bun install --frozen-lockfile \
  || bun install --frozen-lockfile

# 源码**分开拷**，别用 `COPY . .`：那样任何一个文件变了都会一次作废下面两条
# 构建，只改了后端也得陪着重编一次前端（160s）。
#
# 顺序是「先前端后后端」，因为 Dockerfile 的缓存是链式的 —— 一层失效，后面全失效。
# 慢的那条要待在更靠前、更不容易被碰到的位置：
#   只改 apps/api → 前端两层命中缓存，只重编后端（bun compile，几秒）
#   只改 apps/web → 前端重编，后端跟着重编，但那点时间无所谓
#   改 packages/contract → 两边都重编（本来就都依赖它，是对的）
#
# 加新的顶层目录 / 根文件时注意：builder 只看得见这里点名拷进来的东西。
COPY tsconfig.base.json ./
COPY packages/contract packages/contract

# 前端：产物直接进镜像，不走挂载。
# 一次构建 = 一个版本，切换那天不会出现「后端换了前端忘了拷」这种半新半旧状态。
COPY apps/web apps/web
RUN cd apps/web && bun run build

# 后端：编译成不依赖 node_modules 的单二进制。
# 能这么编是因为 wasm / 原生模块 / 词典都在源码里用 `with { type: "file" }`
# 内嵌成了资源，详见 apps/api/src/vendor/jieba.ts 的注释。
COPY apps/api apps/api
RUN bun build --compile --target=bun-linux-x64 apps/api/src/main.ts --outfile /build/oj2-api

# ---------------------------------------------------------------- 产物来源
# 两个来源都归一成同样的布局（/artifacts/oj2-api、/artifacts/web），下面的运行时
# 阶段只认这个布局，不关心产物是谁编的。
#
# 用 scratch 是因为这里只是「摆放文件」，不需要任何基底；这两个阶段也不会单独产出
# 镜像，只被 COPY --from 引用。
#
# BuildKit 只构建进了依赖图的阶段：选 prebuilt 时 builder 和 oven/bun 镜像
# 完全不参与，选 build 时下面那条 `COPY dist/oj2-api` 不存在也不报错。
FROM scratch AS artifacts-build
COPY --from=builder /build/oj2-api /artifacts/oj2-api
COPY --from=builder /build/apps/web/dist /artifacts/web

FROM scratch AS artifacts-prebuilt
COPY dist/oj2-api /artifacts/oj2-api
COPY apps/web/dist /artifacts/web

# 变量阶段名，取值来自顶部那个全局 ARG
FROM artifacts-${ARTIFACTS} AS artifacts

# ---------------------------------------------------------------- 后端运行时
# 用 debian 基底而不是 alpine：内嵌的 jieba 原生模块是 linux-x64-**gnu**，
# musl 基底跑不起来（换基底必须同步改 vendor/jieba.ts 里写死的导入）。
FROM debian:trixie-slim AS api
ENV NODE_ENV=production

# clang-format 给 C 代码格式化用，对应旧镜像 apt 装的那个。
#
# **不装 ca-certificates。** AI 接口那条 https 出站不需要它 —— Bun 和 Node 一样
# 内嵌了一份根证书，走自己那份，不读系统的 `/etc/ssl/certs`。实测：把探针二进制
# 丢进裸 debian:trixie-slim（没有 ca-certificates）请求 api.deepseek.com，
# 握手正常、返回 401（没带 key），和装了的镜像行为一致。
# 哪天镜像里加了用 OpenSSL 做 TLS 的东西（curl、wget 之类），这条要重新考虑。
#
# apt 走国内镜像源，理由和上面的 npm 源一样：deb.debian.org 从服务器上
# `apt-get update` 会卡死（不是慢，是挂住不返回）。
#
# 两个坑：
# 1. trixie 的源是 deb822 格式，在 `/etc/apt/sources.list.d/debian.sources`，
#    不是老的 `/etc/apt/sources.list`（那个文件在这个基底里是空的）。
# 2. **必须保持 http，不能换成 https** —— 镜像里没有根证书（见上），
#    https 源会直接证书校验失败。
#
# 只替换主机名：清华同时提供 /debian 和 /debian-security，路径不用动。
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends clang-format \
  && rm -rf /var/lib/apt/lists/*

# ruff 给 Python 代码格式化用。旧后端是 pip 装的 ruff==0.15.12，这里取同版本的
# 官方静态二进制 —— 不为它引入整个 Python 运行时。
COPY --from=ghcr.io/astral-sh/ruff:0.15.12 /ruff /usr/local/bin/ruff

COPY --from=artifacts /artifacts/oj2-api /usr/local/bin/oj2-api

# 迁移文件**不内嵌进二进制**，随镜像装在这个固定路径下（apps/api/src/runtime.ts
# 的 migrationsDir 写死的就是它）。这样 drizzle 的 migrate() 能原样用 —— 它靠
# meta/_journal.json 自动发现迁移，新增迁移不用改任何代码。内嵌的话得为每条迁移
# 手写一行 import，那是迟早会漏的账。
#
# 只拷 .sql 和 journal，不拷 meta/*_snapshot.json（那是 drizzle-kit generate 用的，
# 运行时不读，几百 KB 没必要进镜像）。
COPY apps/api/src/db/*.sql /usr/local/share/oj2/migrations/
COPY apps/api/src/db/meta/_journal.json /usr/local/share/oj2/migrations/meta/

# /data 下是要持久化的东西：测试用例、上传的图片、头像。
# 相对路径按 cwd 解析（见 apps/api/src/runtime.ts），所以 workdir 设成 /data；
# 但下面的路径全写绝对值，不靠这个巧合。
#
# 目录布局**照抄旧后端**（test_case、public/upload、public/avatar）。
# 这不是审美问题：切换那天不用搬动任何文件，回滚时旧后端也立刻能找到自己的数据。
# 少一次几十 GB 的 mv，就少一个在停机窗口里出错的机会。
WORKDIR /data
ENV TEST_CASE_DIRECTORY=/data/test_case \
    HITOKOTO_DIRECTORY=/data/hitokoto \
    UPLOAD_DIRECTORY=/data/public/upload \
    AVATAR_DIRECTORY=/data/public/avatar \
    PORT=3000

EXPOSE 3000
# 默认起 HTTP 服务；worker 容器在 compose 里把 command 换成 ["oj2-api","worker"]
CMD ["oj2-api", "serve"]

# ---------------------------------------------------------------- 前端 + 反代
FROM caddy:2-alpine AS web
COPY --from=artifacts /artifacts/web /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8000
