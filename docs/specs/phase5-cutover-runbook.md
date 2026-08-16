# 阶段 5：切换手册与演练报告

演练日期：2026-08-08
演练用快照：`db_backup_2026_08_07_10_39_19.sql`（pg_dumpall 集群备份，230MB，2026-08-07 10:39）
演练方式：本机 Docker，用 `docker/compose.debian.yml` **本身**跑，不是简化版。

真实数据量：**1710 用户 / 956 题 / 123140 提交 / 64 比赛 / 16 题单 / 38 成就**。

---

## 一、演练结论

### 出口标准：30 分钟内完成，回滚路径已验证

| 项 | 实测 |
|---|---|
| 停旧栈 | 11s |
| 起新栈（镜像已构建） | 34s；再次 start 6s |
| 数据迁移 | **0，不需要** —— 见下 |
| 全链路验证 | 约 2 分钟 |
| **合计** | **不到 1 分钟的停机**，远在 30 分钟内 |

真正的时间风险不在切换本身，而在**构建镜像**：首次构建约 5 分钟（依赖下载占大头）。
**镜像必须在停机窗口之前就构建好**，见下面的检查清单。

### 两个原本以为要做、实测不需要做的事

**1. 不需要执行任何 DDL。** 把生产 dump 的表结构和新后端在用的库逐列对比：
两边都是 **278 列，完全一致**，没有新增、没有删除、没有新表。新后端直接跑在现有结构上。

**2. 不需要重置序列。** 我在 `phase3-coverage.md` 里记过一条「切换必做：重置各表 sequence」，
**那条是错的** —— 它来自我手工造的本地库（用显式 id 导入、没有 setval）。真实的
pg_dumpall 备份带 30 条 `setval`，而且直接查生产快照里所有序列 vs `max(id)`，
**错位 0 个**。切换当天不用管序列。

### 回滚保证（已实测）

新栈跑完登录、提交、判题之后，再和生产 dump 的结构比一次：**逐列一致，零差异**。
新后端不会给旧后端留下任何它不认识的东西。

加上数据目录布局照抄旧后端（`test_case`、`public/upload`、`public/avatar` 原样不动），
**回滚 = 停新栈 + 起旧栈，约 20 秒，不涉及任何数据操作。**

> 未实测的部分：本机没有构建旧后端的 Django 镜像，所以「起旧栈」这一步本身没跑过。
> 但旧栈在服务器上一直是跑着的，它的镜像和 compose 都没动过。

---

## 二、演练验证了什么

全部通过真实生产数据、经 Caddy、在容器里跑：

| 检查项 | 结果 |
|---|---|
| 首页 SPA | 200，Caddy 从镜像里伺服 |
| 站点配置 `/api/site` | 200，读出真实站点名「判题狗」 |
| 题目列表 | 200，首条是 `SQL09` |
| 题目标签 / 公告 | 200 |
| 未登录访问后台 | 401 `login-required` |
| 登录 | 200（argon2 新哈希 + Django pbkdf2 旧哈希都支持） |
| 个人主页 / 排行榜 | 200，真实学生数据 |
| 后台首页 / 题目 / 判题机 | 200，`userCount: 1711` |
| **判题机心跳** | 判题容器自行注册成功（新路径 `/api/judge-server/heartbeat`） |
| **完整判题** | 提交 Python A+B → **AC，1.2 秒**，两个测试点全过 |

### WebSocket 实时推送（经 Caddy）

学生盯着「判题中…」变成结果就靠这条路，而它经过 Caddy 的 `handle /ws/*`，
是配置最容易写错、又只在生产才暴露的一段。单独验过：

```
WS 经 Caddy upgrade: 已连接
收到 2 条推送，301ms
  → {"type":"submission_update","result":7,"status":"judging"}
  → {"type":"submission_update","result":0,"status":"finished","time_cost":4,...}
```

### 机房那套（`compose.school.yml`）

这套配置和服务器那套差别不小（没有 postgres、连远程库、端口 81、
`COOKIE_SECURE=false`），单独跑过一遍：留下 `oj-postgres` 当「远程库」，
其余容器换成 school 栈，`DB_HOST` 指向宿主机 IP。

| 检查项 | 结果 |
|---|---|
| 连上「远程」库 | oj-api healthy，日志零错误 |
| 首页 / 题目列表 | 200，数据来自远程库 |
| 登录 | 200 |
| **Cookie 没带 Secure** | ✓ —— 带了的话机房（http 直连 IP）会「登录成功又立刻变未登录」 |
| WS + 完整判题 | 连接成功，300ms 内 judging → finished，AC |

也就是说机房用的是**本地 Redis + 本地判题沙箱 + 远程库**，判题不跨公网，
只有数据库查询走公网。

