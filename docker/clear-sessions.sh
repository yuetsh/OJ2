#!/usr/bin/env bash
#
# 运维动作：清掉所有会话，强制全员重新登录。
#
# 会话是 `auth-session:<sid>`（见 apps/api/src/auth/session.ts），删掉之后 access token
# 下一个请求就不认、refresh token 也换不出新的，不用等 token 自然过期。
# 顺带清掉 cookie 时代留下的 `session:*` / `user-sessions:*`（换成 token 之后没人读了，
# 不清的话也会在 7 天内自己过期）。
#
# 只想让某一个人下线不用跑这个：后台改密码 / 禁用账号就会把他所有设备踢下线。
#
# ## 两个站点都要跑
#
# 机房和服务器**共用一个数据库，但各有各的 Redis**（见 compose.school.yml 头部）。
# 会话存在各自的 Redis 里，只清一边等于只解决一半。
#
# ## 为什么不是 FLUSHALL
#
# 同一个 Redis 里还装着 BullMQ 的判题队列（`bull:*`）。FLUSHALL 会把还在队列里的提交
# 一起丢掉，那些 submission 会永远停在 PENDING，只能超管逐条重判 —— 而重判还会把
# user_profile 的反范式计数带偏（见 apps/api/src/scripts/recount.ts）。
# 这里只删下面列出来的几种会话键。
#
# ## 用法
#
#   docker/clear-sessions.sh                      # 容器名默认 oj-redis
#   CONTAINER=oj2-redis docker/clear-sessions.sh  # 本机 dev
#   YES=1 docker/clear-sessions.sh                # 跳过确认
#
# `sh docker/clear-sessions.sh` 会用 dash 跑（Debian 的 /bin/sh 就是 dash），而下面
# 那行的 pipefail 是 bash 专有的，一上来就报 `Illegal option -o pipefail`。
# 这行必须在 set 之前，且只能用 dash 也认的语法。deploy.sh 里是同一道垫片。
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

CONTAINER="${CONTAINER:-oj-redis}"

# redis 带口令时（服务器那台），redis-cli 靠 REDISCLI_AUTH 认证。没显式给就从
# docker/.env 里读；机房和本机 dev 的 redis 不带口令，读不到就留空，不影响。
if [ -z "${REDIS_PASSWORD:-}" ] && [ -f "$(dirname "$0")/.env" ]; then
  REDIS_PASSWORD=$(grep -E '^REDIS_PASSWORD=' "$(dirname "$0")/.env" | tail -1 | cut -d= -f2- || true)
fi
# 口令为空时连 -e 都不能带：空的 REDISCLI_AUTH 会让 redis-cli 发一条 AUTH ""，
# 在不带口令的 redis 上报一行 AUTH failed（实测，虽然随后命令照常执行）。
EXEC=(docker exec)
[ -z "${REDIS_PASSWORD:-}" ] || EXEC+=(-e REDISCLI_AUTH="$REDIS_PASSWORD")
EXEC+=("$CONTAINER" redis-cli)
cli() { "${EXEC[@]}" "$@"; }

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

[ "$(cli ping 2>/dev/null)" = PONG ] \
  || die "连不上容器 $CONTAINER 里的 redis（用 CONTAINER=... 指定容器名；带口令的话检查 REDIS_PASSWORD）"

# 用 SCAN 而不是 KEYS：KEYS 会阻塞住整个 Redis，而这上面还挂着判题队列和所有人的
# 会话读写。xargs 分批是因为单条 DEL 传太多 key 会顶到命令行长度上限；每批 DEL 返回
# 删掉的个数，累加起来就是总数。
purge() {
  cli --scan --pattern "$1" 2>/dev/null \
    | xargs -r -n 400 "${EXEC[@]}" del \
    | awk '{ sum += $1 } END { print sum + 0 }'
}

count() { cli --scan --pattern "$1" 2>/dev/null | wc -l; }

PATTERNS=('auth-session:*' 'auth-contest:*' 'session:*' 'user-sessions:*')

say "容器 $CONTAINER"
for pattern in "${PATTERNS[@]}"; do
  printf '    %-16s %s\n' "$pattern" "$(count "$pattern")"
done
before_bull=$(count 'bull:*')
printf '    %-16s %s（不动）\n' 'bull:*' "$before_bull"

if [ "${YES:-}" != "1" ]; then
  read -rp $'\n    删掉上面的会话、让所有人重新登录？[y/N] ' answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || die "已取消，什么都没做"
fi

say "清理"
for pattern in "${PATTERNS[@]}"; do
  ok "$(printf '%-16s' "$pattern") 删掉 $(purge "$pattern") 个"
done

after_bull=$(count 'bull:*')
[ "$after_bull" = "$before_bull" ] \
  || die "判题队列的键数变了（$before_bull → $after_bull），这不该发生，请人工检查"
ok "bull:* 仍是 $after_bull 个，判题队列没被动过"

say "完成 —— 另一个站点的 Redis 也要跑一遍"
