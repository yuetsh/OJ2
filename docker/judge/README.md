# 判题沙箱镜像

判题机跑的是 [QingdaoU/JudgeServer](https://github.com/QingdaoU/JudgeServer)。
**上游已经停更**：master 最后一次提交是 2024-04-05（`b28aa56`，即 tag `v1.6.1`），
registry 上的 `oj-image/judge:latest` 和 `:1.6.1` 是同一份镜像（config digest 都是
`221bf4c0e730`）。所以想换新编译器，只能自己构建。

这里放的是**只改工具链的分叉**：`server/`（Flask + `_judger` 那套判题逻辑）和
`Judger/`（libjudger.so 沙箱内核）一行都没动，构建时从上游那个固定 commit 拉。

## 工具链

2026-09 从上游镜像升级，同时把用不上的三种语言整套砍掉：

| | 上游 1.6.1 | 现在 |
|---|---|---|
| gcc / g++ | 13 | **14.2**（trixie 默认） |
| Python | 3.12 | **3.13.5**（trixie 默认） |
| Go | 1.22 | **删掉** |
| Node | 20.x | **删掉** |
| JDK | temurin-21 | **删掉** |
| base | debian:trixie-slim（2024 年的） | debian:trixie-slim（当前） |
| 镜像体积 | 1.1 GB | **433 MB** |

⚠️ **换 Python 大版本时，api 镜像（`docker/Dockerfile` 的 `python3-minimal`）要一起换。**
提交前的语法检查在 api 那边用 CPython 编译一遍，前端再按报错原文翻成中文（翻译表在
`apps/web/src/oj/problem/utils/pythonError.ts`）。两边版本不一致的话，同一份代码
在提交前和判题时报的句式可能不同，翻译表只能对上其中一边。

砍语言的依据：前端的题目语言复选框从来只给 Python / C / C++ / SQL，
生产库 12 万条提交里 Java 44 条、Golang 15 条、JavaScript 3 条，全是很早以前的。
契约 `judgeLanguageSchema` 里那几个键留着（渲染历史提交要用），只是判题机不再认。
要恢复某种语言：Dockerfile 里加回包和 `update-alternatives`，同时改
`apps/api/src/judge/languages.ts`，两边缺一个都是静默失败。

## 镜像源

默认走清华源（`Dockerfile` 顶部三个 ARG）。官方源在这边实测 **197 KB/s**，清华
**3.9 MB/s**，整个构建从 12 分钟掉到 1 分钟以内。

`build.sh --no-mirror` 换回官方源。debian 那两个只能用 http —— 改 sources 发生在
装 ca-certificates 之前，base 镜像里没有 CA 根证书，https 一律
`certificate verify failed`（这个坑踩过）。

## 构建与分发

```bash
docker/judge/build.sh --save      # 本机构建 + 导出 dist/oj2-judge-2.tar
scp dist/oj2-judge-2.tar root@服务器:/root/OJDeploy/
ssh root@服务器 'docker load -i /root/OJDeploy/oj2-judge-2.tar'
# 机房那台同样来一遍 —— 两个站点各有各的判题沙箱
```

之后正常 `docker/deploy.sh` 即可。

⚠️ **这个名字不在任何 registry 上。** 服务器上忘了 `docker load`，compose 会去
pull 然后报找不到镜像（好在是响亮地失败，不是静默降级）。

⚠️ **改工具链就把末尾的序号 +1**（下一版叫 `oj2-judge-3`：`build.sh` 里的 `IMAGE`、
compose 里三处，一起改）。`docker compose up -d` 不带 `--pull`，名字没变会静默用机器上
的旧镜像。官方镜像算第 1 版，所以我们自己重编的从 `-2` 起。

回滚：把三个 compose 的 image 改回
`registry.cn-hongkong.aliyuncs.com/oj-image/judge:1.6.1`，重新 `up -d`。别在服务器上
`docker image prune` 把那份旧镜像清掉。

## 和 `languages.ts` 的关系

**编译和运行命令不在镜像里**，在 `apps/api/src/judge/languages.ts`。镜像只负责把
`/usr/bin/gcc`、`/usr/bin/python3`、`/usr/bin/go`、`/usr/bin/node`、`/usr/bin/java`
这些绝对路径挂到正确的版本上（Dockerfile 末尾的 `update-alternatives`）。

gcc-14 把隐式函数声明、int↔指针互赋、不兼容指针类型从 warning 提成了 error，`-w`
压不住。`languages.ts` 里的 `cLooseErrors` 里的 `-Wno-error=` 就是为此加的 ——
实测 1951 份历史 C 提交和 20 篇 C 教程的 93 个代码块，加了之后与 gcc-13 逐个文件
结果完全一致；不加的话有一批会从能过变成 CE。

## 这次升级是怎么验的

不写测试，全是实跑。除了 `smoke.ts` 的 13 条，还拿**生产库备份里的真实代码**逐个
文件对比了新旧镜像的编译结果（脚本是一次性的，结论记在这里）：

| 语料 | 份数 | 老镜像 (gcc-13 / py3.12) | 新镜像 (gcc-14 / py3.13) | 差异 |
|---|---|---|---|---|
| 历史 C 提交（共 19262，随机抽样） | 1951 | 1725 过 / 226 CE | 一模一样 | **0** |
| 历史 C++ 提交（全量） | 882 | 603 过 / 279 CE | 一模一样 | **0** |
| 历史 Python 提交（共 104527，随机抽样） | 2000 | 1833 过 / 167 CE | 一模一样 | **0** |
| 20 篇 C 教程里含 `int main` 的代码块 | 93 | 93 全过 | 一模一样 | **0** |

**不加 `cLooseErrors` 那三个开关的话，1951 份 C 提交里有 26 份会从「能过」变成 CE**
（按比例算全库约 260 条），全是忘了 `#include <string.h>` 之类的隐式函数声明。
教程那 93 块本身写得规范，加不加都全过。

## 换镜像后怎么验

```bash
bun docker/judge/smoke.ts          # 六种语言 + 六种状态码 + gcc 宽松度
```

它直接打判题机的 `/judge`，不需要起后端、不需要库里有题。用的 `languageConfigs`
就是线上那份，所以配置和镜像对不上会当场暴露。

**Go 那条坑记一下**（升级时发现的，升级之前就有）：`GOCACHE` 指向容器的 tmpfs
`/tmp`，判题机重启后第一次 Go 提交是冷构建，Go 1.22 要 5.6 秒 CPU、超过 3 秒的编译
预算 —— 重启后第一个交 Go 的学生必吃一次 CE，后面的人缓存热了又都正常。Go 现在整个
删掉了，但**以后加回任何需要编译缓存的语言，记得把编译预算放宽**。

判题机装好之后，后台「判题机列表」应该能看到它上线（心跳走
`POST /api/judge-server/heartbeat`，5 秒一次）。
