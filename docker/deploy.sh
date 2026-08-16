#!/usr/bin/env bash
#
# 从本机把 OJ2 推到服务器并重启新栈（并行试跑形态）。
#
#   docker/deploy.sh                       # 推代码 → 构建 → 重启 → 自检
#   docker/deploy.sh --env                 # 连 docker/.env 一起推（默认不推，见下）
#   SERVER=root@1.2.3.4 docker/deploy.sh   # 换台机器
#
# 默认**不推 docker/.env**：本机那份和服务器那份很容易不是一回事（库地址、端口、
# AI key 都不同），覆盖掉是静默故障。确实要同步时显式加 --env。
#
# 这是没有 git remote 时的临时方案。配好 remote 之后应该换成服务器上 git pull，
# 那样服务器上有版本记录，也不会把本机的脏改动带上去。

set -euo pipefail

SERVER=${SERVER:-root@xuyue.cc}
REMOTE_DIR=${REMOTE_DIR:-/root/OJDeploy/OJ2}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE="docker compose -f docker/compose.debian.yml --env-file docker/.env"

PUSH_ENV=0
[ "${1:-}" = "--env" ] && PUSH_ENV=1

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. 推代码
say "1/4 同步代码 → $SERVER:$REMOTE_DIR"

excludes=(
  --exclude node_modules
  --exclude .git
  --exclude data          # 运行时数据，服务器上那份才是真的
  --exclude 'apps/web/dist'
)
if [ "$PUSH_ENV" -eq 0 ]; then
  excludes+=(--exclude 'docker/.env' --exclude 'docker/.env.*' --include 'docker/.env.example')
fi

# --delete 让服务器和本机一致（被 --exclude 排除的文件不会被删，rsync 默认保护）
rsync -az --delete --info=stats1 "${excludes[@]}" "$REPO/" "$SERVER:$REMOTE_DIR/"

# ---------------------------------------------------------------- 2-4. 服务器上
ssh "$SERVER" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "\$*"; }
die() { printf '\n\033[1;31m❌ %s\033[0m\n' "\$*" >&2; exit 1; }

[ -f docker/.env ] || die "$REMOTE_DIR/docker/.env 不存在，先把 env 放上去（内容见手册第三节）"

say "2/4 起栈前自检"

# 这一条是切换当天唯一会静默走歪的地方：DATA_DIR 没生效的话，卷会挂到 OJ2/data
# 这个空目录上 —— 站点起得来，但没有测试点、题面图片 404，而且不报任何错。
bad=\$($COMPOSE config | grep 'source:' | grep 'OJ2/data' || true)
[ -z "\$bad" ] || die "DATA_DIR 没生效，这些卷指向了 OJ2/data：\$(printf '\n%s' "\$bad")"

# 同理：DB_HOST 空着会静默回落成 oj-postgres，而试跑形态下那个容器根本没起
$COMPOSE config | grep -q 'DATABASE_URL: postgres://[^@]*@oj-postgres' \
  && die "DB_HOST 没生效，DATABASE_URL 还指着 oj-postgres（试跑形态下它不存在）" || true

# 判题机运行目录必须和旧栈分开，不然两个 judger 往一个目录里写
judge_dir=\$(grep -E '^JUDGE_STATE_DIR=' docker/.env | cut -d= -f2- || true)
[ -n "\$judge_dir" ] || die "JUDGE_STATE_DIR 没设，会和旧判题机共用运行目录"
mkdir -p "\$judge_dir/log" "\$judge_dir/run"

say "3/4 构建镜像（首次约 5 分钟）"
$COMPOSE build

say "4/4 起栈"
$COMPOSE up -d
$COMPOSE ps

# 等 oj-api 变 healthy，最多 60 秒
for i in \$(seq 30); do
  status=\$(docker inspect -f '{{.State.Health.Status}}' oj-api 2>/dev/null || echo starting)
  [ "\$status" = healthy ] && break
  sleep 2
done
[ "\$status" = healthy ] || die "oj-api 没起来（状态 \$status），看 docker logs oj-api --tail 50"

port=\$(grep -E '^WEB_PORT=' docker/.env | cut -d= -f2- || echo 8080)
port=\${port:-8080}

say "自检（端口 \$port）"
printf '首页          %s\n' "\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:\$port/)"
printf '站点配置      %s\n' "\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:\$port/api/site)"
printf '未登录进后台  %s（期望 401）\n' "\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:\$port/api/admin/dashboard)"

total=\$(curl -s "http://localhost:\$port/api/problems" | grep -oE '"total":[0-9]+' | head -1 | cut -d: -f2)
printf '题目总数      %s\n' "\${total:-读不出来}"
[ "\${total:-0}" -gt 0 ] || die "题目数是 0 —— 连错库了，八成是 DB_HOST 或 POSTGRES_PASSWORD 不对"

printf '\n\033[1;32m✅ 完成。别忘了 NPM 那台 proxy host 指向 %s，且 Websockets Support 是开的。\033[0m\n' "\$port"
REMOTE
