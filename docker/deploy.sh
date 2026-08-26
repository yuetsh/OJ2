#!/usr/bin/env bash
#
# 在**服务器上**起 OJ2 新栈（并行试跑形态：旧栈的 postgres/redis 继续跑，
# 这里只起 api / worker / web / judge，旧站一个容器都不用停）。
#
#   cd /root/OJDeploy/OJ2
#   docker/deploy.sh              # 自检 → 构建 → 起栈 → 冒烟
#   docker/deploy.sh --check      # 只自检，不动任何容器
#   docker/deploy.sh --no-build   # 跳过构建（只改了 env / compose 时用）
#   docker/deploy.sh --prebuilt   # 用现成产物，不在这台机器上编（CI 走这条）
#
# 默认（不带 --prebuilt）是**服务器自己编**：只要有 docker 就能跑，不依赖 CI，
# 也不依赖别处传产物过来。代价是这台机器性能差，builder 阶段首次约 5 分钟。
#
# --prebuilt 则要求 dist/oj2-api 和 apps/web/dist 已经在这个目录里（GitHub
# Actions 编好后 rsync 过来的），镜像构建只剩几条 COPY。产物缺失会在自检就拦下。
#
# 代码怎么上到服务器不归它管。没有 git remote 的话，在本机：
#
#   rsync -az --delete --exclude node_modules --exclude .git --exclude data \
#     --exclude 'docker/.env*' ~/Projects/OJ/OJ2/ root@服务器:/root/OJDeploy/OJ2/
#
# 前提：docker/.env 已经填好（内容见 docs/specs/phase5-cutover-runbook.md 第三节）。

# `sh docker/deploy.sh` 会用 dash 跑（Debian 的 /bin/sh 就是 dash），而下面那行
# 的 pipefail 是 bash 专有的，一上来就报 `Illegal option -o pipefail`。
# 这行必须在 set 之前，且只能用 dash 也认的语法。
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE=(docker compose -f docker/compose.debian.yml --env-file docker/.env)

CHECK_ONLY=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --check)    CHECK_ONLY=1 ;;
    --no-build) BUILD=0 ;;
    # compose 里写的是 args: ARTIFACTS: ${ARTIFACTS:-build}，导出即可生效
    --prebuilt) export ARTIFACTS=prebuilt ;;
    *) echo "未知参数：$arg（可用：--check、--no-build、--prebuilt）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 自检
say "自检"

[ -f docker/.env ] || die "docker/.env 不存在。内容见手册第三节，别用 .env.example 直接改名（里面的值全是空的）"

# 部署形态。判据用 DB_HOST 而不是另加一个开关：它本来就决定了 DATABASE_URL 指向谁，
# 两个变量各说各话的话，迟早会出现「起了自带的库、却连到别处」这种自相矛盾的状态。
#
#   DB_HOST 为空 → 自带数据：本栈起 oj-postgres / oj-redis（compose 里挂在 local-data profile 下）
#   DB_HOST 非空 → 外接数据：连别处的库，试跑期间连的是旧栈那两个容器
db_host=$(grep -E '^DB_HOST=' docker/.env | tail -1 | cut -d= -f2- || true)
if [ -z "$db_host" ]; then
  LOCAL_DATA=1
  COMPOSE+=(--profile local-data)
  ok "形态：自带数据（postgres / redis 由本栈起）"
else
  LOCAL_DATA=0
  ok "形态：外接数据（库在 $db_host）"
fi

# compose 版本：depends_on.required 是 v2.20 才有的字段，老版本会解析失败
ver=$(docker compose version --short 2>/dev/null || echo 0)
# 取 min(2.20, ver)：等于 2.20 就说明 ver 不低于它。别用 `sort -V -C`，
# 那个判的是「这两行本来就有序」，对 ver 更新的情况会反过来判成太老（写错过一次）。
[ "$(printf '2.20\n%s\n' "$ver" | sort -V | head -1)" = "2.20" ] \
  || die "docker compose 版本太老（$ver），需要 ≥ 2.20（depends_on.required 是那个版本才有的字段）"
ok "docker compose $ver"

# --prebuilt 时产物就是构建输入。缺了的话 docker 只会甩一句 COPY 找不到文件，
# 这里提前拦下并说清楚该怎么办。
if [ "${ARTIFACTS:-build}" = prebuilt ]; then
  for f in dist/oj2-api apps/web/dist/index.html; do
    [ -e "$f" ] || die "--prebuilt 需要现成产物，但 $f 不存在。