---

## 三、切换前准备（停机窗口之前做完）

### ⚠️ 演练没暴露的一个坑：两套 compose 的数据目录不是同一个地方

演练时是把生产 dump 恢复进 `OJ2/data/postgres` 的（见第九节），所以这件事被盖住了。
真实部署目录 `/root/OJDeploy` 的实际情况：

| | 旧栈（`docker-compose.yml`） | 新栈默认值 |
|---|---|---|
| 库 | `/root/OJDeploy/data/postgres` | `/root/OJDeploy/OJ2/data/postgres` |
| 测试点 / 上传 / 头像 | `/root/OJDeploy/data/backend/` | `/root/OJDeploy/OJ2/data/backend/` |

新 compose 在 `OJ2/docker/` 下，`../data` 解析到的是 `OJ2/data`。**照默认值切过去，
postgres 会在一个空目录上初始化一个全新的空库** —— 站点能起来，但没有用户、没有题、
判题全挂、题面图片 404。旧数据完好无损（回滚正常），但当天会白吓一场。

因此 `compose.debian.yml` / `compose.school.yml` 加了 `DATA_DIR` 等三组变量，
**下面的流程按「只换前后端」形态写**：旧栈的 postgres / redis 容器继续跑，
新栈只起 api / worker / web / judge。数据库进程根本不重启，库和文件一个字节都不用挪。

### 已经做掉的（2026-08-16）

- **`docker/.env.school` 已写好**（`.gitignore` 排除，不进版本库）：判题 token 新生成一条、
  `JUDGE_CONCURRENCY=4`、`DB_HOST=150.158.29.156`、`DB_PORT=5445`、`COOKIE_SECURE=false`。
  `docker compose config` 验过插值正确。**还差两个值**，见下面第 1 步。
- **构建复验通过。** 演练之后又改过两次前端（`/api2` 前缀漏改 5 处、接回配置推送与
  MaxKB），在本机重新构建：`oj2-web` 75MB 构建通过、单起容器首页 200；`oj2-api`
  完全命中缓存，说明后端源码在演练之后没动过。
  这只证明「还能构建出来」—— 镜像不走镜像仓库，是各站点本地构建的，
  **服务器和机房当地各自还要 build 一次**。
- **「只换前后端」形态本机实跑验过。** 用 `docs/specs/schema.sql` 起了一个发布在宿主机
  5445 的 postgres 冒充旧栈，新栈按下面的 env 起来：4 个容器（没有 postgres / redis）、
  `oj-api` healthy、首页与 `/api/site` `/api/problems` 200、未登录进后台 401。
  读写两个方向都验了 —— 那个库的 `pg_stat_activity` 里有一条来自 172.17.0.1 的
  `postgres.js` 连接，`judge_server` 表里也出现了新判题机写进去的心跳行。

### 1. 填两份 env（各站一份，都不进版本库）

服务器 `docker/.env`（照 `docker/.env.example` 拷一份再填）：

| 变量 | 填什么 |
|---|---|
| `POSTGRES_PASSWORD` | **生产库现有的口令**。库是原地不动的、不是新建的，这个值改不了（旧 compose 里是 `onlinejudge`） |
| `DATA_DIR` | `/root/OJDeploy/data` —— **旧数据目录的绝对路径**。不填就是上面那个空数据坑 |
| `DB_HOST` / `DB_PORT` | `host.docker.internal` / `5445` —— 旧 postgres 已经把 5445 发布在宿主机上，走 host-gateway 过去，不出本机 |
| `REDIS_HOST` / `REDIS_PORT` | `host.docker.internal` / `5446` —— 同理，旧 redis 发布的是 5446 |
| `OJ2_JUDGE_TOKEN` | 可以换新的，`openssl rand -hex 32`；后端和判题机读同一个变量，一起换即可 |
| `JUDGE_CONCURRENCY` | 服务器 `2` |
| `AI_KEY` | 服务器那把 DeepSeek key |

机房 `docker/.env.school`：已写好，只差三个 ——

| 变量 | 填什么 |
|---|---|
| `POSTGRES_PASSWORD` | 同上，**和服务器那份一模一样**（连的是同一个库） |
| `DATA_DIR` | 机房那台的旧数据目录绝对路径。**机房也有测试点和上传文件**，同样不能用默认值 |
| `AI_KEY` | 机房那把，**和服务器不是同一把，别填串** |

漏填 `POSTGRES_PASSWORD` 不会静默起一个坏服务：compose 里写的是 `${POSTGRES_PASSWORD:?}`，
没填直接报错退出。**但 `DATA_DIR` 漏填不会报错**，它有默认值 —— 这条只能靠人盯。

