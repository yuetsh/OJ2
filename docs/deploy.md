# 部署

现行部署形态与操作。**具体变量怎么填看 `docker/.env.example`**，那份注释是权威；
这里只写它装不下的东西：两个站点的拓扑、上线的两条路、出事时的退路。

## 拓扑

| | 服务器（`oj.xuyue.cc`） | 机房 |
|---|---|---|
| compose | `docker/compose.debian.yml` | `docker/compose.school.yml` |
| env | `docker/.env` | `docker/.env.school` |
| 库 | 本栈的 `oj-postgres`（PostgreSQL 18） | **没有，连服务器那台的 5445** |
| Redis / 判题沙箱 | 各自一套 | 各自一套 |
| 对外 | NPM 反代 → `WEB_PORT` | http 直连 IP，端口 81 |

**两个站点共用一个数据库**，所以结构变更对两边同时生效；但判题队列（BullMQ 在本地
Redis）和 WebSocket 推送（本地 pub/sub）是每站独立的 —— 学生在哪边提交就在哪边判、
推送也只推得到连在本站的人。这和旧栈 Dramatiq + Channels 的拓扑一致，不是回归。

登录态是 access token + refresh token（见 `apps/api/src/auth/session.ts`），会话存在
**本站的** Redis 里，所以在一个站点登录，到另一个站点还要再登一次。JWT 的签名密钥也存在
本站 Redis（`auth:jwt-secret`，首次启动自动生成），部署不用配；删掉它再重启 api 等于让
本站所有人重新登录。改密码、禁用账号走库里的 `user.token_version`，两个站点同时生效。

## 全部容器都归 OJ2

服务器上 postgres / redis / 判题沙箱 / api / worker / web **全由 `compose.debian.yml` 起**，
升级哪个都只改仓库里的文件。

2026-10 以前库和 redis 是旧栈那份 `/root/OJDeploy/docker-compose.yml` 起的，OJ2 通过
`DB_HOST` / `REDIS_HOST` 外接过去，升个版本就得去服务器上改那份文件。这种「外接」形态
已经删掉了，搬家见下面「把库搬进 OJ2」。

⚠️ **`DATA_DIR` 默认值 `../data` 是 `OJ2/data`，不是部署目录的 `data/`。**
忘了设它，postgres 会在空目录上初始化一个空库，测试点和题面图片也都不在，
**而且不报错**。这是整个部署里唯一会静默走歪的地方，`deploy.sh` 专门为它设了自检
（`$DATA_DIR/postgresql/18/docker` 必须已经是一个库）。

## 口令

**会话存在 Redis 里**（`session:<token>` → 用户 id），谁能连上它，谁就能写一条会话
冒充任意用户，包括超管。所以服务器那台的 Redis **必须带口令**（`REDIS_PASSWORD`，
compose 里 `:?` 强制要求），端口也只发布在 127.0.0.1。2026-09-27 以前它发布在
`0.0.0.0:5446`、不带口令，从公网直接 PING 得通（实测过）。

**数据库口令同理**：`onlinejudge` 是超级用户，5445 对公网开着（机房要连），2026-10 以前
口令就是默认的 `onlinejudge`。搬进 OJ2 时用 `openssl rand -hex 32` 生成的新口令重建。`POSTGRES_PASSWORD` 只在库初始化时生效一次，以后要换：

```bash
docker exec -it oj-postgres psql -U onlinejudge -d postgres -c '\password onlinejudge'
# 再改 docker/.env 和机房 docker/.env.school 的 POSTGRES_PASSWORD，两边都重新 up -d
```

机房那台的 `oj-redis` 不发布端口、只在 compose 网络里，不需要口令。

## 上线

### 服务器：push origin 就部署

`.gitea/workflows/deploy.yml` —— push 到 `origin`（`git.xuyue.cc`，Gitea）的 `main` 时，
由**开发机上的 gitea-runner** 编好产物、跑一遍 `bunx vp run verify`（格式、lint、前后端类型
检查、路由遮蔽、AST 节点，**不过就不部署**）、rsync 到服务器、在服务器上跑
`docker/deploy.sh --prebuilt`。

```bash
git push origin main      # 进度在 git.xuyue.cc/xuyue/OJ2/actions
```

