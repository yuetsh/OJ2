# 判题沙箱镜像。**这是 QingdaoU/JudgeServer 官方 Dockerfile 的分叉**，
# 只改工具链版本，server/ 和 Judger/ 的代码一行都没动（构建时从上游仓库
# 的固定 commit 拉，见 build.sh）。
#
# 为什么要分叉：上游停更在 2024-04-05（b28aa56，也就是 1.6.1 这个 tag），
# registry 上的 `latest` 和 `1.6.1` 是同一份镜像，没有新版可升。想要新编译器
# 只能自己构建。
#
# 相对上游的全部改动：
#   gcc/g++  13      → 14      (trixie 默认)
#   Python   3.12    → 3.13    (trixie 默认)
#   Go / JDK / Node  → **整套删掉**（见下）
#
# 只留 C / C++ / Python3 的工具链：前端的语言复选框从来只给这三种加 SQL，
# 生产库 12 万条提交里 Java/Golang/JavaScript 一共 62 条、全是很早以前的。
# 删掉 golang-1.24-go、temurin-25-jdk、nodejs 之后镜像从 1.16GB 掉到 ~500MB，
# 构建也少了 NodeSource 那个 39MB 的 deb（它没有可用的国内镜像，最慢的一块）。
# 想恢复某种语言：这里加回包 + alternatives，同时改 apps/api/src/judge/languages.ts。
#
# ⚠️ 语言的编译/运行命令**不在这个文件里**，在 apps/api/src/judge/languages.ts。
#    升 gcc 大版本要同步看那边的开关（gcc-14 把 implicit-function-declaration
#    等提成了 error，languages.ts 里有三个 -Wno-error 把它压回去）。

# 镜像源。默认走国内镜像 —— 官方源在这边实测 197 KB/s，清华 3.9 MB/s，
# 整个构建从 12 分钟掉到 2 分钟出头。出国内网络环境用 build.sh --no-mirror 关掉。
#
# ⚠️ debian 这两个只能用 **http**：改 sources 这一步发生在装 ca-certificates 之前，
#    base 镜像里没有 CA 根证书，https 一律 `certificate verify failed`。
#    PyPI 那条是 pip 自己请求的，pip 内置 certifi，不依赖系统 CA。
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

FROM debian:trixie-slim AS builder
ARG TARGETARCH
ARG TARGETVARIANT
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
ARG PIP_INDEX_URL

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cahce-1-$TARGETARCH$TARGETVARIANT-builder,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,id=apt-cahce-2-$TARGETARCH$TARGETVARIANT-builder,sharing=locked \
    <<EOS
set -ex
rm -f /etc/apt/apt.conf.d/docker-clean
echo 'Binary::apt::APT::Keep-Downloaded-Packages "1";' > /etc/apt/apt.conf.d/keep-cache
echo 'APT::Install-Recommends "0";' > /etc/apt/apt.conf.d/no-recommends
echo 'APT::AutoRemove::RecommendsImportant "0";' >> /etc/apt/apt.conf.d/no-recommends
# 换镜像源。debian-security 必须先换：它的 URI 以 debian 的 URI 为前缀，
# 反过来的话第二条 sed 会把它改成 <镜像>/debian-security，路径不存在。
sed -i "s|http://deb.debian.org/debian-security|$APT_SECURITY_MIRROR|; s|http://deb.debian.org/debian|$APT_MIRROR|" /etc/apt/sources.list.d/debian.sources
apt-get update
apt-get install -y libtool make cmake libseccomp-dev gcc python3 python3-venv
EOS

COPY Judger/ /app/
RUN <<EOS
set -ex
mkdir /app/build
cmake -S . -B build
cmake --build build --parallel $(nproc)
EOS

RUN <<EOS
set -ex
cd bindings/Python
python3 -m venv .venv
.venv/bin/pip3 install -i "$PIP_INDEX_URL" build
.venv/bin/python3 -m build -w
EOS

FROM debian:trixie-slim
ARG TARGETARCH
ARG TARGETVARIANT
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
ARG PIP_INDEX_URL

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cahce-1-$TARGETARCH$TARGETVARIANT-final,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,id=apt-cahce-2-$TARGETARCH$TARGETVARIANT-final,sharing=locked \
    <<EOS
set -ex
rm -f /etc/apt/apt.conf.d/docker-clean
echo 'Binary::apt::APT::Keep-Downloaded-Packages "1";' > /etc/apt/apt.conf.d/keep-cache
echo 'APT::Install-Recommends "0";' > /etc/apt/apt.conf.d/no-recommends
echo 'APT::AutoRemove::RecommendsImportant "0";' >> /etc/apt/apt.conf.d/no-recommends
needed="python3.13-minimal \
    python3.13-venv \
    libpython3.13-stdlib \
    libpython3.13-dev \
    gcc-14 \
    g++-14 \
    strace"
savedAptMark="$(apt-mark showmanual) $needed"
# 换镜像源。debian-security 必须先换：它的 URI 以 debian 的 URI 为前缀，
# 反过来的话第二条 sed 会把它改成 <镜像>/debian-security，路径不存在。
sed -i "s|http://deb.debian.org/debian-security|$APT_SECURITY_MIRROR|; s|http://deb.debian.org/debian|$APT_MIRROR|" /etc/apt/sources.list.d/debian.sources
apt-get update
apt-get install -y $needed
# languages.ts 里的编译/运行命令写的是绝对路径（/usr/bin/gcc、/usr/bin/python3 …），
# 全靠下面这几条 alternatives 挂出来。换包名必须同步改，漏一条的表现是 CE 而不是报错。
update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 14
update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 14
update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 13
apt-mark auto '.*' > /dev/null
apt-mark manual $savedAptMark
apt-get purge -y --auto-remove
EOS

COPY --from=builder --chmod=755 --link /app/output/libjudger.so /usr/lib/judger/libjudger.so
COPY --from=builder /app/bindings/Python/dist/ /app/
RUN --mount=type=cache,target=/root/.cache/pip,id=pip-cahce-$TARGETARCH$TARGETVARIANT-final \
    <<EOS
set -ex
python3 -m venv .venv
CC=gcc .venv/bin/pip3 install -i "$PIP_INDEX_URL" --compile --no-cache-dir flask gunicorn idna psutil requests
.venv/bin/pip3 install *.whl
EOS

COPY server/ /app/
RUN <<EOS
set -ex
chmod -R u=rwX,go=rX /app/
chmod +x /app/entrypoint.sh
gcc -shared -fPIC -o unbuffer.so unbuffer.c
useradd -u 901 -r -s /sbin/nologin -M compiler
useradd -u 902 -r -s /sbin/nologin -M code
useradd -u 903 -r -s /sbin/nologin -M -G code spj
mkdir -p /usr/lib/judger
EOS

# 构建期自检：这五行任何一个不是预期版本，说明上面的包名或 alternatives 配错了。
RUN <<EOS
set -ex
gcc --version
g++ --version
python3 --version
EOS

HEALTHCHECK --interval=5s CMD [ "/app/.venv/bin/python3", "/app/service.py" ]
EXPOSE 8080
ENTRYPOINT [ "/app/entrypoint.sh" ]
