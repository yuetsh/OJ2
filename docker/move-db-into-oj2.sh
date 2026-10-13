#!/usr/bin/env bash
#
# 一次性：把服务器上的 postgres / redis 从旧栈那份 /root/OJDeploy/docker-compose.yml
# 搬进 OJ2 的 compose.debian.yml，顺带 PostgreSQL 16 → 18、Redis 7 → 8。
# 搬完以后服务器上的全部容器都归 OJ2 管，旧 compose 文件里那两个服务就没用了。
#
#   cd /root/OJDeploy/OJ2
#   docker/move-db-into-oj2.sh              # 服务器自己编镜像（慢，但不依赖 CI）
#   docker/move-db-into-oj2.sh --prebuilt   # 用 CI rsync 过来的产物
#
# ## 跑之前
#
# 1. **挑没课的时候。** 两个站点共用这个库，中间两边都用不了。镜像先在旧栈照常服务时
#    编好，真正停机的只有「备份 → 恢复 → 起栈」那一段。
# 2. **机房那台先停应用**（库在这边，机房连着它就恢复不了）：
#      docker compose -f docker/compose.school.yml --env-file docker/.env.school stop oj-api oj-worker
#    没停的话脚本会查出来还有谁连着库，报出 IP 后中止。
# 3. **docker/.env 的 POSTGRES_PASSWORD 换成强口令**（openssl rand -hex 32）。
#    原来的口令是默认的 onlinejudge，而这个账号是超级用户、5445 对公网开着 ——
#    知道默认口令的人就能拿到整个库，还能在容器里执行命令。新库直接用新口令建，
#    脚本不接受弱口令。机房的 .env.school 要改成同一个值。
#
# ## 它做什么
#
#   自检 → 编镜像 → 停本机 api/worker → 确认没人连着旧库 → 记行数 → 备份
#   → 停掉并删除旧的 postgres / redis 容器 → 起本栈的 PostgreSQL 18 / Redis 8
#   → 恢复 → 收集统计信息 → 核对行数和网络登录 → docker/deploy.sh --no-build
#
# 旧库的数据目录 `$DATA_DIR/postgres`（16）**一个字节都不动**，新库在
# `$DATA_DIR/postgresql`。Redis 的 `$DATA_DIR/redis` 新旧共用，8 直接读 7 的 dump.rdb。
#
# ## 恢复时口令为什么要剥掉
#
# pg_dumpall 会带一句 `ALTER ROLE onlinejudge ... PASSWORD 'md5…'`，原样灌进去会把新库
# 的口令改回旧的 md5 哈希。而 18 的镜像新建的库 pg_hba 只认 scram-sha-256，md5 存的
# 口令**永远验不过** —— 容器里 docker exec psql 走本地 socket 是 trust，看着一切正常，
# 只有 api 和机房从网络连进来才炸。所以恢复时把那个 PASSWORD 子句删掉，库里留下的就是
# 初始化时按 POSTGRES_PASSWORD 存的 SCRAM 哈希。
#
# ## 中途失败
#
# 停旧容器之前失败：什么都没动，`docker start oj-api oj-worker` 就回去了（容器还是原来的
# 配置）。别用 `docker compose ... start`：新的 compose 里 api 依赖本栈的 oj-postgres，
# 这时它还不存在，compose 直接拒绝。
# 之后失败：旧库目录原样在，回退见 docs/deploy.md「把库搬进 OJ2」。

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
COMPOSE=(docker compose -f docker/compose.debian.yml --env-file docker/.env)

for arg in "$@"; do
  case "$arg" in
    --prebuilt) export ARTIFACTS=prebuilt ;;
    *) echo "未知参数：$arg（可用：--prebuilt）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }
envget() { grep -E "^$1=" docker/.env | tail -1 | cut -d= -f2- || true; }

# ---------------------------------------------------------------- 自检
say "自检"

[ -f docker/.env ] || die "docker/.env 不存在"

data_dir=$(envget DATA_DIR)
[ -n "$data_dir" ] && [ -d "$data_dir" ] || die "DATA_DIR（$data_dir）没设或不是目录。服务器上应该是 /root/OJDeploy/data"
[ ! -e "$data_dir/postgresql" ] || die "$data_dir/postgresql 已经存在 —— 已经搬过了？
如果是上次搬到一半失败留下的，确认里面没有要的东西，删掉它再跑。"
ok "数据目录 $data_dir"

