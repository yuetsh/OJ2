# 部署

现行部署形态与操作。**具体变量怎么填看 `docker/.env.example`**，那份注释是权威；
这里只写它装不下的东西：两个站点的拓扑、上线的两条路、出事时的退路。

## 拓扑

| | 服务器（`oj.xuyue.cc`） | 机房 |
|---|---|---|
| compose | `docker/compose.debian.yml` | `docker/compose.school.yml` |
| env | `docker/.env` | `docker/.env.school` |
| 库 | 本机 postgres（旧栈起的，原地没动） | **没有，连服务器那台的 5445** |
| Redis / 判题沙箱 | 各自一套 | 各自一套 |
| 对外 | NPM 反代 → `WEB_PORT` | http 直连 IP，端口 81 |

**两个站点共用一个数据库**，所以结构变更对两边同时生效；但判题队列（BullMQ 在本地
Redis）和 WebSocket 推送（本地 pub/sub）是每站独立的 —— 学生在哪边提交就在哪边判、
推送也只推得到连在本站的人。这和旧栈 Dramatiq + Channels 的拓扑一致，不是回归。

机房那套 `COOKIE_SECURE=false`：走 http 直连 IP，带 `Secure` 的 Cookie 浏览器不回传，
表现是「登录成功又立刻变未登录」。

## 三种数据形态

`compose.debian.yml` 靠 env 切换，判据是 `DB_HOST`：

- **外接数据**（线上就是这个）：设 `DATA_DIR` / `DB_HOST` / `REDIS_HOST`，
  沿用已经在跑的 postgres 和 redis，本栈只起 api / worker / web / judge。
- **自带数据**（本机、演练）：那几个变量留空，起栈时加 `--profile local-data`。
- 试跑形态额外要 `WEB_PORT` 和 `JUDGE_STATE_DIR`（两个判题机不能共用运行目录）。

⚠️ **`DATA_DIR` 默认值 `../data` 是 `OJ2/data`，不是部署目录的 `data/`。**
沿用旧数据却忘了设它，会静默挂上一堆空目录：空库、没测试点、题面图片 404，
**而且不报错**。这是整个部署里唯一会静默走歪的地方，`deploy.sh` 专门为它设了一道自检。

## Redis 口令

**会话存在 Redis 里**（`session:<token>` → 用户 id），谁能连上它，谁就能写一条会话
冒充任意用户，包括超管。所以服务器那台的 Redis **必须带口令**：`compose.debian.yml`
的 `REDIS_URL` 用 `${REDIS_PASSWORD:?}` 强制要求，`deploy.sh` 在外接形态下还会实测
「不带口令连不上、带 `docker/.env` 的口令连得上」，两条有一条不满足就中止部署。

2026-09-27 以前，旧栈 compose 起的那个 `oj-redis` 发布在 `0.0.0.0:5446`、不带口令，
**从公网直接 PING 得通**（实测过）。给它加口令的一次性步骤，在服务器上：

```bash
cd /root/OJDeploy
PW=$(openssl rand -hex 32)
echo "REDIS_PASSWORD=$PW" >> OJ2/docker/.env
# 编辑 docker-compose.yml 的 oj-redis，加一行（$PW 换成上面的值，别提交到任何仓库）：
#   command: ["redis-server", "--requirepass", "<PW>"]
docker compose up -d oj-redis           # 重建 redis，此刻起旧口令（无）的连接全部失败
cd OJ2 && docker/deploy.sh              # 马上重新部署，api / worker 带上口令
```

两步之间 api 连不上 Redis，站点会 500 一两分钟，挑没人用的时候做。
会话会保留（redis 退出时落盘 RDB），学生不用重新登录。

机房那台的 `oj-redis` 不发布端口、只在 compose 网络里，不需要口令。

## 上线

### 服务器：push 就部署

`.github/workflows/deploy.yml` —— 在 runner 上编好产物、rsync 到服务器、在服务器上
跑 `docker/deploy.sh --prebuilt`。触发的是 push 到 **github** 这个 remote
（`origin` 是 `git.xuyue.cc`，平时那次 push 不触发）：

```bash
git push github main
```

产物在 runner 上编是因为服务器性能差（首次构建约 5 分钟，光前端就 160s）。
**服务器自己编的能力没有砍掉**：不带 `--prebuilt` 就是原来的行为，只要有 docker
就能手动部署，不依赖 CI。

### 手工部署（机房、或 CI 不可用时）

```bash
cd /root/OJDeploy/OJ2
docker/deploy.sh              # 自检 → 构建 → 迁移 → 起栈 → 冒烟
docker/deploy.sh --check      # 只自检，只读，不动任何容器
docker/deploy.sh --no-build   # 只改了 env / compose 时跳过构建
```

代码怎么上到服务器不归它管（rsync 命令在脚本头部注释里）。

