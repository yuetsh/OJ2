#!/usr/bin/env bash
#
# 一次性运维动作：清掉所有会话，强制全员重新登录。
#
# ## 为什么要跑
#
# 会话的反向索引 `user-sessions:<uid>` 是 498fc1c 才加的。在那之前签发的会话不在索引
# 里，revokeUserSessions 靠 SMEMBERS 找不到它们 —— 也就是说**改密码、重置密码、禁用
# 账号对这批会话统统无效**，只能等最长一个 SESSION_TTL_SECONDS（默认 7 天）自然过期。
#
# 学生密码是明文存着给老师查的，改密码正是密码泄露之后唯一的补救手段，这个空窗不能留。
# 代价只是所有人重新登录一次。
#
# 跑过一次就不用再跑了：此后签发的会话都带索引。
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
# 这里只删 `session:*` 和 `user-sessions:*`。
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

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1 \
  || die "连不上容器 $CONTAINER 里的 redis（用 CONTAINER=... 指定容器名）"

# 用 SCAN 而不是 KEYS：KEYS 会阻塞住整个 Redis，而这上面还挂着判题队列和所有人的
# 会话读写。xargs 分批是因为单条 DEL 传太多 key 会顶到命令行长度上限；每批 DEL 返回
# 删掉的个数，累加起来就是总数。
purge() {
  docker exec "$CONTAINER" redis-cli --scan --pattern "$1" 2>/dev/null \
    | xargs -r -n 400 docker exec "$CONTAINER" redis-cli del \
    | awk '{ sum += $1 } END { print sum + 0 }'
}

count() { docker exec "$CONTAINER" redis-cli --scan --pattern "$1" 2>/dev/null | wc -l; }

say "容器 $CONTAINER"
before_sessions=$(count 'session:*')
before_index=$(count 'user-sessions:*')
before_bull=$(count 'bull:*')
printf '    session:*        %s\n' "$before_sessions"
printf '    user-sessions:*  %s\n' "$before_index"
printf '    bull:*           %s（不动）\n' "$before_bull"

if [ "${YES:-}" != "1" ]; then
  read -rp $'\n    删掉上面的会话、让所有人重新登录？[y/N] ' answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || die "已取消，什么都没做"
fi

say "清理"
ok "session:*        删掉 $(purge 'session:*') 个"
ok "user-sessions:*  删掉 $(purge 'user-sessions:*') 个"

after_bull=$(count 'bull:*')
[ "$after_bull" = "$before_bull" ] \
  || die "判题队列的键数变了（$before_bull → $after_bull），这不该发生，请人工检查"
ok "bull:* 仍是 $after_bull 个，判题队列没被动过"

say "完成 —— 另一个站点的 Redis 也要跑一遍"