要么让 CI 把产物 rsync 过来（.github/workflows/deploy.yml），
要么去掉 --prebuilt 让这台机器自己编（慢，但不依赖任何外部环节）。"
  done
  ok "用现成产物（$(du -sh dist/oj2-api apps/web/dist 2>/dev/null | tr '\n' ' ')）"

  # 没有 buildx 时 compose 会退回 classic builder（构建日志末尾那行
  # `LABEL com.docker.compose.image.builder=classic` 就是它）。classic **不看
  # 依赖图，所有阶段挨个跑**，于是 builder 照样 bun install + vite build 一遍，
  # 产物白编了 —— 结果是对的，只是一分钟没省下来。
  docker buildx version >/dev/null 2>&1 \
    || warn "没装 buildx，compose 会退回老 builder，它不跳过用不到的阶段
      —— 这次 --prebuilt 省不下时间（结果仍然正确）。
      修：apt-get install docker-buildx-plugin"
else
  ok "产物在镜像里现编（首次约 5 分钟；CI 部署走的是 --prebuilt）"
fi

cfg=$("${COMPOSE[@]}" config) || die "compose 配置解析失败，看上面的报错"

# ① DATA_DIR：不生效的话卷会挂到 OJ2/data 这个空目录上 —— 站点起得来，
#    但没有测试点、题面图片 404，而且**不报任何错**。这是唯一会静默走歪的地方。
bad=$(grep 'source:' <<<"$cfg" | grep 'OJ2/data' || true)
[ -z "$bad" ] || die "DATA_DIR 没生效，这些卷指向了 OJ2/data：
$bad

检查 docker/.env 里的 DATA_DIR（注意：DATA_DIR= 空值等于没设，等号两边不能有空格）"
ok "数据卷都在 $(grep 'source:' <<<"$cfg" | head -1 | sed 's|.*source: ||; s|/backend.*||')"

# ② 库指向必须和形态一致，两个方向都要查
if [ "$LOCAL_DATA" -eq 0 ]; then
  # 外接：DB_HOST 不生效会静默回落成 oj-postgres，而这形态下本栈不起那个容器
  ! grep -q 'DATABASE_URL: postgres://[^@]*@oj-postgres' <<<"$cfg" \
    || die "DB_HOST 没生效，DATABASE_URL 还指着 oj-postgres —— 外接形态下本栈不起它，必然连不上库"
else
  # 自带：反过来必须指向服务名 + 容器内端口。连 :5432 一起查，是因为清了 DB_HOST 却
  # 忘了清 DB_PORT 的话会拼出 oj-postgres:5445 —— 那是宿主机映射端口，容器网络里不通。
  grep -q 'DATABASE_URL: postgres://[^@]*@oj-postgres:5432/' <<<"$cfg" \
    || die "自带数据形态（DB_HOST 为空），但 DATABASE_URL 指向 $(grep -m1 'DATABASE_URL:' <<<"$cfg" | sed 's|.*@||; s|/onlinejudge.*||')。
docker/.env 里 DB_PORT / REDIS_PORT 是不是也得一并清空？"
fi
ok "库指向 $(grep -m1 'DATABASE_URL:' <<<"$cfg" | sed 's|.*@||; s|/onlinejudge.*||')"

# ②b 自带形态下数据目录必须已经是一个 16 版本的库。
#     这是整个部署里唯一会**静默**走歪的地方：目录不对的话 postgres 当成全新部署，
#     在空目录上初始化一个空库 —— 站点起得来、能注册能登录，就是一道题都没有。
if [ "$LOCAL_DATA" -eq 1 ]; then
  data_dir=$(grep -E '^DATA_DIR=' docker/.env | tail -1 | cut -d= -f2- || true)
  [ -n "$data_dir" ] || die "自带数据形态必须显式设 DATA_DIR。
默认值 ../data 解析出来是 OJ2/data，那是个空目录，postgres 会在上面初始化一个全新的空库，而且不报任何错。"
  pgver_file="$data_dir/postgres/PG_VERSION"
  [ -f "$pgver_file" ] || die "找不到 $pgver_file —— DATA_DIR 指的不是一个已有的 postgres 数据目录。
就这么起下去会得到一个空库。确认 DATA_DIR=$data_dir 对不对。"
  pgver=$(cat "$pgver_file")
  [ "$pgver" = 16 ] || die "$data_dir/postgres 是 PostgreSQL $pgver 的数据目录，但 compose 里是 postgres:16-alpine，起不来。"
  ok "数据目录 $data_dir/postgres（PostgreSQL $pgver）"
fi