> 想让新栈自带 postgres / redis（本机开发、或将来旧栈彻底拆掉）：不设 `DB_HOST`
> `REDIS_HOST` `DATA_DIR`，起栈时加 `--profile local-data` 即可。

### 2. 先把镜像构建好（**别在停机窗口里干这件事**）

服务器：

```bash
docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env build
```

机房：

```bash
docker compose -f OJ2/docker/compose.school.yml --env-file OJ2/docker/.env.school build
```

首次约 5 分钟，依赖下载占大头。构建完确认两个镜像都在：

```bash
docker images | grep oj2-
# oj2-api   latest   487MB
# oj2-web   latest    75MB
```

### 3. 兜底备份

```bash
docker exec oj-postgres pg_dumpall -U onlinejudge > ~/oj-before-cutover-$(date +%F).sql
```

**不是为了迁移**（不需要 DDL、不需要迁数据），是为了出事有退路。真要用它重建，
先读第七节第 1 条 —— 这份备份会把角色口令覆盖回备份当时的值。

### 4. 确认 `DATA_DIR` 指对了

```bash
ls /root/OJDeploy/data/backend/test_case \
   /root/OJDeploy/data/backend/public/upload \
   /root/OJDeploy/data/backend/public/avatar
```

判题测试点、题面图片、头像都在这三个目录里。**这个路径必须和 env 里的 `DATA_DIR` 一致。**
再用 compose 自己确认一遍解析结果，别靠脑补：

```bash
docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env config | grep source:
# 每一条都应该在 /root/OJDeploy/data 下，出现 OJ2/data 就是 DATA_DIR 没生效
```

### 5. 出发前对一遍

- [ ] 两份 env 都填完了，两边的 `POSTGRES_PASSWORD` 一致
- [ ] **两边的 `DATA_DIR` 都指向旧数据目录**，`config | grep source:` 核对过
- [ ] 两边镜像都构建完了
- [ ] 备份做了
- [ ] 端口没变（服务器 8080、机房 81），前面的 Nginx Proxy Manager 不用动

## 四、切换步骤（当天，两边一起切）

**两个站点必须同一天切。** 机房那套连的是服务器的库，只切一边的话，另一边的旧后端
还在读写同一个库。

服务器（`/root/OJDeploy`）：

```bash
cd /root/OJDeploy

# 只停应用，postgres / redis 留着继续跑 —— 新栈接着用它们
docker compose -f docker-compose.yml stop oj-backend oj-judge
docker compose -f docker-compose.yml ps        # 确认 oj-postgres / oj-redis 还在 Up

docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env up -d
docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env ps
# 应该正好 4 个：oj-api / oj-worker / oj-web / oj-judge，等 oj-api 变 healthy
```

旧判题机必须一起停：它和新判题机会争同一个 `data/judge_server/run`。
旧 backend 也必须停：8080 端口要交给 `oj-web`。

机房：

```bash
cd <机房部署目录>
docker compose -f docker-compose.yml stop oj-backend oj-judge
docker compose -f OJ2/docker/compose.school.yml --env-file OJ2/docker/.env.school up -d
docker compose -f OJ2/docker/compose.school.yml --env-file OJ2/docker/.env.school ps
```

（机房本来就没有 postgres；它的 redis 是新栈自带的，和旧 redis 不冲突 ——
旧的那个没往宿主机发布端口。）

起不来先看这两条日志，绝大多数问题在里面直说了：

```bash
docker logs oj-api --tail 50      # 连不上库、token 不对都在这里
docker logs oj-judge --tail 20    # 判题机注册不上看这条
```

## 五、切换后验证

先用命令快速过一遍（服务器 8080，机房 81）：

```bash
BASE=http://localhost:8080
curl -s -o /dev/null -w '首页          %{http_code}\n' $BASE/
curl -s -o /dev/null -w '站点配置      %{http_code}\n' $BASE/api/site
curl -s -o /dev/null -w '题目列表      %{http_code}\n' $BASE/api/problems
curl -s -o /dev/null -w '未登录进后台  %{http_code}\n' $BASE/api/admin/dashboard   # 期望 401
```

前三条 200、第四条 401 才算过。两个失败模式各有各的症状，别搞混：

- **题目列表 `"total":0`** → 连错库了（`DB_HOST` 没设，或误加了 `--profile local-data`
  起了个自带的空 postgres）。立刻停下来查，别往下走。
- **库是对的，但判题全错、题面图片 404** → `DATA_DIR` 指错了，挂上去一堆空目录。

然后照着点一遍 —— 下面这几步是命令测不到的：

