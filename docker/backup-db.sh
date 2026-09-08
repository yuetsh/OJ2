#!/usr/bin/env bash
#
# 备份线上数据库：pg_dumpall 全量（所有库 + 所有角色），带校验和保留策略。
#
# ## 为什么不走 docker compose exec
#
# 线上是**外接形态**：postgres 容器由 /root/OJDeploy/docker-compose.yml 起，不归
# OJ2 这套 compose 管。compose.debian.yml 里虽然也定义了 oj-postgres，但它挂着
# `profiles: ["local-data"]`，只在「自带数据」形态下才启动。所以在 OJ2 目录里跑
#
#   docker compose exec -T oj-postgres pg_dumpall ...
#
# 会报 `service "oj-postgres" is not running` —— 容器明明在跑，只是属于另一个
# compose 项目。这里直接按容器名 `docker exec`，跟谁起的无关，两种形态都能用。
#
# ## 用法
#
#   docker/backup-db.sh                          # 备份到 <仓库上级>/backups
#   docker/backup-db.sh --out /mnt/backup        # 指定目录
#   docker/backup-db.sh --plain                  # 不压缩（默认 gzip）
#   docker/backup-db.sh --keep-days 30           # 保留 30 天（默认 14）
#   docker/backup-db.sh --force                  # 磁盘余量不足也照做
#   CONTAINER=oj2-postgres docker/backup-db.sh   # 本机 dev
#
# ## 定时跑
#
#   crontab -e
#   30 3 * * * /root/OJDeploy/OJ2/docker/backup-db.sh >> /var/log/oj-backup.log 2>&1
#
# cron 的 PATH 很短，docker 一般在 /usr/bin 里，通常够用；真找不到就写绝对路径。
#
# ## 恢复时这几条报错是正常的
#
#   ERROR:  database "xxx" does not exist        DROP 一个目标机上没有的库
#   ERROR:  current user cannot be dropped       正连着的角色删不掉
#   ERROR:  role "onlinejudge" already exists    角色已经在了
#
# pg_dumpall -c 生成的是「先删后建」，往一个干净实例灌的时候这几条必然出现，
# 不影响结果。恢复完对一下行数才是准的：
#
#   select count(*) from submission;
#
# ## 几个刻意的做法
#
# - **不给 docker exec 加 -t**。分配了 TTY，导出的 SQL 行尾会变成 CRLF，恢复时炸。
#   （`-T` 更是压根不存在于 `docker exec`，那是 `docker compose exec` 的参数，
#   照抄过来会直接报错。）
# - **先写 .partial，验完才改名**。`> db_backup_xxx.sql` 这种写法一旦中途失败
#   —— 容器挂了、磁盘满了、pg_dumpall 报错 —— 留下的是个半截文件，看着像备份，
#   等到要恢复的那天才发现不是。
# - **验完整性**：pg_dumpall 正常结束的最后一行是「PostgreSQL database cluster
#   dump complete」。没有这行就当失败，删掉重来。
# - **umask 077**。备份里有 user.raw_password（明文密码，本来就是留给老师查的）
#   和所有角色的口令散列，不该是 644。
# - **默认存到仓库外面**。deploy 那条 rsync 带 `--delete`，备份放在仓库目录里，
#   下次部署就被删了。
#
# 只管数据库。判题测试点在 data/backend/test_case，不在库里，那份要另外备。

# `sh docker/backup-db.sh` 会用 dash 跑（Debian 的 /bin/sh 就是 dash），而下面那行
# 的 pipefail 是 bash 专有的，一上来就报 `Illegal option -o pipefail`。
# 这行必须在 set 之前，且只能用 dash 也认的语法。deploy.sh 里是同一道垫片。
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_DIR="$PWD"

CONTAINER="${CONTAINER:-oj-postgres}"
DB_USER="${DB_USER:-onlinejudge}"
OUT_DIR="${BACKUP_DIR:-$(dirname "$REPO_DIR")/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# 保留策略再狠也不动最新的这几份 —— 服务器时钟错乱、或者 --keep-days 手滑填了 0，
# 都不该把手头唯一的备份删掉
KEEP_MIN=3
COMPRESS=1
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out)       OUT_DIR="${2:?--out 后面要跟目录}"; shift 2 ;;
    --keep-days) KEEP_DAYS="${2:?--keep-days 后面要跟天数}"; shift 2 ;;
    --plain)     COMPRESS=0; shift ;;
    --force)     FORCE=1; shift ;;
    *) echo "未知参数：$1（可用：--out、--keep-days、--plain、--force）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

human() {
  awk -v b="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", u, " "); i = 1
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    printf "%.1f %s\n", b, u[i]
  }'
}

# ---------------------------------------------------------------- 自检
say "自检"

docker ps --filter "name=^/${CONTAINER}\$" --filter status=running -q | grep -q . \
  || die "容器 $CONTAINER 没在跑。用 CONTAINER=... 指定容器名；外接形态下它由
   /root/OJDeploy/docker-compose.yml 起：
   docker compose -f /root/OJDeploy/docker-compose.yml up -d $CONTAINER"