**push 时开发机得开着。** 没开的话任务在 Gitea 里排队，开机后 runner 连上就接着跑；
排队超过 24 小时会被 Gitea 作废（`ABANDONED_JOB_TIMEOUT` 的默认值），那就要在 Actions 页面重跑。

为什么在开发机上编、不在服务器或 GitHub 上编：

| 在哪编 | 问题 |
|---|---|
| 服务器 | 只有 2 核，首次构建约 5 分钟、光前端就 160s，编的时候判题排队 |
| GitHub | runner 在海外，到服务器晚高峰只有十几 KB/s。后端改一行，`--bytecode` 那段约 6MB 字节码就整段重写，一次 rsync 要五六分钟 |
| 开发机 | 16 核，编加检查不到一分钟；到服务器实测 5MB 约 1 秒 |

**服务器自己编的能力没有砍掉**：不带 `--prebuilt` 就是原来的行为，只要有 docker
就能手动部署，不依赖任何 runner。

#### 备用：GitHub 手动触发

`.github/workflows/deploy.yml` 还在，但**只能手动触发**（github.com 上 Actions → Deploy →
Run workflow），开发机不在、又急着上线时用。它不再 push 就跑，因为 `origin` 会镜像到
`github`，两边都自动的话每次会部署两遍，两边的并发锁又不通。需要的 secret（`HOST` / `KEY`）
写在那份文件头部。

#### 部署 runner

开发机上的 runner 是 host 模式：直接用本机的 bun、`~/.ssh/config` 里的 `debian`（root@服务器）
和 git.xuyue.cc 的 SSH 访问，所以工作流里**不需要任何 secret**，也不用 `actions/checkout`。

| | |
|---|---|
| 程序 | `pacman -S gitea-runner`（系统级的 `gitea-runner.service` 不开，它用单独的账号跑） |
| 服务 | `~/.config/systemd/user/gitea-runner.service`，`systemctl --user status gitea-runner` |
| 配置 | `~/.local/share/gitea-runner/config.yaml`（标签 `oj2-deploy:host`、`iot-deploy:host`，capacity 1） |
| 注册 | 同目录的 `.runner`；注册在 `xuyue` 用户下，和 IOT_SIM（物联网仿真平台）共用。capacity 1，两边的部署排队，不会同时挤服务器 |
| 日志 | `journalctl --user -u gitea-runner -f`；每次部署的日志在 Gitea 的 Actions 页面 |
| 看门狗 | `~/.config/systemd/user/gitea-runner-watchdog.timer`，每 5 分钟跑同目录配置旁的 `watchdog.sh`（见下） |

**runner 会「假在线」。** gitea-runner 5.2.4 拉任务超时一次（默认 5 秒，网络一抖就超）之后就再也
不拉了：服务还是 active，push 之后 Gitea 却说「没有在线的运行器来领取这个任务」（2026-11-03 一天
撞了两次）。两层兜底：`config.yaml` 里 `fetch_timeout: 30s` 少撞几次；看门狗
`~/.local/share/gitea-runner/watchdog.sh` 去服务器的 Gitea 库里看 `action_runner` 的
`last_online` / `last_active`，超过 3 分钟没见到这个 runner、而且它手上没有在跑的任务（不打断部署），
就 `systemctl --user restart gitea-runner`；连不上服务器时什么都不做。所以撞上了最多等 5 分钟，
等不及就自己重启一下。看门狗做了什么：`journalctl --user -u gitea-runner-watchdog`。

**部署不用开发机自己的 bun。** pacman 装的 bun 是 Arch 自己编的，动态链接系统 ICU，单二进制
把它打进去之后到容器里报 `libicui18n.so.78: cannot open shared object file`（2026-11-03 第一次跑
就撞上了，迁移那步先炸、容器没动）。工作流按 `packageManager` 的版本下载官方二进制、核 sha256，
缓存在 `~/.cache/oj2-deploy/bun-v<版本>/`；编完后端还会 `ldd` 一下，多链接了 libc 以外的库就判红。
升级 bun 时这里不用管，改了 `packageManager` 下一次部署会自己下新版本。

换一台机器跑 runner：装 `gitea-runner`，在服务器上生成注册令牌，再照上面那份配置注册：

```bash
ssh debian 'docker exec -u git gitea gitea --config /data/gitea/conf/app.ini actions generate-runner-token --scope xuyue'
gitea-runner register --no-interactive --config config.yaml --instance https://git.xuyue.cc --token <令牌> --name <名字>
```