1. 打开首页，能看到题目列表
2. 用一个学生账号登录，看得到自己的提交历史
3. 提交一道题，**看判题结果是否实时刷出来**（这一步同时验证了 WebSocket）
4. 后台 → 判题机列表，确认判题机在线（心跳走 `/api/judge-server/heartbeat`）
5. 后台 → 题目列表能翻页
6. 题面里带图片的题，图片能显示（`/public/upload/*`）

机房那边额外确认一条：**登录之后刷新页面还是登录态**。如果「登录成功又立刻变未登录」，
就是 `COOKIE_SECURE` 没设成 false。

## 六、回滚

```bash
cd /root/OJDeploy
docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env down
docker compose -f docker-compose.yml start oj-backend oj-judge
```

机房同理，换成 `compose.school.yml`。

约 20 秒，比演练时还快一点 —— **postgres / redis 全程没停过**，回滚只是把旧的
backend 和判题机再 start 起来。**不需要恢复数据库，不需要动任何文件。**

这也是「只换前后端」形态的主要好处：切换和回滚都不碰数据库进程，
库出问题的可能性从流程里被整个拿掉了。

---

## 七、演练中踩到的坑（写下来是因为它们只在容器里出现）

### 1. pg_dumpall 备份会覆盖数据库口令 ⚠️

演练时恢复完快照，新后端立刻报：

```
PostgresError: password authentication failed for user "onlinejudge"
```

原因：`pg_dumpall` 的集群备份里带

```sql
ALTER ROLE onlinejudge WITH SUPERUSER ... PASSWORD 'md5……';
```

**恢复这份备份，会把角色口令覆盖成备份时生产的那个口令**，compose 里的
`POSTGRES_PASSWORD` 就对不上了。

- 正常切换：**不受影响**，因为根本不恢复备份。
- 灾难恢复（真要从备份重建）：恢复之后要么把 `POSTGRES_PASSWORD` 设成生产的口令，
  要么恢复后手动 `ALTER ROLE onlinejudge PASSWORD '<新口令>'`。
  这一条不写下来，恢复现场会被一个看起来毫不相干的报错卡住。

（另记：该哈希是 md5，PG16 默认已是 scram-sha-256。不影响切换，但值得择日换掉。）

### 2. 恢复备份前必须先停应用

应用连着库时，dump 里的 `DROP DATABASE` 会失败：

```
ERROR: database "onlinejudge" is being accessed by other users
```

演练时因为目标库本来是空的，数据照样灌进去了 —— 那是运气。目标库有数据的话，
接下来就是满屏主键冲突。灾难恢复流程：**先停 oj-api / oj-worker，再恢复。**

### 3. 「本地能过、容器里过不了」的三个坑（构建期）

都已修好并写进 Dockerfile 的注释，这里只留索引：

- 构建上下文吸进 `data/`，判题沙箱用别的 uid 建的目录 docker 连 stat 都做不了 → `.dockerignore`
- `mermaid@9.4.3`（机房老 Chrome 的 legacy 依赖）从容器里连 npmjs 稳定失败 → 换 npmmirror + 重试
- 容器里 bun 用 isolated 布局、本地是扁平的，靠「提升」解析的包在容器里一律找不到
  → 把真正直接 import 的 4 个包补成直接依赖

---

## 八、镜像体积（没达到设计文档的预期，说明原因）

| 镜像 | 体积 |
|---|---|
| `oj2-api` | **487MB** |
| `oj2-web` | 75MB |

设计文档写的是「降至数十 MB」，**没做到**。拆开看：

| 层 | 体积 |
|---|---|
| `clang-format`（apt） | **269MB**，其中 `libLLVM.so.19.1` 一个 124MB |
| `oj2-api` 二进制 | 112MB（Bun 运行时 + 内嵌的 wasm/原生模块/4.8MB 词典） |
| `ruff` | 28MB |
| debian-trixie-slim 基底 | 79MB |

也就是说**一半以上是 clang-format 拖进来的 LLVM**。旧的 Python 镜像同样装了
clang-format，再加整个 Python 运行时和 Django 依赖，所以新镜像仍然明显更小，
但「数十 MB」是当初没把 clang-format 算进去。

想再瘦下来只有一条路：换成静态链接的 clang-format 独立二进制（PyPI 的
`clang-format` wheel 里就是），能砍掉约 265MB。没做，因为镜像是各站点本地构建的、
不走镜像仓库，磁盘不是瓶颈；等哪天真嫌大了再说。

---

## 九、演练产生的临时数据（已清理）

演练在 `OJ2/data/postgres` 下留下了**一份完整的生产数据副本**，其中包含 1710 名
学生的 `raw_password` 明文列。演练结束后已删除该目录。

以后再演练记得同样处理 —— 那不是测试数据，是真实学生数据。
