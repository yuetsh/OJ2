# 「数据分析」运行器

学生在「数据分析」里写的 pandas / matplotlib 代码在这里跑。设计和每条拍板见
`docs/specs/2026-11-12-data-analysis-lab-design.md`。**和判题机（`docker/judge/`）完全分开**，
库升级、出问题都不碰判题。

| | 版本 |
|---|---|
| Python | 3.13（`python:3.13-slim-trixie`，和判题机同一个大版本） |
| 库 | 见 `requirements.txt`，全部钉死；那份文件就是学生能 import 的白名单 |
| 中文字体 | 文泉驿微米黑（`fonts-wqy-microhei`） |
| 镜像 | `oj2-lab-2`，约 405 MB（`-1` 是 2026-11-12 首次上线那版，`-2` 起答案的比对数据由 api 缓存） |

## 怎么跑起来的

```
母进程（root）   启动时 import 好全部库并预热（约 1.1 秒），然后在 unix socket 上收请求
  └ 处理进程     每个请求 fork 一个：建临时目录、放素材，再 fork 学生进程，等结果、比对、回结果
     └ 学生进程   换成独立的 uid（每次一个），限 CPU / 内存 / 写文件 / 进程数，关掉继承来的
                 所有文件描述符，然后一步步跑代码（kernel.py）
```

- **为什么 fork**：`import pandas, matplotlib` 本身约 0.7 秒 CPU。服务器只有 2 核，一个班 40 人
  一起点运行，每次都 import 的话要排十几秒；fork 出来的进程带着已经加载好的库，一次运行零点几秒。
- **每次都从第 1 步重跑到当前这步**，不给学生常驻进程：没有「我刚才跑没跑过第 1 步」这种状态，
  服务器也不用为每个学生留内存。前面某一步报错，就报在那一步上。
- **和 Jupyter 一个口径**：一步的最后一行如果是表达式，就把它的值显示出来（DataFrame 显示成表）；
  一步跑完图就关掉，不带到下一步。
- **对照答案**时老师的答案和学生的代码各跑一个进程，两边并行；比对（`compare.py`）在处理进程里做，
  学生进程碰不到。但「抽指纹」和学生代码在同一个进程里，存心改写 kernel 的函数是能骗过检查的 ——
  这是有意接受的，数据分析不是考试。

## 关得住什么

| | 怎么关的 |
|---|---|
| 联网 | 容器 `network_mode: none`，连 api 都不通；api 走共享目录里的 unix socket |
| 碰 api 的连接 | 学生进程关掉了 3 号以后的全部文件描述符 |
| 自己给自己发运行请求 | socket 权限 0600，归 api 的 uid（`LAB_SOCKET_UID`），学生的 uid 连不上 |
| 杀母进程、看别人的目录 | 每次运行一个独立 uid；运行目录 0700；`/tmp/runs` 0711 列不出来 |
| 读别的实验的素材 | 素材随请求一起发、写进这次的临时目录，容器里没有素材目录 |
| 死循环 / 吃内存 / 写大文件 / fork 炸弹 | CPU 10 秒、墙钟 20 秒（整个进程组杀掉）、地址空间 = 母进程 + 512 MB、写文件 32 MB、进程数 16 |
| print 太多 | 一步最多收 64K 字，多的截掉 |
| 改镜像里的东西 | 容器 `read_only`，只有 `/tmp`（tmpfs）可写 |

母进程是 root（要给每次运行换 uid），compose 里 `cap_drop: ALL` 后只加回它用得上的几样。

## 协议

`GET /health` → `{ok, warmSeconds, concurrency, versions}`

`POST /run`：

```jsonc
{
  "assets": [{ "name": "成绩.xlsx", "data": "<base64>" }],   // 放进运行目录，代码里直接按名字读
  "steps": ["第 1 步的代码", "第 2 步的代码", "..."],          // 学生的，跑到最后一步，只回最后一步的输出
  "reference": ["..."],                                        // 对照答案时：老师答案，和 steps 一样多步
  "check": { "kind": "none" }
        // | { "kind": "compare", "vars": ["avg"], "figure": { "values": true, "title": true, "labels": false } | null }
        // | { "kind": "script", "script": "assert ..., '给学生的提示'" }
}
```

回：

```jsonc
{
  "ok": true,                          // 学生代码一直跑到最后没报错
  "outputs": [                         // 最后一步（或报错那一步）的输出，按出现顺序
    { "kind": "text", "text": "..." },
    { "kind": "table", "columns": [], "rows": [[索引, 格...]], "shape": [行, 列], "skipAfter": 5, "colsTruncated": false },
    { "kind": "image", "png": "<base64>" }
  ],
  "truncated": false,
  "error": { "step": 2, "type": "NameError", "message": "...", "line": 3, "traceback": "..." },  // 或 null
        // type 还有 Timeout / Crashed 两个运行器自己的；英文原文由前端翻译
  "check": { "passed": false, "messages": ["avg 里「数学」这一项：你的是 65.3，应该是 72.2"] },
        // 学生代码报错、或答案自己有问题时是 null；检查脚本自己炸了会多一个 scriptError（给老师看）
  "referenceError": null,              // 老师答案跑不通 / 没有要比的变量 —— 这时不判学生
  "referenceSummary": "4 根柱子，标题「各科平均分」",   // 比图时：答案画了什么（出题页「试跑」用）
  "timeMs": 180
}
```

## 构建、上线

```bash
docker/lab/build.sh                     # 本机构建 oj2-lab-2
docker compose -f docker/compose.dev.yml up -d lab
bun docker/lab/smoke.ts                 # 冒烟：三十来项，含 40 人并发
LAB_SMOKE_OUT=/tmp/x bun docker/lab/smoke.ts   # 顺便把图存下来，肉眼看中文有没有变方框
```

**改了库版本、字体或这里的任何 .py，就把 `build.sh` 里的镜像名序号 +1**（下一版 `oj2-lab-3`），
compose 里一起改 —— 同名重建的话 `up -d` 会静默用机器上的旧镜像。

上服务器和判题机一样：`build.sh --save` 出 tar，scp 过去 `docker load -i`（见 `docs/deploy.md`）。
服务器的 `compose.debian.yml` 里是 `oj-lab`，和 `oj-api` 共用 `lab-run` 卷（socket 在里面，
api 的 `LAB_SOCKET=/run/lab/lab.sock`）。在服务器上跑冒烟：

```bash
docker run --rm -v docker_lab-run:/run/lab -v "$PWD":/w -w /w oven/bun:1.4.4 \
  sh -c 'LAB_SOCKET=/run/lab/lab.sock bun docker/lab/smoke.ts'
```

## 本机实测（2026-11-12，开发机 16 核，容器内并发 3）

「读表 → 平均分 → 画错成 40 根柱子」，对照答案（每次两个进程）：

| 同时点运行的人数 | 中位 | 最后一个 |
|---|---|---|
| 1 | 0.18 s | 0.18 s |
| 10 | 0.37 s | 0.73 s |
| 40 | 1.35 s | 2.64 s |

开发机单核比服务器快，服务器上估计要乘一个系数；上线前在服务器上再跑一次 `smoke.ts`。
