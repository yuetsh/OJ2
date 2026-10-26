#!/usr/bin/env bash
#
# 构建判题沙箱镜像（本机构建，产物用 docker save 传到服务器和机房）。
#
#   docker/judge/build.sh                 # 构建并打 tag
#   docker/judge/build.sh --save          # 顺便导出 tar（给 scp 用）
#   docker/judge/build.sh --no-cache      # 不吃构建缓存
#   docker/judge/build.sh --no-mirror     # 不走国内镜像源（默认走）
#
# 镜像 = go-judge 官方镜像里的那个二进制 + debian 的 gcc / python。构建上下文就是
# docker/judge/ 这个目录（Dockerfile + mount.yaml）。
#
# 上传和切换见 docker/judge/README.md。

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# 我们自己构建的第几版判题镜像（官方 JudgeServer 算第 1 版，自己重编的 JudgeServer
# 是第 2 版，换成 go-judge 是第 3 版）。
# **改工具链就把末尾的序号 +1**（下一版叫 oj2-judge-4），别在同一个名字上重建 ——
# compose 的 `up -d` 不带 --pull，名字没变就会静默用机器上的旧镜像。
IMAGE=oj2-judge-3

SAVE=0
BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --save)     SAVE=1 ;;
    --no-cache) BUILD_ARGS+=(--no-cache) ;;
    # 默认用国内镜像源（Dockerfile 顶部的 ARG）。在能直连的网络里用这个关掉，
    # 换回 deb.debian.org。
    --no-mirror)
      BUILD_ARGS+=(
        --build-arg APT_MIRROR=http://deb.debian.org/debian
        --build-arg APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
      ) ;;
    *) echo "未知参数：$arg（可用：--save、--no-cache、--no-mirror）" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m❌ %s\033[0m\n\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "没装 docker"
[ -f docker/judge/Dockerfile ] || die "docker/judge/Dockerfile 不见了，当前目录：$PWD"

say "构建 $IMAGE"
docker build "${BUILD_ARGS[@]}" -t "$IMAGE" docker/judge
ok "$IMAGE"

say "镜像里的工具链"
docker run --rm --entrypoint sh "$IMAGE" -c '
  printf "gcc      %s\n" "$(gcc -dumpfullversion)"
  printf "g++      %s\n" "$(g++ -dumpfullversion)"
  printf "python3  %s\n" "$(python3 -V | cut -d" " -f2)"
  printf "go-judge %s\n" "$(go-judge -version | head -1)"
'

if [ "$SAVE" = 1 ]; then
  out="dist/${IMAGE/:/-}.tar"
  mkdir -p dist
  say "导出 $out"
  docker save "$IMAGE" -o "$out"
  ok "$(du -h "$out" | cut -f1)  →  scp 到服务器后 docker load -i"
fi