# ③ 判题机运行目录必须和旧栈分开，否则两个 judger 往同一个目录里写
judge_dir=$(grep -E '^JUDGE_STATE_DIR=' docker/.env | tail -1 | cut -d= -f2- || true)
[ -n "$judge_dir" ] || die "JUDGE_STATE_DIR 没设 —— 试跑期间新旧两个判题机会共用运行目录"
ok "判题机运行目录 $judge_dir"

# ④ 外接形态才需要预检：库不归本栈管，得确认它已经活着。
#    自带形态下这两个容器就是本栈自己起的，起栈那步会拉起来，这里没什么可查。
if [ "$LOCAL_DATA" -eq 0 ]; then
  for c in oj-postgres oj-redis; do
    docker ps --filter "name=$c" --filter status=running -q | grep -q . \
      || die "外接形态依赖的 $c 没在跑 —— 先 docker compose -f /root/OJDeploy/docker-compose.yml up -d $c"
  done
  ok "外接的 postgres / redis 都在跑"
else
  ok "postgres / redis 由本栈起，不预检"
fi

port=$(grep -E '^WEB_PORT=' docker/.env | tail -1 | cut -d= -f2- || true)
port=${port:-8080}
ok "对外端口 $port"

[ "$CHECK_ONLY" -eq 0 ] || { printf '\n\033[1;32m✅ 自检通过（--check，没动容器）\033[0m\n'; exit 0; }

# ---------------------------------------------------------------- 起栈
mkdir -p "$judge_dir/log" "$judge_dir/run"

if [ "$BUILD" -eq 1 ]; then
  say "构建镜像（首次约 5 分钟，之后走缓存很快）"
  "${COMPOSE[@]}" build
fi

# ---------------------------------------------------------------- 迁移
# 在起栈**之前**跑：schema 先就位，新代码再启动。
#
# **不要加 --no-deps。** `run` 只会拉起被点名服务的依赖，而 oj-api 的依赖恰好就是
# oj-postgres / oj-redis：
#   · 自带数据形态 —— 必须靠它把 postgres 起来，否则这一步连不上库（加过 --no-deps，
#     踩过这个坑）。depends_on 的 condition: service_healthy 还顺带保证了库真的就绪。
#   · 外接形态 —— 那两个服务不在启用的 profile 里，depends_on 上的 required: false
#     让 compose 直接跳过，不会多起任何东西。
# 两种形态下 worker / web 都不会被带起来，它们不是 api 的依赖。
#
# 含 DROP TABLE 这类破坏性语句的迁移会被拦下并退出 4，需要显式放行：
#   OJ2_ALLOW_DESTRUCTIVE=1 docker/deploy.sh
# 放行前先备份。这道闸门在 apps/api/src/db/migrate.ts。
say "数据库迁移"
"${COMPOSE[@]}" run --rm \
  -e OJ2_ALLOW_DESTRUCTIVE="${OJ2_ALLOW_DESTRUCTIVE:-}" \
  api oj2-api migrate \
  || die "迁移没通过，已中止部署（旧容器还在跑，没动过）。
上面的输出说明了原因。破坏性迁移需要 OJ2_ALLOW_DESTRUCTIVE=1 显式放行。"

say "起栈"
"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" ps

status=starting
for _ in $(seq 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' oj-api 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 2
done
[ "$status" = healthy ] || die "oj-api 没起来（状态 $status）
看日志：docker logs oj-api --tail 50"

# ---------------------------------------------------------------- 冒烟
say "冒烟（端口 $port）"
code() { curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$1"; }
printf '    首页          %s\n' "$(code /)"
printf '    站点配置      %s\n' "$(code /api/site)"
printf '    未登录进后台  %s  (期望 401)\n' "$(code /api/admin/dashboard)"

total=$(curl -s "http://localhost:$port/api/problems" | grep -oE '"total":[0-9]+' | head -1 | cut -d: -f2 || true)
printf '    题目总数      %s\n' "${total:-读不出来}"
[ "${total:-0}" -gt 0 ] || die "题目数是 0 —— 连的不是生产库。查 DB_HOST / POSTGRES_PASSWORD"

cat <<EOF

$(printf '\033[1;32m✅ 起来了\033[0m')

  https://oj2.xuyue.cc  （NPM 反代已配好，指向宿主机:$port）

NPM 那边是一次性的，只有改了 WEB_PORT 才要回去动 proxy host 的端口。另外两项
别关：Websockets Support（关了学生那边「判题中…」永远不动）、
client_max_body_size 200M（上传测试用例压缩包）。

自己点一遍：登录、提交一道题看结果实时刷出来、后台判题机列表、带图片的题面。
EOF
