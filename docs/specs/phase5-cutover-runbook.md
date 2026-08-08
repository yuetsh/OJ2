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

## 三、切换前检查清单（停机窗口之前做完）

- [ ] **先把镜像构建好**：`docker compose -f docker/compose.debian.yml build`
      首次约 5 分钟。别在停机窗口里构建。
- [ ] 填好 `docker/.env`（照 `docker/.env.example`）。
      `POSTGRES_PASSWORD` 必须**和生产库现有的口令一致** —— 库是原地不动的，
      不是新建的，密码改不了。
- [ ] `OJ2_JUDGE_TOKEN` 可以换新的（判题机和后端读同一个变量，一起换即可）。
- [ ] `AI_KEY` 服务器和机房是两个不同的 key，别填串。
- [ ] 机房那份 env 里 `COOKIE_SECURE=false`（http 直连 IP，带 Secure 的 Cookie
      浏览器不回传，表现是「登录成功但立刻又变未登录」）。
- [ ] 做一次 `pg_dumpall` 备份（不是为了迁移，是为了兜底）。
- [ ] 确认 `data/backend/` 下 `test_case`、`public/upload`、`public/avatar` 都在。

## 四、切换步骤

**两个站点都要切。** 机房那套连的是服务器的库，只切一边的话，另一边的旧后端
还在读写同一个库。

服务器（xuyue.cc）：

```bash
cd <部署目录>
docker compose -f docker-compose.debian.yml down     # 停旧栈，约 11s
docker compose -f OJ2/docker/compose.debian.yml --env-file OJ2/docker/.env up -d
```

机房：

```bash
docker compose -f docker-compose.school.yml down
docker compose -f OJ2/docker/compose.school.yml --env-file OJ2/docker/.env.school up -d
```

端口没变（服务器 8080，机房 81），前面的 Nginx Proxy Manager 不用动。

## 五、切换后验证（照着点一遍）

1. 打开首页，能看到题目列表
2. 用一个学生账号登录，看得到自己的提交历史
3. 提交一道题，**看判题结果是否实时刷出来**（这一步同时验证了 WebSocket）
4. 后台 → 判题机列表，确认判题机在线
5. 后台 → 题目列表能翻页
6. 题面里带图片的题，图片能显示（`/public/upload/*`）

## 六、回滚

```bash
docker compose -f OJ2/docker/compose.debian.yml down
docker compose -f docker-compose.debian.yml up -d
```

约 20 秒。**不需要恢复数据库，不需要动任何文件。**

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