pg_pw=$(envget POSTGRES_PASSWORD)
[ "${#pg_pw}" -ge 16 ] && [ "$pg_pw" != onlinejudge ] || die "docker/.env 的 POSTGRES_PASSWORD 太弱（不到 16 位，或者还是默认的 onlinejudge）。
这个账号是超级用户、5445 对公网开着。换一个：openssl rand -hex 32
机房的 docker/.env.school 要改成同一个值。"
[[ "$pg_pw" =~ ^[A-Za-z0-9._~-]+$ ]] || die "POSTGRES_PASSWORD 里有 URL 不安全的字符（它会拼进 DATABASE_URL），用 openssl rand -hex 32 生成"
ok "POSTGRES_PASSWORD 是强口令"

redis_pw=$(envget REDIS_PASSWORD)
[ -n "$redis_pw" ] || die "docker/.env 里没有 REDIS_PASSWORD"

# 旧容器按发布的端口找，不按名字：旧 compose 起的容器叫什么不归我们管
old_pg=$(docker ps --filter publish=5445 --format '{{.Names}}' | head -1)
old_redis=$(docker ps --filter publish=5446 --format '{{.Names}}' | head -1)
[ -n "$old_pg" ] || die "没找到发布 5445 的容器（旧的 postgres）。它没在跑？"
[ -n "$old_redis" ] || die "没找到发布 5446 的容器（旧的 redis）。它没在跑？"
for c in "$old_pg" "$old_redis"; do
  files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$c")
  [[ "$files" != *compose.debian.yml* ]] || die "$c 已经是 OJ2 的 compose 起的 —— 已经搬过了"
done
pgver=$(docker exec "$old_pg" psql -U onlinejudge -d onlinejudge -tAc 'show server_version_num')
[ "${pgver:0:2}" = 16 ] || die "$old_pg 是 PostgreSQL $pgver，这个脚本只认 16"
ok "旧 postgres：$old_pg（$(docker inspect -f '{{.Config.Image}}' "$old_pg")）"
ok "旧 redis：$old_redis（$(docker inspect -f '{{.Config.Image}}' "$old_redis")）"

redis_src=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$old_redis")
[ -n "$redis_src" ] || die "$old_redis 的 /data 没挂到宿主机目录上，会话和队列搬不过来"

db_bytes=$(docker exec "$old_pg" psql -U onlinejudge -d postgres -tAc "select pg_database_size('onlinejudge')")
avail=$(( $(df -Pk "$data_dir" | awk 'NR==2 {print $4}') * 1024 ))
[ "$avail" -gt $(( db_bytes * 3 )) ] || die "磁盘余量 $((avail >> 20)) MiB，不到库大小（$((db_bytes >> 20)) MiB）的三倍：新库一份、备份一份，还得留余地"
ok "库 $((db_bytes >> 20)) MiB，磁盘余量 $((avail >> 20)) MiB"

judge_image=$("${COMPOSE[@]}" config | grep -m1 -E '^[[:space:]]*image: oj2-judge' | awk '{print $2}')
docker image inspect "$judge_image" >/dev/null 2>&1 || die "判题镜像 $judge_image 不在本机，见 docker/judge/README.md"

# ---------------------------------------------------------------- 编镜像
# 旧栈这时还在照常服务，编完才开始停机
say "编镜像（旧栈照常服务中）"
"${COMPOSE[@]}" build oj-api oj-worker oj-web
docker pull -q postgres:18-alpine >/dev/null
docker pull -q redis:8-alpine >/dev/null
ok "postgres:18-alpine、redis:8-alpine 已拉取"

# ---------------------------------------------------------------- 停机
say "停本机的 api / worker（从这里开始站点不可用）"
"${COMPOSE[@]}" stop oj-api oj-worker

