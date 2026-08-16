# OJ2 镜像。一次构建产出两个 target：
#
#   api  —— 单二进制后端（serve / worker / sql-child 三个子命令共用一份运行时）
#   web  —— Caddy + 前端构建产物
#
# 构建上下文是**仓库根**，不是 docker/：
#   docker compose -f docker/compose.debian.yml build
#
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

COPY . .

# 后端：编译成不依赖 node_modules 的单二进制。
# 能这么编是因为 wasm / 原生模块 / 词典都在源码里用 `with { type: "file" }`
# 内嵌成了资源，详见 apps/api/src/vendor/jieba.ts 的注释。
RUN bun build --compile --target=bun-linux-x64 apps/api/src/main.ts --outfile /build/oj2-api

# 前端：产物直接进镜像，不走挂载。
# 一次构建 = 一个版本，切换那天不会出现「后端换了前端忘了拷」这种半新半旧状态。
RUN cd apps/web && bun run build

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

COPY --from=builder /build/oj2-api /usr/local/bin/oj2-api

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
COPY --from=builder /build/apps/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8000
