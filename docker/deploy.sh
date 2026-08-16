#!/usr/bin/env bash
#
# 在**服务器上**起 OJ2 新栈（并行试跑形态：旧栈的 postgres/redis 继续跑，
# 这里只起 api / worker / web / judge，旧站一个容器都不用停）。
#
#   cd /root/OJDeploy/OJ2
#   docker/deploy.sh              # 自检 → 构建 → 起栈 → 冒烟
#   docker/deploy.sh --check      # 只自检，不动任何容器
#   docker/deploy.sh --no-build   # 跳过构建（只改了 env / compose 时用）
#
# 代码怎么上到服务器不归它管。没有 git remote 的话，在本机：
#
#   rsync -az --delete --exclude node_modules --exclude .git --exclude data \
#     --exclude 'docker/.env*' ~/Projects/OJ/OJ2/ root@服务器:/root/OJDeploy/OJ2/
#
# 前提：docker/.env 已经填好（内容见 docs/specs/phase5-cutover-runbook.md 第三节）。

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE=(docker compose -f docker/compose.debian.yml --env-file docker/.env)

CHECK_ONLY=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --check)    CHECK_ONLY=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "未知参数：$arg（可用：--check、--no-build）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 自检
say "自检"

[ -f docker/.env ] || die "docker/.env 不存在。内容见手册第三节，别用 .env.example 直接改名（里面的值全是空的）"

# compose 版本：depends_on.required 是 v2.20 才有的字段，老版本会解析失败
ver=$(docker compose version --short 2>/dev/null || echo 0)
# 取 min(2.20, ver)：等于 2.20 就说明 ver 不低于它。别用 `sort -V -C`，
# 那个判的是「这两行本来就有序」，对 ver 更新的情况会反过来判成太老（写错过一次）。
[ "$(printf '2.20\n%s\n' "$ver" | sort -V | head -1)" = "2.20" ] \
  || die "docker compose 版本太老（$ver），需要 ≥ 2.20（depends_on.required 是那个版本才有的字段）"
ok "docker compose $ver"

cfg=$("${COMPOSE[@]}" config) || die "compose 配置解析失败，看上面的报错"

# ① DATA_DIR：不生效的话卷会挂到 OJ2/data 这个空目录上 —— 站点起得来，
#    但没有测试点、题面图片 404，而且**不报任何错**。这是唯一会静默走歪的地方。
bad=$(grep 'source:' <<<"$cfg" | grep 'OJ2/data' || true)
[ -z "$bad" ] || die "DATA_DIR 没生效，这些卷指向了 OJ2/data：
$bad

检查 docker/.env 里的 DATA_DIR（注意：DATA_DIR= 空值等于没设，等号两边不能有空格）"
ok "数据卷都在 $(grep 'source:' <<<"$cfg" | head -1 | sed 's|.*source: ||; s|/backend.*||')"

# ② DB_HOST：不生效会静默回落成 oj-postgres，而试跑形态下那个容器根本没起
! grep -q 'DATABASE_URL: postgres://[^@]*@oj-postgres' <<<"$cfg" \
  || die "DB_HOST 没生效，DATABASE_URL 还指着 oj-postgres —— 试跑形态下它不存在，起来必然连不上库"
ok "库指向 $(grep -m1 'DATABASE_URL:' <<<"$cfg" | sed 's|.*@||; s|/onlinejudge.*||')"

# ③ 判题机运行目录必须和旧栈分开，否则两个 judger 往同一个目录里写
judge_dir=$(grep -E '^JUDGE_STATE_DIR=' docker/.env | tail -1 | cut -d= -f2- || true)
[ -n "$judge_dir" ] || die "JUDGE_STATE_DIR 没设 —— 试跑期间新旧两个判题机会共用运行目录"
ok "判题机运行目录 $judge_dir"

# ④ 旧栈的 postgres / redis 得还活着，新栈要连它们
for c in oj-postgres oj-redis; do
  docker ps --filter "name=$c" --filter status=running -q | grep -q . \
    || die "旧栈的 $c 没在跑。试跑形态依赖它们 —— 先 docker compose -f /root/OJDeploy/docker-compose.yml up -d $c"
done
ok "旧栈的 postgres / redis 都在跑"

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

还差 NPM 那一步：
  - proxy host: oj2.xuyue.cc → 宿主机:$port
  - **Websockets Support 必须打开**，否则学生那边「判题中…」永远不动
  - client_max_body_size 200M（上传测试用例压缩包）

之后自己点一遍：登录、提交一道题看结果实时刷出来、后台判题机列表、带图片的题面。
EOF