# 机房的 api / worker 也连着这个库。停没停只能从库这边看
clients=""
for _ in $(seq 15); do
  clients=$(docker exec "$old_pg" psql -U onlinejudge -d postgres -tAc \
    "select string_agg(distinct coalesce(host(client_addr), 'local'), ', ')
       from pg_stat_activity
      where backend_type = 'client backend' and pid <> pg_backend_pid()")
  [ -z "$clients" ] && break
  sleep 2
done
[ -z "$clients" ] || die "还有客户端连着旧库：$clients
多半是机房的 api / worker 没停。停掉它们再跑；要先恢复本机服务的话：
  docker start oj-api oj-worker"
ok "没有客户端连着旧库"

counts_sql="select (select count(*) from submission) || ' ' || (select count(*) from \"user\") || ' ' || (select count(*) from problem)"
before=$(docker exec "$old_pg" psql -U onlinejudge -d onlinejudge -tAc "$counts_sql")
ok "提交 / 用户 / 题目：$before"

# ---------------------------------------------------------------- 备份
say "备份"
backup_dir="${BACKUP_DIR:-$(dirname "$PWD")/backups}"
marker=$(mktemp)
CONTAINER="$old_pg" BACKUP_DIR="$backup_dir" docker/backup-db.sh
backup=$(find "$backup_dir" -maxdepth 1 -name 'db_backup_*.sql.gz' -newer "$marker" | sort | tail -1)
rm -f "$marker"
[ -n "$backup" ] || die "backup-db.sh 跑完了但找不到新的备份文件（$backup_dir）"
ok "备份：$backup"

# ---------------------------------------------------------------- 换容器
say "停掉旧的 postgres / redis"
docker exec -e REDISCLI_AUTH="$redis_pw" "$old_redis" redis-cli save >/dev/null \
  || warn "redis save 失败（口令不对？），会话可能丢，学生重新登录一次就好"
docker stop "$old_pg" "$old_redis" >/dev/null
# 删掉而不只是停：新容器要用同样的名字和端口
docker rm "$old_pg" "$old_redis" >/dev/null
ok "已删除容器 $old_pg、$old_redis（数据目录没动）"

if [ "$redis_src" != "$data_dir/redis" ]; then
  mkdir -p "$data_dir/redis"
  [ -e "$data_dir/redis/dump.rdb" ] || cp -a "$redis_src/." "$data_dir/redis/"
  ok "redis 数据从 $redis_src 拷到 $data_dir/redis"
fi

say "起 PostgreSQL 18 / Redis 8"
"${COMPOSE[@]}" up -d oj-postgres oj-redis

# 不用 pg_isready 等：初始化期间镜像会起一个只听 socket 的临时实例，pg_isready 走
# socket 照样说 OK，这时候灌数据会灌进一个马上要被关掉的实例。走网络连就等得到正式的那个，
# 还顺带验了新口令能不能从网络登录（api 和机房就是这么连的）
tcp_check() {
  docker exec -e PGPASSWORD="$pg_pw" oj-postgres sh -c \
    'psql -h "$(hostname -i | cut -d" " -f1)" -U onlinejudge -d onlinejudge -tAc "select 1"' >/dev/null 2>&1
}
for _ in $(seq 60); do tcp_check && break; sleep 2; done
tcp_check || die "PostgreSQL 18 两分钟没起来，看 docker logs oj-postgres"
ok "PostgreSQL 18 起来了，新口令能从网络登录"

# ---------------------------------------------------------------- 恢复
say "恢复"
log=$(mktemp)
started=$(date +%s)
gzip -cd "$backup" \
  | sed -E "/^ALTER ROLE onlinejudge WITH /s/ PASSWORD '[^']*'//" \
  | docker exec -i oj-postgres psql -q -U onlinejudge -d postgres >/dev/null 2>"$log" || true
# 「先删后建」的 dump 往新实例灌，这两条必然出现（见 backup-db.sh 头部），别的都不该有
unexpected=$(grep 'ERROR' "$log" | grep -v -e 'current user cannot be dropped' -e 'role "onlinejudge" already exists' || true)
[ -z "$unexpected" ] || die "恢复时出了预期之外的错（完整日志 $log）：
$unexpected"
rm -f "$log"
ok "恢复完成，用时 $(( $(date +%s) - started ))s"

docker exec oj-postgres vacuumdb -U onlinejudge --all --analyze-in-stages -q
ok "统计信息已收集"

after=$(docker exec oj-postgres psql -U onlinejudge -d onlinejudge -tAc "$counts_sql")
[ "$after" = "$before" ] || die "行数对不上：恢复前 $before，恢复后 $after"
ok "提交 / 用户 / 题目：$after，和恢复前一致"

tcp_check || die "恢复之后新口令从网络登不上了 —— dump 里的口令没剥干净？
  docker exec -it oj-postgres psql -U onlinejudge -d postgres -c '\\password onlinejudge'"
ok "新口令仍能从网络登录"

# ---------------------------------------------------------------- 起栈
say "起栈（交给 deploy.sh）"
docker/deploy.sh --no-build

cat <<EOF

$(printf '\033[1;32m✅ 搬完了\033[0m')

还剩三件事：

  1. 机房：docker/.env.school 的 POSTGRES_PASSWORD 改成和这边一样的新值，然后
       docker compose -f docker/compose.school.yml --env-file docker/.env.school up -d
  2. /root/OJDeploy/docker-compose.yml 里的 oj-postgres / oj-redis 已经没用了，删掉
     （整个文件都没别的服务的话就删文件）。留着的话哪天有人 up 一下，会和本栈抢端口。
  3. 旧库目录 $data_dir/postgres 留着做回退，跑稳一两周再删。
     备份在 $backup
EOF
