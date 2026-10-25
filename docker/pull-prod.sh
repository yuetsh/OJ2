#!/usr/bin/env bash
#
# 把服务器上的最新数据拉到本机 dev：数据库整库换掉，可选把测试点、题面图片、头像一起同步。
# 统计、画设计稿、实跑验证都要真实数据，原来靠手工备份 → 拷回来 → 恢复，每次都要重踩
# docs/deploy.md「备份与灾难恢复」里那两个坑。
#
# ## 用法（在本机跑）
#
#   docker/pull-prod.sh                  # 只换库
#   docker/pull-prod.sh --files          # 换库 + 同步测试点、题面图片、头像
#   docker/pull-prod.sh --files-only     # 只同步文件，库不动
#   docker/pull-prod.sh --force          # 本机 dev 还连着库也照换（断开它们，dev 会自己重连）
#   PROD_HOST=debian docker/pull-prod.sh # ssh 的主机名，默认就是 debian（~/.ssh/config 里的别名）
#
# 换下来的旧库改名成 onlinejudge_prev 留着，后悔了：
#
#   docker exec oj2-postgres psql -U onlinejudge -d postgres \
#     -c 'drop database onlinejudge' -c 'alter database onlinejudge_prev rename to onlinejudge'
#
# 拉完如果本机代码比线上新（有还没上线的迁移），再跑一次 `bun run db:migrate`。
#
# ## 对服务器只读
#
# 服务器上只跑 pg_dump（单个快照事务，不锁表，学生照常提交）和 rsync 的读端。
# 服务器只有 2 核，pg_dump 会占一个核十几秒 —— 上课时间（工作日 8–17 点）会提醒一句。
#
# ## 几个刻意的做法
#
# - **只导 onlinejudge 这一个库，不用 pg_dumpall**。pg_dumpall 带角色和口令，灌回来会把
#   本机 onlinejudge 的口令改成线上的，.env 里的 DATABASE_URL 当场连不上（deploy.md 的坑 1）。
#   pg_dump -Fc + pg_restore --no-owner --no-privileges 只搬数据和结构。
# - **先落盘、验完再灌**。直接 `ssh ... | pg_restore` 网络一断就是半个库。落盘的 dump 先
#   pg_restore -l 读一遍目录，读不出来就不往下走。
# - **灌进新库再换名，不在原库上 --clean**。原库连着 dev 的 api / worker 时，--clean 的
#   DROP TABLE 会卡在锁上（deploy.md 的坑 2）；灌新库不用停 dev，只有最后换名那一下要求
#   没人连着。灌到一半失败，原库原封不动。
# - **dump 存仓库外面**（默认 <仓库上级>/backups，和 backup-db.sh 一处），umask 077：
#   里面有 user.raw_password 明文。只留最近 3 份 prod_pull_*.dump。
# - **文件同步不带 --delete**。本机后台出题时生成的测试点只在本机，镜像过来会把它们删掉。
#   不带 owner / group / 权限：线上是 root 的，本机要你自己和判题沙箱都读得了。
#
# 本机库换成线上的之后，账号口令也都是线上的了 —— 自己在本机改过的测试口令要重设。

# 同 backup-db.sh：被 sh 调起时换成 bash，pipefail 是 bash 专有的
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_DIR="$PWD"

PROD_HOST="${PROD_HOST:-debian}"
REMOTE_CONTAINER="${REMOTE_CONTAINER:-oj-postgres}"
# 服务器 docker/.env 里的 DATA_DIR
REMOTE_DATA="${REMOTE_DATA:-/root/OJDeploy/data}"
LOCAL_CONTAINER="${LOCAL_CONTAINER:-oj2-postgres}"
DB_USER=onlinejudge
DB_NAME=onlinejudge
INCOMING="${DB_NAME}_incoming"
PREV="${DB_NAME}_prev"
OUT_DIR="${BACKUP_DIR:-$(dirname "$REPO_DIR")/backups}"
KEEP=3

DO_DB=1
DO_FILES=0
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --files)      DO_FILES=1; shift ;;
    --files-only) DO_FILES=1; DO_DB=0; shift ;;
    --force)      FORCE=1; shift ;;
    *) echo "未知参数：$1（可用：--files、--files-only、--force）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

