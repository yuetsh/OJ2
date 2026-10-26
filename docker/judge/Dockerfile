# 判题沙箱镜像：go-judge（https://github.com/criyle/go-judge）+ 我们要的工具链。
#
# go-judge 只管「在沙箱里跑一条命令」：编译、逐个测试点运行、比对输出、算状态码
# 都在 api 那边（apps/api/src/judge/sandbox.ts）。所以这个镜像里只有两样东西：
# go-judge 的单个二进制，和学生程序要用的编译器 / 解释器。
#
# 2026-10 从 QingdaoU/JudgeServer 换过来的（那边停更在 2024-04，而且 gunicorn 按
# 核数起 worker，16 核的机器空闲就占 300MB）。换的原因和逐份对比的结论见 README.md。
#
#   gcc / g++  14     (trixie 默认)
#   Python     3.13   (trixie 默认)
#
# ⚠️ 语言的编译/运行命令**不在这个文件里**，在 apps/api/src/judge/languages.ts。
#    升 gcc 大版本要同步看那边的开关（gcc-14 把 implicit-function-declaration
#    等提成了 error，languages.ts 里有几个 -Wno-error 把它压回去）。
# ⚠️ 换 Python 大版本时，api 镜像（docker/Dockerfile 的 python3-minimal）要一起换，
#    理由见 README.md。

# go-judge 的版本。升级前看一眼它的 release notes 里有没有改 /run 的出入参。
ARG GO_JUDGE_VERSION=v1.13.3

# 镜像源。默认走国内镜像 —— 官方源在这边实测 197 KB/s，清华 3.9 MB/s。
# 出国内网络环境用 build.sh --no-mirror 关掉。
#
# ⚠️ 只能用 **http**：改 sources 这一步发生在装 ca-certificates 之前，
#    base 镜像里没有 CA 根证书，https 一律 `certificate verify failed`。
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security

FROM criyle/go-judge:${GO_JUDGE_VERSION} AS go-judge

FROM debian:trixie-slim
ARG TARGETARCH
ARG TARGETVARIANT
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR

ENV DEBIAN_FRONTEND=noninteractive

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cahce-1-$TARGETARCH$TARGETVARIANT-final,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,id=apt-cahce-2-$TARGETARCH$TARGETVARIANT-final,sharing=locked \
    <<EOS
set -ex
rm -f /etc/apt/apt.conf.d/docker-clean
echo 'Binary::apt::APT::Keep-Downloaded-Packages "1";' > /etc/apt/apt.conf.d/keep-cache
echo 'APT::Install-Recommends "0";' > /etc/apt/apt.conf.d/no-recommends
echo 'APT::AutoRemove::RecommendsImportant "0";' >> /etc/apt/apt.conf.d/no-recommends
# debian-security 必须先换：它的 URI 以 debian 的 URI 为前缀，
# 反过来的话第二条 sed 会把它改成 <镜像>/debian-security，路径不存在。
sed -i "s|http://deb.debian.org/debian-security|$APT_SECURITY_MIRROR|; s|http://deb.debian.org/debian|$APT_MIRROR|" /etc/apt/sources.list.d/debian.sources
apt-get update
# 和换掉的 JudgeServer 镜像同一组包（去掉了它自己要的 venv / dev / strace），
# 学生程序能 import 的标准库模块因此一个不少
apt-get install -y python3.13-minimal libpython3.13-stdlib gcc-14 g++-14
# languages.ts 里的编译/运行命令写的是绝对路径（/usr/bin/gcc、/usr/bin/python3 …），
# 全靠下面这几条 alternatives 挂出来。换包名必须同步改，漏一条的表现是 CE 而不是报错。
update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 14
update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 14
update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 13
EOS

COPY --from=go-judge /opt/go-judge /usr/local/bin/go-judge
COPY mount.yaml /etc/go-judge/mount.yaml

# 构建期自检：任何一个不是预期版本，说明上面的包名或 alternatives 配错了。
RUN <<EOS
set -ex
gcc --version
g++ --version
python3 --version
go-judge -version
EOS

# 参数也能用环境变量覆盖（ES_ 前缀，比如 ES_PARALLELISM=4），compose 里就是这么传 token 的。
#   -http-addr        端口沿用 JudgeServer 的 8080，compose 和 JUDGE_SERVER_URL 不用改
#   -mount-conf       沙箱里能看到哪些目录，见 mount.yaml
#   -src-prefix       学生程序的 stdin 直接从 /test_case 里开，不经 api 中转；别的路径一律拒
#   -output-limit     每条命令写文件的上限（RLIMIT_FSIZE）。16MB 是 JudgeServer 的口径：
#                     死循环打印写到 16MB 吃 SIGXFSZ，判运行时错误，前端有对应的中文说明
#   -file-timeout     编译产物和输出由 api 用完就删，这是 api 半路崩掉时的兜底
#   -dir              文件存储默认在 /dev/shm，docker 默认只给 64MB，放到 /tmp（compose 里的 tmpfs）
ENTRYPOINT [ "go-judge", "-http-addr=:8080", "-mount-conf=/etc/go-judge/mount.yaml", "-src-prefix=/test_case", "-output-limit=16m", "-file-timeout=10m", "-dir=/tmp/go-judge" ]
EXPOSE 8080
