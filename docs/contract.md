# 契约：闸门设在写入侧的来龙去脉

规矩在 `CLAUDE.md`「出参不 `parse`，用 `satisfies`」一节，前端那侧
（`utils/contract.ts` 为什么只挂三处）在 `apps/web/CLAUDE.md`。这里是证据。

## 读出侧校验自己造出来的四次故障

后端出参原来有 136 处 `xxxSchema.parse({...})`，全部撤成 `satisfies`。撤的时候当场炸出
两个一直存在的线上 500：

- `adminProblemSchema.lastUpdateTime` 写的是 `z.string()`，但 `problem.last_update_time`
  是全库唯一可空的列（961 道题里 470 道是 NULL）——**后台打开任何一道没编辑过的老题都是 500**；
- `embeddedSubmissionSchema` 从 `submissionDetailSchema` 继承了 `problemDisplayId` 却没
  omit，而路由只填了同义的 `problem` ——**凡是收到过站内信的人，消息页都打不开**
  （列表为空时才碰巧不炸，所以一直没人报）。

历史上还有两次同类：

- `exerciseSchema` 按题型收紧后，一行脏数据让整条练习列表 500；
- `info` 写成 `union([完整形状, z.object({})])` 后，对不上的一律落进空对象那支且
  parse **成功**，管理员详情页的测试点表格静默消失。全量核出 9163/124192 条中招，
  RE 8480/8480 全中 —— 沙箱在非正常退出的测试点上写 `output_md5: null`，
  而契约写的是 `z.string()`。

四次都是「读出侧校验」自己造出来的故障，不是它拦住的故障。出参是后端自己刚拼出来的
字面量，TS 已经在编译期校验过；再 parse 一遍拿不到任何新信息，唯一可能失败的输入是
**库里的历史数据**，而失败的代价是 500。

## 闸门的三处形态

1. **入参 `safeParse`**（58 处，全部保留）—— 请求体进来的那一刻校验，对不上回 400。
2. **`db/schema.ts` 的 `.$type<>()`** —— 枚举型的列（`submission.result` / `.language`、
   `problem.difficulty` / `.languages`、`achievement.rarity`、`exercise.type`…）和几个形状
   确定的 JSONB（`problem.template` / `.astRules` / `.sqlConfig` / `.sqlDisplay`、
   `acm_contest_rank.submission_info`）直接在列上收窄，只影响 TS、不产生任何 SQL。
   这些断言**逐列拿生产备份核过**（12.4 万条提交的 `result` 全在 `-2..6,10`、961 道题的
   `languages` 全是合法数组、10050 条榜单条目形状全对）。**加这类断言前先照样核一遍，别凭直觉。**
3. **语义校验函数** —— `astRulesError()`、`services/exercise.ts` 的 `exerciseDataError`。

**JSONB 原文（`submission.info` / `statistic_info` / `exercise.data`）仍然一律放行**，
读出侧不收窄：它们的形状真相在判题机那边。

query 里的筛选值要和收窄过的列比较时走 `routes/helpers.ts` 的 `asFilterValue()` ——
那是纯类型交接，**不加校验**：在那儿拦一道会把「筛出空列表」变成「筛条件被忽略、返回全部」。

唯一还留着 `parse` 的地方是 `judge/events.ts` 的 `parseSubmissionEvent` —— 那是从 Redis
收回来的报文，真边界，且失败返回 `null` 而不是 500。