# drop database if exists 在库不存在时会打一条 NOTICE，正常情况不该有噪音
local_psql() { docker exec -e PGOPTIONS="-c client_min_messages=warning" "$LOCAL_CONTAINER" psql -U "$DB_USER" -v ON_ERROR_STOP=1 "$@"; }
# ssh 把参数拼成一行交给远端的 shell 重新拆，'select 1' 这种带空格的参数会被拆成两个。
# 逐个 %q 转义之后再拼，远端拆出来的才和这边写的一样
remote()     { ssh -o BatchMode=yes "$PROD_HOST" "$(printf '%q ' "$@")"; }

# 本机除了这个脚本自己以外，还有谁连着 onlinejudge（dev 的 api、worker、开着的 psql）
others_connected() {
  local_psql -d postgres -tAc \
    "select count(*) from pg_stat_activity where datname = '$DB_NAME' and pid <> pg_backend_pid()" \
    | tr -d '[:space:]'
}

# ---------------------------------------------------------------- 自检
say "自检"

remote true 2>/dev/null \
  || die "ssh $PROD_HOST 连不上（BatchMode，不会问口令）。先确认 ssh $PROD_HOST 能直接登进去"
ok "ssh $PROD_HOST 通"

if [ "$DO_DB" -eq 1 ]; then
  remote docker exec "$REMOTE_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1 \
    || die "服务器上连不上 $REMOTE_CONTAINER 里的 $DB_NAME。容器名不对就用 REMOTE_CONTAINER=... 指定"
  ok "服务器的 $REMOTE_CONTAINER 能连上"

  docker ps --filter "name=^/${LOCAL_CONTAINER}\$" --filter status=running -q | grep -q . \
    || die "本机容器 $LOCAL_CONTAINER 没在跑，先 bun run db:up"
  ok "本机的 $LOCAL_CONTAINER 在跑"

  # 换名那一步才真正要求没人连着，但在下载之前就先说，省得白等
  n=$(others_connected)
  if [ "${n:-0}" != 0 ]; then
    [ "$FORCE" -eq 1 ] \
      || die "本机还有 $n 个连接连着 $DB_NAME（多半是 bun run dev 的 api / worker）。
   停掉 dev 再跑，或者加 --force：换名前断开它们，dev 会自己重连到新库"
    warn "本机有 $n 个连接，--force 已指定，换名前会断开"
  fi

  # 服务器的时钟是 UTC 还是东八区不确定，按 TZ 显式取东八区（大陆没有夏令时）
  read -r dow hour < <(TZ=Asia/Shanghai date '+%u %-H')
  if [ "$dow" -le 5 ] && [ "$hour" -ge 8 ] && [ "$hour" -lt 17 ]; then
    warn "现在是上课时间，服务器只有 2 核，pg_dump 会占一个核十几秒"
  fi
fi

