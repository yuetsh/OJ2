# 判题沙箱镜像

判题机跑的是 [go-judge](https://github.com/criyle/go-judge)：一个 Go 写的沙箱服务，
只管「在沙箱里跑一条命令、量出用了多少时间和内存」。**编译、逐个测试点运行、比对输出、
定状态码都在后端** `apps/api/src/judge/sandbox.ts`。

这个镜像里只有两样东西：go-judge 的单个二进制（从官方镜像 `criyle/go-judge` 里拷出来），
和学生程序要用的工具链。

| | 版本 |
|---|---|
| go-judge | **v1.13.3**（`Dockerfile` 的 `GO_JUDGE_VERSION`） |
| gcc / g++ | **14.2**（trixie 默认） |
| Python | **3.13.5**（trixie 默认） |
| base | debian:trixie-slim |
| 镜像体积 | 384 MB |

⚠️ **换 Python 大版本时，api 镜像（`docker/Dockerfile` 的 `python3-minimal`）要一起换。**
提交前的语法检查在 api 那边用 CPython 编译一遍，前端再按报错原文翻成中文（翻译表在
`apps/web/src/utils/pythonError.ts`）。两边版本不一致的话，同一份代码
在提交前和判题时报的句式可能不同，翻译表只能对上其中一边。

## 为什么从 JudgeServer 换过来（2026-10）

之前跑的是 QingdaoU/JudgeServer（上游停更在 2024-04，我们自己重编过工具链，那是 `oj2-judge-2`）。
它的 gunicorn 按核数起 worker、每份提交再按核数开进程池，**空闲内存跟着机器核数走**：

| | 空闲 | 判题中（同一批提交） |
|---|---|---|
| JudgeServer，2 核（= 服务器） | 52 MB | — |
| JudgeServer，16 核 | 305 MB | 约 370 MB |
| go-judge | **16 MB** | **80–100 MB** |

判题中那一列是在 16 核的开发机上、两边同时跑同一批真实提交时量的。go-judge 同时跑几个
程序由 `-parallelism` 管（默认等于核数），不再随提交数翻倍。

## 判定和原来一样吗

后端逐条照搬了 JudgeServer 的口径（输出 rstrip 后比 md5、stdout 和 stderr 合在一起比、
地址空间限两倍内存、16MB 输出上限、墙钟是 CPU 时限的 3 倍、libjudger 的状态码顺序），
细节见 `sandbox.ts` 顶部。换之前拿**生产库里的真实提交**，同一份代码同时送进新旧两台判题机，
逐个测试点比状态码：

| 语料 | 份数 | 一模一样 | 不一样 |
|---|---|---|---|
| C 提交（共 19757，随机抽样） | 2000 | 1989 | 11 |
| C++ 提交（全量） | 891 | 890 | 1 |
| Python 提交（共 115492，随机抽样） | 2000 | 2000 | 0 |

不一样的全部是下面三种，都是有意接受的：

- **`system("pause")`**（Dev-C++ 留下的习惯）：原来 seccomp 直接杀，运行时错误、信号 31；
  现在学生程序开不了子进程，`system()` 返回 -1，程序照常往下跑、按输出判。全库这样判成
  运行时错误的一共 63 条，2026-09 以后一条没有。
- **未定义行为**：读越界的数组元素（`max = num[10]`）、没读进值的变量。读到的垃圾值取决于
  栈上原来有什么，换了沙箱就换了一批垃圾。库里存的结果本来就和旧判题机现在重跑的对不上。
- **死循环里用 `endl` 打印**（C++ 那 1 条）：原来 CPU 时间只算用户态，先写满 16MB 判运行时错误；
  现在内核态也算（每次 `endl` 刷新都是一次系统调用），先到 1 秒判运行超时。都是错，说法不同。

另外几处数字会变，不影响判定：

- **内存读数变小**：现在是 cgroup 的峰值，原来是 ru_maxrss。C 的空程序 0.25 MB（原来
  1.5 MB），Python 2–5 MB（原来 8 MB）。程序打印的输出也算在内存里（写在 tmpfs 上）。
- **CPU 时间含内核态**，原来只算用户态。读大输入的程序会多出几毫秒。
- **Python 的回溯路径**是 `/w/solution.py`，原来是 `/judger/run/<随机串>/solution.py`。
  前端显示前两种都会去掉（`apps/web/src/utils/judge.ts` 的 `stripJudgePath`）。
  编译错误是相对路径（`main.c:3:5`、`File "solution.py"`），不受影响。

## 判题机容器为什么是 privileged

go-judge 要给每个学生程序建 namespace（看不到网络、别的进程、宿主的文件）和 cgroup（限内存、
数进程），这些在普通容器里做不了。试过不给特权：要同时加 `SYS_ADMIN`、关掉 Docker 的
seccomp 和 AppArmor、去掉 `/proc` `/sys` 的遮罩、再在容器里把 cgroup 重新挂成可写 ——
那几乎就是特权了，还更脆，换台宿主机就可能起不来。所以照 go-judge 官方的做法给 `privileged: true`。

学生程序本身是关在 go-judge 自己的沙箱里的（独立的 mount / pid / net / ipc / uts / user
namespace、cgroup、seccomp），比原来 libjudger 只有 seccomp + setuid 关得更严。

**宿主机要求**：cgroup v2（Debian 12 起默认就是），内核 ≥ 5.19 时内存峰值用 `memory.peak`，
更老的内核退回 maxrss（读数偏大一点）。起不来时 `docker logs oj-judge` 里会有
`create environment builder failed`。

## 镜像源

默认走清华源（`Dockerfile` 顶部两个 ARG）。官方源在这边实测 **197 KB/s**，清华
**3.9 MB/s**。

`build.sh --no-mirror` 换回官方源。debian 那两个只能用 http —— 改 sources 发生在
装 ca-certificates 之前，base 镜像里没有 CA 根证书，https 一律
`certificate verify failed`（这个坑踩过）。

go-judge 那层是从 Docker Hub 拉 `criyle/go-judge:<版本>`，构建机要能拉到它。

## 构建与分发

```bash
docker/judge/build.sh --save      # 本机构建 + 导出 dist/oj2-judge-3.tar
scp dist/oj2-judge-3.tar root@服务器:/root/OJDeploy/
ssh root@服务器 'docker load -i /root/OJDeploy/oj2-judge-3.tar'
# 机房那台同样来一遍 —— 两个站点各有各的判题沙箱
```

之后正常 `docker/deploy.sh` 即可。**判题机和 api / worker 要一起换**：新后端只会说
go-judge 的话，旧判题机只认旧后端。

⚠️ **这个名字不在任何 registry 上。** 服务器上忘了 `docker load`，`deploy.sh` 的自检会拦下。

⚠️ **改工具链或升 go-judge 就把末尾的序号 +1**（下一版叫 `oj2-judge-4`：`build.sh` 里的
`IMAGE`、三个 compose 里的 image，一起改）。`docker compose up -d` 不带 `--pull`，名字没变会静默
用机器上的旧镜像。

回滚：JudgeServer 那版（`oj2-judge-2`）只认 2026-10 之前的后端，要连代码一起回退到换判题机之前
的提交再部署。别在服务器上 `docker image prune` 把 `oj2-judge-2` 清掉。

## 和后端的分工

- **编译和运行命令在 `apps/api/src/judge/languages.ts`**，不在镜像里。镜像只负责把
  `/usr/bin/gcc`、`/usr/bin/g++`、`/usr/bin/python3` 这些绝对路径挂到正确的版本上
  （Dockerfile 里的 `update-alternatives`）。恢复一种语言要两边一起改，缺一个都是静默失败。
- **沙箱里能看到哪些目录在 `mount.yaml`**：`/usr`、`/lib` 这些只读，工作目录 `/w` 和 `/tmp`
  各是一块 128MB 的 tmpfs。
- **测试点不经过 api**：学生程序的 stdin 直接从判题机容器里的 `/test_case/<id>/N.in` 开
  （镜像的 `-src-prefix=/test_case`，别的路径一律拒）。比对用的 `stripped_output_md5` 由 api
  从同一个目录的 `info` 里读。所以 compose 里判题机和 api 挂的必须是同一个测试点目录。
- **程序输出不内联回传**：每个测试点的输出（最多 16MB）留在判题机的文件存储里，api 用
  `GET /file/:id` 按原始字节取回来比 md5，然后删掉。直接塞在 JSON 里的话，死循环打印的
  16MB 会在 worker 里膨胀成几倍。api 半路崩了没删的，判题机 10 分钟后自己清（`-file-timeout`）。
- **心跳**：go-judge 不主动报，worker 每 5 秒问一次 `/version`，替它在 `judge_server` 表里记一笔
  （`apps/api/src/judge/heartbeat.ts`）。后台列表里两台分别叫「服务器」「机房」（compose 的
  `JUDGE_SERVER_NAME`）。
- **鉴权**：`Authorization: Bearer <OJ2_JUDGE_TOKEN>`，go-judge 从 `ES_AUTH_TOKEN` 读。原来
  JudgeServer 收的是 token 的 sha256，现在是原文。

gcc-14 把隐式函数声明、int↔指针互赋、不兼容指针类型从 warning 提成了 error，`-w`
压不住。`languages.ts` 里的 `cLooseErrors` 里的 `-Wno-error=` 就是为此加的 ——
2026-09 升 gcc-14 时实测 1951 份历史 C 提交和 20 篇 C 教程的 93 个代码块，加了之后与
gcc-13 逐个文件结果完全一致；不加的话有 26 份会从「能过」变成 CE（按比例算全库约 260 条），
全是忘了 `#include <string.h>` 之类的隐式函数声明。

## 换镜像后怎么验

```bash
bun docker/judge/smoke.ts          # 三种语言 + 六种状态码 + gcc 宽松度 + 几条照搬的口径
```

它走的就是线上那份 `sandbox.ts`，不需要起后端、不需要库里有题，测试点内联传。

判题机装好之后，后台「判题机列表」应该能看到它上线（worker 起来 5 秒内）。