# 用 psql 真连一次，不用 pg_isready：后者只探「服务在不在」，DB_USER 写错照样说 OK，
# 要等到 pg_dumpall 那步才炸出一句 role does not exist
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc 'select 1' >/dev/null 2>&1 \
  || die "连不上 $CONTAINER 里的 postgres（用户 $DB_USER）—— 服务没起，或者用 DB_USER=... 指定用户"
ok "容器 $CONTAINER 在跑，$DB_USER 能连上"

mkdir -p "$OUT_DIR" || die "建不了备份目录 $OUT_DIR"
case "$OUT_DIR/" in
  "$REPO_DIR"/*) warn "备份目录在仓库里 —— deploy 的 rsync --delete 会把它删掉" ;;
esac
ok "备份目录 $OUT_DIR"

# datallowconn 是为了跳过 template0：它不让连，pg_database_size 也算不了
db_bytes=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "select coalesce(sum(pg_database_size(datname)), 0)::bigint from pg_database where datallowconn" \
  2>/dev/null | tr -d '[:space:]' || true)
[ -n "${db_bytes:-}" ] || db_bytes=0

free_bytes=$(df -Pk "$OUT_DIR" | awk 'NR == 2 { print $4 * 1024 }')
ok "库 $(human "$db_bytes")，磁盘剩 $(human "$free_bytes")"

if [ "$db_bytes" -gt 0 ] && [ "$free_bytes" -lt "$db_bytes" ]; then
  [ "$FORCE" -eq 1 ] \
    || die "磁盘余量比库还小。压缩后通常小一个数量级，确认够用就加 --force
   —— 备份把生产磁盘写满，比没有备份更糟"
  warn "磁盘余量不足，--force 已指定，继续"
fi

# ---------------------------------------------------------------- 导出
say "导出"

stamp=$(date +%Y_%m_%d_%H_%M_%S)
target="$OUT_DIR/db_backup_${stamp}.sql"
[ "$COMPRESS" -eq 1 ] && target="${target}.gz"
partial="${target}.partial"

# 明文密码在里面，别落成 644
umask 077
# 中途失败（含 Ctrl-C）不留半截文件冒充备份
trap 'rm -f "$partial"' EXIT INT TERM

started=$(date +%s)
if [ "$COMPRESS" -eq 1 ]; then
  # pipefail 已开：pg_dumpall 挂了整条管道就算失败，不会只看 gzip 的返回码
  docker exec "$CONTAINER" pg_dumpall -c -U "$DB_USER" | gzip -c > "$partial"
else
  docker exec "$CONTAINER" pg_dumpall -c -U "$DB_USER" > "$partial"
fi
elapsed=$(( $(date +%s) - started ))

# ---------------------------------------------------------------- 校验
say "校验"

if [ "$COMPRESS" -eq 1 ]; then
  gzip -t "$partial" 2>/dev/null || die "gzip 自检没过，文件是坏的（已删）"
  ok "gzip 完整"
  ending=$(gzip -cd "$partial" | tail -5)
else
  ending=$(tail -5 "$partial")
fi

printf '%s\n' "$ending" | grep -q 'database cluster dump complete' \
  || die "结尾没有「PostgreSQL database cluster dump complete」，导出不完整（已删）
   最后几行：
$ending"
ok "结尾正常，导出完整"

mv -- "$partial" "$target"
trap - EXIT INT TERM
chmod 600 "$target"

size_bytes=$(wc -c < "$target")
ok "$(basename "$target") — $(human "$size_bytes")，用时 ${elapsed}s"

# ---------------------------------------------------------------- 保留
say "保留 $KEEP_DAYS 天"

# 按 mtime 倒序取最新的几份，它们无论多旧都不删
protected=$(find "$OUT_DIR" -maxdepth 1 -type f -name 'db_backup_*.sql*' -printf '%T@ %p\n' \
  | sort -rn | head -n "$KEEP_MIN" | cut -d' ' -f2-)

removed=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  case $'\n'"$protected"$'\n' in
    *$'\n'"$old"$'\n'*) continue ;;
  esac
  rm -f -- "$old" && removed=$((removed + 1))
done < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'db_backup_*.sql*' -mtime "+$KEEP_DAYS")

kept=$(find "$OUT_DIR" -maxdepth 1 -type f -name 'db_backup_*.sql*' | wc -l)
ok "删掉 $removed 份过期的，现存 $kept 份（最新 $KEEP_MIN 份永远保留）"

say "完成"
printf '    %s\n\n' "$target"
printf '    恢复（会先 DROP 再建，确认连的是对的实例；开头几条 does not exist\n'
printf '    / already exists 是正常的，见本脚本头部）：\n'
if [ "$COMPRESS" -eq 1 ]; then
  printf '      gzip -cd %s | docker exec -i %s psql -U %s -d postgres\n\n' \
    "$target" "$CONTAINER" "$DB_USER"
else
  printf '      docker exec -i %s psql -U %s -d postgres < %s\n\n' \
    "$CONTAINER" "$DB_USER" "$target"
fi