脚本起栈前有一串自检，**每一条都是真撞到过的**：compose 版本 ≥ 2.20、`DATA_DIR`
有没有生效、库指向和形态是否自洽、判题机运行目录有没有和旧栈分开、外接的
postgres / redis 是否活着。起完再跑四条冒烟，**题目数是 0 也中止** —— 那意味着连错库了。

### 判题镜像是自建的，不在 registry 上

`compose.*.yml` 里的 `oj2-judge-2` 是本机构建的（上游 JudgeServer 停更在
2024-04，官方镜像的编译器停在 gcc-13）。**新机器或换镜像之后，先把镜像 load 进去
再部署**：

```bash
# 本机
docker/judge/build.sh --save
scp dist/oj2-judge-2.tar root@服务器:/root/OJDeploy/
# 服务器 / 机房各来一次（两个站点各有各的判题沙箱）
docker load -i /root/OJDeploy/oj2-judge-2.tar
```

忘了这一步，`deploy.sh` 起栈时会去 pull 一个不存在的镜像并失败（响亮地失败，
不会静默降级）。构建、回滚和工具链版本表见 `docker/judge/README.md`。

### 迁移在起栈之前跑

`deploy.sh` 在「构建镜像」之后、「起栈」之前跑 `oj2-api migrate`，失败就中止部署
（旧容器原样还在跑）。所以不需要给 GitHub 配数据库凭据，也不用把生产库对外开放。

破坏性迁移（`DROP TABLE` / `DROP COLUMN` / `ALTER COLUMN ... TYPE` / `TRUNCATE`）
会让部署停在这一步并退出 4，放行的三条路见 `docs/database.md`。

## 部署后验证

命令能测的（服务器 `WEB_PORT`，机房 81）：

```bash
BASE=http://localhost:8080
curl -s -o /dev/null -w '首页          %{http_code}\n' $BASE/
curl -s -o /dev/null -w '站点配置      %{http_code}\n' $BASE/api/site
curl -s -o /dev/null -w '题目列表      %{http_code}\n' $BASE/api/problems
curl -s -o /dev/null -w '未登录进后台  %{http_code}\n' $BASE/api/admin/dashboard   # 期望 401
```

两个失败模式的症状别搞混：

- **题目列表 `"total":0`** → 连错库了（`DB_HOST` 没设，或误加了 `--profile local-data`
  起了个自带的空 postgres）。立刻停下来查。
- **库是对的，但判题全错、题面图片 404** → `DATA_DIR` 指错了。

命令测不到、必须手点的：登录 → 提交一道题看结果**实时刷出来**（这一步同时验证
WebSocket）→ 后台判题机列表在线 → 后台题目列表翻页 → 带图片的题面能显示。
机房额外确认一条：登录之后刷新还是登录态。

## NPM 反代

一次性配好的，只有改了 `WEB_PORT` 才要回去动端口。另外两项别关：

| 项 | 值 | 关了会怎样 |
|---|---|---|
| **Websockets Support** | 开 | 页面一切正常，唯独学生盯着的「判题中…」永远不动 |
| `client_max_body_size` | `200M` | 后台上传测试用例压缩包失败（和 Caddyfile 的 `200MiB` 对齐） |
| SSL | 签证书 | `COOKIE_SECURE=true` 依赖 https |

## 备份与灾难恢复

`docker/backup-db.sh` 走 `pg_dumpall` 全量（所有库 + 所有角色），带校验和保留策略。
恢复时有两条只在现场才暴露的坑：

1. **`pg_dumpall` 的备份会覆盖数据库口令。** 里面带 `ALTER ROLE onlinejudge ... PASSWORD`，
   恢复完 compose 里的 `POSTGRES_PASSWORD` 就对不上了，报的是
   `password authentication failed`，看起来和恢复毫不相干。恢复后要么把
   `POSTGRES_PASSWORD` 改成备份当时的口令，要么手动 `ALTER ROLE`。
2. **恢复前必须先停应用。** 应用连着库时 dump 里的 `DROP DATABASE` 会失败
   （`database "onlinejudge" is being accessed by other users`），接下来就是满屏主键冲突。
   先停 oj-api / oj-worker，再恢复。

> **旧栈已经不可逆地下线**（`0002_drop_django_leftovers` 删掉了 Django 的框架表并已在
> 生产库执行完毕），所以「停新栈起旧栈」不再是退路，**唯一退路是从数据库备份恢复**。

## 镜像体积

| 镜像 | 体积 | |
|---|---|---|
| `oj2-api` | 487MB | 其中 `clang-format`（apt）269MB、二进制 112MB、基底 79MB、`ruff` 28MB |
| `oj2-web` | 75MB | |

一半以上是 clang-format 拖进来的 LLVM（`libLLVM.so` 一个就 124MB）。设计文档当初写的
「降至数十 MB」没做到，就是漏算了它。想再瘦只有一条路：换成 PyPI 那个静态链接的
clang-format 独立二进制，能砍掉约 265MB。没做 —— 镜像是各站点本地构建的、不走镜像仓库，
磁盘不是瓶颈。