那台机器还得能 `ssh debian`、能 `git fetch git@git.xuyue.cc:xuyue/OJ2.git`（都不能要密码）；
IOT_SIM 的部署还要 dotnet 10 SDK 和 bubblewrap（见那边的 `deploy/README.md`）。
旧的 runner 在 Gitea 仓库设置 → Actions → Runners 里删掉。

### 手工部署（机房、或 CI 不可用时）

```bash
cd /root/OJDeploy/OJ2
docker/deploy.sh              # 自检 → 构建 → 迁移 → 起栈 → 冒烟
docker/deploy.sh --check      # 只自检，只读，不动任何容器
docker/deploy.sh --no-build   # 只改了 env / compose 时跳过构建
```

代码怎么上到服务器不归它管（rsync 命令在脚本头部注释里）。

脚本起栈前有一串自检，**每一条都是真撞到过的**：`DATA_DIR` 有没有生效、数据目录是不是
一个 18 的库、判题镜像在不在。起完再跑四条冒烟，**题目数是 0 也中止**
—— 那意味着连错库了。

### 判题镜像是自建的，不在 registry 上

`compose.*.yml` 里的 `oj2-judge-3` 是本机构建的（go-judge 的二进制 + 我们要的 gcc /
python）。**新机器或换镜像之后，先把镜像 load 进去再部署**：

```bash
# 本机
docker/judge/build.sh --save
scp dist/oj2-judge-3.tar root@服务器:/root/OJDeploy/
# 服务器 / 机房各来一次（两个站点各有各的判题沙箱）
docker load -i /root/OJDeploy/oj2-judge-3.tar
```

判题机容器是 `privileged` 的（go-judge 要自己建 cgroup），理由见 `docker/judge/README.md`。

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

- **题目列表 `"total":0`** → 连错库了（`DATA_DIR` 指到了一个新初始化的空库）。
  立刻停下来查。
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
| SSL | 签证书 | 登录 token 明文走公网；浏览器也只在 https 下给 `navigator.locks`，几个标签页换 token 会撞车（有宽限期兜着，但别依赖它） |

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

### 把线上数据拉到本机

`docker/pull-prod.sh`（在本机跑）经 `ssh debian` 只导 `onlinejudge` 一个库（`pg_dump -Fc`，
不带角色，所以不会踩上面的坑 1），先灌进 `onlinejudge_incoming`、对过行数再换名（不用停 dev，
避开坑 2），换下来的旧库留作 `onlinejudge_prev`。`--files` 顺带同步测试点、题面图片、头像。
对服务器只读；拉完本机的账号口令都是线上的。用法和刻意的做法在脚本头部。

## 把库搬进 OJ2（2026-10-13，已完成）

服务器上的 postgres / redis 原来由旧栈的 compose 起，那次搬进了本栈，顺带 PostgreSQL 16 → 18、
Redis 7 → 8（一次性脚本 `docker/move-db-into-oj2.sh` 用完已删，要看去 git 历史）。
留下的坑只有一个，恢复搬家之前（16 时代）的备份时会踩：

**恢复时要剥掉 dump 里的口令**（上面坑 1 的加重版）：16 的库口令是 md5 哈希存的，dump 原样带着；而 18 的
镜像新建的库 `pg_hba.conf` 只认 `scram-sha-256`，md5 存的口令**永远验不过**。容器里
`docker exec psql` 走本地 socket 是 trust，一切看着正常，只有 api 和机房从网络连进来才报
`password authentication failed`。剥掉之后库里留的是初始化时按 `POSTGRES_PASSWORD` 存的
SCRAM 哈希。

服务器上的 `$DATA_DIR/postgres`（16 的老库目录）如果还在，可以删了。

## 镜像体积

| 镜像 | 体积 | |
|---|---|---|
| `oj2-api` | 487MB | 其中 `clang-format`（apt）269MB、二进制 112MB、基底 79MB、`ruff` 28MB |
| `oj2-web` | 75MB | |

一半以上是 clang-format 拖进来的 LLVM（`libLLVM.so` 一个就 124MB）。设计文档当初写的
「降至数十 MB」没做到，就是漏算了它。想再瘦只有一条路：换成 PyPI 那个静态链接的
clang-format 独立二进制，能砍掉约 265MB。没做 —— 镜像是各站点本地构建的、不走镜像仓库，
磁盘不是瓶颈。