# ---------------------------------------------------------------- 导出
if [ "$DO_DB" -eq 1 ]; then
  say "从 $PROD_HOST 导出 $DB_NAME"

  mkdir -p "$OUT_DIR" || die "建不了目录 $OUT_DIR"
  umask 077
  stamp=$(date +%Y_%m_%d_%H_%M_%S)
  target="$OUT_DIR/prod_pull_${stamp}.dump"
  partial="${target}.partial"
  trap 'rm -f "$partial"' EXIT INT TERM

  started=$(date +%s)
  # 不给 docker exec 加 -t、ssh 也不分配 TTY：-Fc 是二进制，经过 TTY 会被改坏
  remote docker exec "$REMOTE_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$partial" \
    || die "pg_dump 失败（半截文件已删）"
  elapsed=$(( $(date +%s) - started ))

  # 读得出目录才算完整的 dump。用本机容器里的 pg_restore 读，宿主机不一定装了
  toc=$(docker exec -i "$LOCAL_CONTAINER" pg_restore -l < "$partial" 2>/dev/null | grep -c ' TABLE DATA ' || true)
  [ "${toc:-0}" -gt 0 ] || die "dump 读不出表数据目录，文件是坏的（已删）"
  mv -- "$partial" "$target"
  trap - EXIT INT TERM
  ok "$(basename "$target") — $(du -h "$target" | cut -f1)，$toc 张表的数据，用时 ${elapsed}s"

  # 线上此刻的提交数，灌完拿来对。dump 是之前那一刻的快照，所以本机只会 ≤ 它
  remote_count=$(remote docker exec "$REMOTE_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    'select count(*) from submission' | tr -d '[:space:]')

  # ---------------------------------------------------------------- 灌进新库
  say "灌进本机的 $INCOMING"

  local_psql -d postgres -qc "drop database if exists $INCOMING" \
    -c "create database $INCOMING owner $DB_USER"
  # --exit-on-error：任何一条失败就停，别留一个缺表的库被换上去
  docker exec -i "$LOCAL_CONTAINER" pg_restore -U "$DB_USER" -d "$INCOMING" \
    --no-owner --no-privileges --exit-on-error < "$target" \
    || die "pg_restore 失败，原来的 $DB_NAME 没动。$INCOMING 留着方便看哪里坏了"

  local_count=$(local_psql -d "$INCOMING" -tAc 'select count(*) from submission' | tr -d '[:space:]')
  [ "${local_count:-0}" -gt 0 ] || die "灌完 submission 是空的，不换。原来的 $DB_NAME 没动"
  if [ -n "$remote_count" ] && [ "$local_count" -gt "$remote_count" ]; then
    die "灌完 submission $local_count 条，比线上此刻的 $remote_count 还多 —— 不对劲，不换"
  fi
  if [ "$local_count" = "${remote_count:-}" ]; then
    ok "submission $local_count 条，和线上此刻一样"
  else
    ok "submission $local_count 条（线上此刻 ${remote_count:-?} 条，差的是导出之后新交的）"
  fi

  # ---------------------------------------------------------------- 换名
  say "换上新库"

  n=$(others_connected)
  if [ "${n:-0}" != 0 ]; then
    [ "$FORCE" -eq 1 ] \
      || die "灌的这会儿又有 $n 个连接连上了 $DB_NAME。停掉 dev 再跑一次换名，或者加 --force。
   新库已经在 $INCOMING 里，手工换：
     docker exec $LOCAL_CONTAINER psql -U $DB_USER -d postgres \\
       -c 'drop database if exists $PREV' \\
       -c 'alter database $DB_NAME rename to $PREV' \\
       -c 'alter database $INCOMING rename to $DB_NAME'"
  fi
  # 断开连接和换名放在同一个 psql 里，中间不给 dev 的连接池留重连的空当
  local_psql -d postgres -q \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB_NAME' and pid <> pg_backend_pid()" \
    -c "drop database if exists $PREV" \
    -c "alter database $DB_NAME rename to $PREV" \
    -c "alter database $INCOMING rename to $DB_NAME" >/dev/null \
    || die "换名失败。看一下 pg_database 里现在是什么：
     docker exec $LOCAL_CONTAINER psql -U $DB_USER -d postgres -c '\\l'"
  ok "$DB_NAME 换成了线上的，原来的改名成 $PREV"

  # ---------------------------------------------------------------- 只留最近几份
  old=$(find "$OUT_DIR" -maxdepth 1 -type f -name 'prod_pull_*.dump' -printf '%T@ %p\n' \
    | sort -rn | tail -n +"$((KEEP + 1))" | cut -d' ' -f2-)
  if [ -n "$old" ]; then
    printf '%s\n' "$old" | while IFS= read -r f; do rm -f -- "$f"; done
    ok "删掉 $(printf '%s\n' "$old" | wc -l) 份旧的 dump，只留最近 $KEEP 份"
  fi
fi

# ---------------------------------------------------------------- 文件
if [ "$DO_FILES" -eq 1 ]; then
  say "同步文件"
  command -v rsync >/dev/null || die "本机没装 rsync"

  # 线上路径（DATA_DIR 下）→ 本机路径（apps/api/src/config.ts 的默认值）
  sync_dir() {
    local from="$1" to="$2"
    mkdir -p "$to"
    rsync -rltz --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
      "$PROD_HOST:$REMOTE_DATA/$from/" "$to/" \
      || die "rsync $from 失败"
    ok "$from → ${to#"$REPO_DIR"/}（$(du -sh "$to" | cut -f1)）"
  }
  sync_dir backend/test_case     "$REPO_DIR/data/test_case"
  sync_dir backend/public/upload "$REPO_DIR/data/upload"
  sync_dir backend/public/avatar "$REPO_DIR/data/avatar"
fi

say "完成"
if [ "$DO_DB" -eq 1 ]; then
  printf '    本机代码比线上新的话，再跑一次：bun run db:migrate\n'
  printf '    账号口令现在都是线上的了，本机改过的测试口令要重设\n\n'
fi
