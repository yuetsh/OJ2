#!/usr/bin/env bash
#
# 构建判题沙箱镜像（本机构建，产物用 docker save 传到服务器和机房）。
#
#   docker/judge/build.sh                 # 构建并打 tag
#   docker/judge/build.sh --save          # 顺便导出 tar（给 scp 用）
#   docker/judge/build.sh --no-cache      # 不吃构建缓存
#   docker/judge/build.sh --no-mirror     # 不走国内镜像源（默认走）
#
# 上游 JudgeServer 停更在 2024-04-05，registry 上的 1.6.1 == latest，没有新版
# 可拉。这个脚本从上游那个固定 commit 拉源码（server/ 和 Judger/ 一行不改），
# 只把 Dockerfile 换成 docker/judge/Dockerfile —— 新工具链的全部改动都在那里。
#
# 上传和切换见 docker/judge/README.md。

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# 上游 master HEAD（= tag v1.6.1+judgeserver.1.6.1）。Judger 子模块的版本由这个
# commit 自己钉住（d19a6dc），不用在这里再写一遍。
UPSTREAM_REPO=https://github.com/QingdaoU/JudgeServer.git
UPSTREAM_COMMIT=b28aa56d60fed7358a29d9bdeb9d86fcc06e41a7

# 我们自己重编的第几版判题镜像（官方那个算第 1 版，这是第 2 版）。
# **改工具链就把末尾的序号 +1**（下一版叫 oj2-judge-3），别在同一个名字上重建 ——
# compose 的 `up -d` 不带 --pull，名字没变就会静默用机器上的旧镜像。
IMAGE=oj2-judge-2

SAVE=0
BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --save)     SAVE=1 ;;
    --no-cache) BUILD_ARGS+=(--no-cache) ;;
    # 默认用国内镜像源（Dockerfile 顶部的四个 ARG）。在能直连的网络里用这个关掉，
    # 换回 deb.debian.org / pypi.org。
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
[ -f docker/judge/Dockerfile ] || die "docker/judge/Dockerfile 不见了，当前目录：$PWD"

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT

say "拉上游源码 $UPSTREAM_COMMIT"
git -c advice.detachedHead=false clone --quiet "$UPSTREAM_REPO" "$src"
git -C "$src" -c advice.detachedHead=false checkout --quiet "$UPSTREAM_COMMIT"
git -C "$src" submodule update --quiet --init --recursive
ok "server/ 和 Judger/ 就位"

say "构建 $IMAGE"
# 上下文是上游源码，Dockerfile 用我们自己的那份。
docker build "${BUILD_ARGS[@]}" -f docker/judge/Dockerfile -t "$IMAGE" "$src"
ok "$IMAGE"

say "镜像里的工具链"
docker run --rm --entrypoint sh "$IMAGE" -c '
  printf "gcc     %s\n" "$(gcc -dumpfullversion)"
  printf "g++     %s\n" "$(g++ -dumpfullversion)"
  printf "python3 %s\n" "$(python3 -V | cut -d" " -f2)"
'

if [ "$SAVE" = 1 ]; then
  out="dist/${IMAGE/:/-}.tar"
  mkdir -p dist
  say "导出 $out"
  docker save "$IMAGE" -o "$out"
  ok "$(du -h "$out" | cut -f1)  →  scp 到服务器后 docker load -i"
fi
