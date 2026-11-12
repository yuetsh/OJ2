#!/usr/bin/env bash
#
# 构建「数据分析」运行器镜像（本机构建，产物用 docker save 传到服务器，和判题机一个路数）。
#
#   docker/lab/build.sh                 # 构建并打 tag
#   docker/lab/build.sh --save          # 顺便导出 tar（给 scp 用）
#   docker/lab/build.sh --no-cache      # 不吃构建缓存
#   docker/lab/build.sh --no-mirror     # 不走国内镜像源（默认走）
#
# 上传和切换见 docker/lab/README.md。

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# **改了库版本、字体或 runner 的代码就把末尾序号 +1**（下一版叫 oj2-lab-3），别在同一个名字上重建 ——
# compose 的 `up -d` 不带 --pull，名字没变就会静默用机器上的旧镜像。
IMAGE=oj2-lab-2

SAVE=0
BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --save)     SAVE=1 ;;
    --no-cache) BUILD_ARGS+=(--no-cache) ;;
    --no-mirror)
      BUILD_ARGS+=(
        --build-arg APT_MIRROR=http://deb.debian.org/debian
        --build-arg APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
        --build-arg PIP_INDEX_URL=https://pypi.org/simple
      ) ;;
    *) echo "未知参数：$arg（可用：--save、--no-cache、--no-mirror）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "没装 docker"
[ -f docker/lab/Dockerfile ] || die "docker/lab/Dockerfile 不见了，当前目录：$PWD"

say "构建 $IMAGE"
docker build "${BUILD_ARGS[@]}" -t "$IMAGE" docker/lab
ok "$IMAGE  $(docker image inspect "$IMAGE" --format '{{.Size}}' | numfmt --to=iec)"

if [ "$SAVE" = 1 ]; then
  out="dist/$IMAGE.tar"
  mkdir -p dist
  say "导出 $out"
  docker save "$IMAGE" -o "$out"
  ok "$(du -h "$out" | cut -f1)  →  scp 到服务器后 docker load -i"
fi
