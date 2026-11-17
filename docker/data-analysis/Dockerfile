# 「数据分析」运行器镜像：Python 3.13 + 白名单里的库 + 中文字体 + 运行器本身。
#
# 和判题机（docker/judge/）完全分开：库升级、出问题都不碰判题。
# 不联网、不要特权，compose 里 network_mode: none、read_only，只留一个 unix socket 给 api。
# 设计和取舍见 README.md 与 docs/specs/2026-11-12-data-analysis-design.md。

# 镜像源，默认走国内（和 docker/judge/Dockerfile 同一个理由）；build.sh --no-mirror 关掉。
# apt 只能用 http：换源发生在装 ca-certificates 之前。
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# Python 大版本和判题机一致（3.13）。学生在题目页和数据分析里写的是同一种 Python。
FROM python:3.13-slim-trixie
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR
ARG PIP_INDEX_URL

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN <<EOS
set -ex
sed -i "s|http://deb.debian.org/debian-security|$APT_SECURITY_MIRROR|; s|http://deb.debian.org/debian|$APT_MIRROR|" /etc/apt/sources.list.d/debian.sources
apt-get update
# 文泉驿微米黑：图上的中文。kernel.py 的 CJK_FONT_PATH 写的就是它的路径，换字体两边一起换
apt-get install -y --no-install-recommends fonts-wqy-microhei
rm -rf /var/lib/apt/lists/*
EOS

COPY requirements.txt /opt/data-analysis/requirements.txt
RUN pip install --no-cache-dir -i "$PIP_INDEX_URL" -r /opt/data-analysis/requirements.txt

COPY runner.py kernel.py compare.py /opt/data-analysis/

# 构建期自检：库都在、字体路径对得上
RUN <<EOS
set -ex
test -f /usr/share/fonts/truetype/wqy/wqy-microhei.ttc
cd /opt/data-analysis && python -c "import kernel; kernel.warm_up(); print('ok')"
EOS

WORKDIR /opt/data-analysis
CMD ["python", "-u", "/opt/data-analysis/runner.py"]
