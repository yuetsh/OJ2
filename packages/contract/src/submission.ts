import { z } from "zod"

import { paginatedSchema } from "./common"
import { judgeStatusSchema, type JudgeStatus } from "./judge-status"
import { problemLanguageSchema, runnableLanguageSchema } from "./language"

/**
 * 判题机原始输出（`submission.info` 的 JSONB 原文）。**只是类型，不作运行时校验。**
 *
 * 这里曾经是一组 zod schema，按生产库实测的键集收紧过，结果是 124192 条提交里有
 * 9163 条（RE 8480/8480、TLE 338/338、MLE 1/1 全中）被判成不符：沙箱在非正常退出
 * 的测试点上写 `output_md5: null`，而 SQL 判题（`judge/sql/engine.ts` 的 CaseResult）
 * 压根没有 `output` 这个键、`error_message` 通过时是 null。收紧当时只对了键集合，
 * 没对空值。
 *
 * 更糟的是失败方式：`info` 当时是 `union([完整形状, z.object({})])`，对不上的一律
 * 落进第二支被剥成 `{}` 且 parse 成功 —— 管理员的测试点表格**静默消失**。
 *
 * 结论：JSONB 的形状真相在**写入侧**（判题机、`judge/run.ts`），在读出侧再校验一遍
 * 只会在两边分叉时丢数据。所以 `info` 回到 `z.unknown()`，形状以下面的 TS 类型
 * 描述，取值处由 `submissionCaseResults()` 做一次真正需要的运行时判断（有没有
 * data 数组）。**改这里的字段时对着判题机改，不要对着采样出来的键集改。**
 *
 * 键名是**判题沙箱定的 snake_case**，不要跟着响应字段一起改。
 */
export interface JudgeCaseResult {
  error: number
  memory: number
  /** SQL 判题没有这个键 */
  output?: string | null
  result: JudgeStatus
  signal: number
  cpu_time: number
  exit_code: number
  real_time: number
  test_case: string
  /** 非正常退出的测试点上是 null */
  output_md5: string | null
  /** SQL 判题会带上中文原因（通过的测试点是 null），沙箱判题没有这个键 */
  error_message?: string | null
  score?: number
}

/**
 * `info` 的完整形状。实际取值还有第三种：**空对象** —— 后端对非管理员下发
 * `info: {}`（`routes/submission.ts` 的 `full ? row.submission.info : {}`），
 * 也是插入待判提交时的初值。所以调用方不能直接 `.data`。
 */
export interface JudgeInfo {
  err: string | null
  data: JudgeCaseResult[] | null
}

/**
 * 判题产出的统计（`submission.statistic_info` 的 JSONB 原文）。
 *
 * 五个键全部可选，依据是生产库实测的出现次数：time_cost / memory_cost 各 112097、
 * score 3993、err_info 3153、ast_results 56，另有 27 条空对象。
 *
 * 用 `looseObject`：所有键可选 + 不剥未知键 = **对任何对象都不会失败、也不丢字段**，
 * 它在这里的作用是给前端一个能读 `err_info` 的类型，而不是一道闸门。判题产物的
 * 闸门在写入侧，理由见上面 `JudgeCaseResult`。
 */
export const statisticInfoSchema = z.looseObject({
  score: z.number().optional(),
  /** 判题机写进 statistic_info 的错误文本，教师面板的「最近一条错在哪」也读它 */
  err_info: z.string().optional(),
  time_cost: z.number().optional(),
  memory_cost: z.number().optional(),
  ast_results: z
    .array(
      z.object({
        description: z.string(),
        passed: z.boolean(),
        /** count_* 规则实际数到的次数，判题机只在这两个引擎上写 */
        actual: z.number().optional(),
      }),
    )
    .optional(),
  /**
   * 运行时错误的诊断，judge/runtime-diagnosis.ts 写，前端翻成中文。只在非比赛提交上有。
   *
   * **不存异常的原文消息**：Python 的消息里常带着测试点的输入（`invalid literal for
   * int() with base 10: '1 2'`），给学生看就等于放出隐藏数据。所以只存归好类的
   * `kind`，和确实出现在学生自己代码里的名字。
   */
  runtime_error: z
    .object({
      /** 学生代码里的行号（已经扣掉题目模板的前置代码），对不上时为 null */
      line: z.number().int().nullable().optional(),
      /** Python 异常类型，如 ValueError */
      type: z.string().optional(),
      /** 细分，如 int-parse / index / str-concat，见 runtime-diagnosis.ts 的 KINDS */
      kind: z.string().optional(),
      /** NameError / AttributeError 点名的那个名字，只在它出现在学生代码里时才存 */
      name: z.string().optional(),
      /** NameError 的「Did you mean」，Python 从作用域里的名字挑的，不来自输入 */
      suggestion: z.string().optional(),
      /** C / C++：进程收到的信号（11 段错误、8 除零……）和退出码 */
      signal: z.number().int().optional(),
      exit_code: z.number().int().optional(),
    })
    .optional(),
  /**
   * 答案错误时拿题目的**公开样例**重跑的结果，judge/run.ts 的 checkSamples 写。
   * 只在非比赛提交上有。
   *
   * 这里的东西全是学生本来就看得到的：样例写在题面上，output 是他自己的程序在
   * 公开输入上的输出。隐藏测试点的内容一概不碰。三段文本都截断过（见 SAMPLE_TEXT_LIMIT）。
   */
  sample_check: z
    .object({
      /** 所有样例都过了（错在隐藏测试点上） */
      passed: z.boolean(),
      /** 第一个没过的样例，0 起；passed 为 true 时没有下面这些 */
      index: z.number().int().optional(),
      input: z.string().optional(),
      expected: z.string().optional(),
      output: z.string().optional(),
      /** 样例上的判题结果：多数是答案错误，也可能在样例上就超时、运行出错 */
      result: z.number().int().optional(),
    })
    .optional(),
})

/**
 * 编辑过程的聚合信号，落进 `submission_trace`。**只有计数，不含任何按键内容。**
 *
 * 口径是「自上次提交以来」的增量（前端每次提交成功后清零，切题也清零），
 * 所以同一道题连交几次，每条提交各记各的那一段。
 *
 * 全部来自客户端，**可以伪造** —— 这是接受了的：它只用来给「可信 AC」加权、
 * 给老师提示「建议关注」，不单独判任何事。服务端自己算的间隔另见 `since_prev_ms`。
 */
export const submissionTraceSchema = z.object({
  /** 活跃编辑时长：相邻两次编辑间隔不超过 60 秒才累加，页面不可见时不计 */
  activeMs: z.number().int().min(0).max(1e8),
  /** 打开这道题（或上次提交）到这次提交的墙钟时长 */
  sinceOpenMs: z.number().int().min(0).max(1e9),
  /** 键入、输入法上屏、补全插入的字符数 */
  typedChars: z.number().int().min(0).max(1e7),
  /** 粘贴、从外部拖入的字符数 */
  pastedChars: z.number().int().min(0).max(1e7),
  pasteCount: z.number().int().min(0).max(1e5),
  /** 单次最大粘贴的字符数 */
  maxPaste: z.number().int().min(0).max(1e7),
  deletedChars: z.number().int().min(0).max(1e7),
  /** 页面切到后台的次数（切标签页、切窗口、最小化）。只作辅助，别单独拿来说事 */
  blurCount: z.number().int().min(0).max(1e5),
  /** 这一段开始时编辑器里已有的字符数（本地草稿 / 模板 / 上次提交后的代码） */
  initialLen: z.number().int().min(0).max(1e7),
  /** 提交时这道题正在课堂协作中。老师替学生交的那条也会是 true，统计时要排掉 */
  collab: z.boolean(),
})

export const createSubmissionRequestSchema = z.object({
  problemId: z.number().int().positive(),
  /**
   * 提交的语言。用题目语言的联合而不是 `z.string()` —— 学生能选的语言就是题目
   * `languages` 里列出的那些，写宽松了的话，前端把语言拼错（`"C＋＋"`、`"python3"`
   * 大小写）会一路走到判题机才以 `Unsupported judge language` 报系统错误，
   * 学生看到的是「系统错误」而不是「语言不对」。
   */
  language: problemLanguageSchema,
  code: z
    .string()
    .min(1)
    .max(1024 * 1024),
  contestId: z.number().int().positive().optional(),
  /**
   * 来源题单。学生从 `/problemset/:id/problem/:pid` 那个入口提交时前端带上，
   * 后端落进 `submission.problemset_id`，提交列表据此标出「这条是刷题单刷出来的」。
   *
   * 只是**来源标记**，不参与判题、也不参与题单进度记账 —— 进度由判完之后的
   * `recordSolvedProblem` 记进所有已加入且含这道题的题单，和从哪个入口进来无关。
   * 所以这里带错了顶多是标记不准，不会影响成绩。
   */
  problemSetId: z.number().int().positive().optional(),
  /**
   * 编辑过程信号，见 submissionTraceSchema。**坏了就当没带**（`.catch`）：
   * 整个请求体是一把 safeParse，这里要是能 400，一份附带的统计数据就能挡住
   * 学生交作业。刷新过页面、老版本前端、脚本提交都会没有它，那是「无数据」，
   * 不是「可疑」。
   */
  trace: submissionTraceSchema.optional().catch(undefined),
})

export const createSubmissionResponseSchema = z.object({
  submissionId: z.string(),
})

/**
 * 通过了几个测试点，给学生看「离 AC 还差多远」。`info` 只给管理员（每个点带
 * output_md5），所以这里只算出两个数下发，不放开原文。
 *
 * 为 null 的情形：比赛提交（ACM 只报对错，多给通过数等于变相放水，和 AI 提示同口径）、
 * SQL 题（`judge/run.ts` 遇到被杀的测试点会 break，total 偏小）、没有逐点结果
 * （待判、编译失败）。
 */
export const caseSummarySchema = z
  .object({
    passed: z.number().int(),
    total: z.number().int(),
  })
  .nullable()

export const submissionDetailSchema = z.object({
  id: z.string(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  code: z.string(),
  result: judgeStatusSchema,
  /** 判题机原文；未判完或非管理员看时为 `{}`，见 JudgeInfo 的注释 */
  info: z.unknown(),
  language: problemLanguageSchema,
  statisticInfo: statisticInfoSchema,
  contestId: z.number().int().nullable(),
  problemId: z.number().int(),
  /**
   * 题目的展示编号（problem._id）。**独立的 /submission/:id 页面要靠它** ——
   * 那条路由只喂 submissionID，组件拿不到 display id，而「复制回到题目」要用它
   * 拼路由。原来只给内部数字 id，于是那个按钮在这条路由上一点就抛
   * `Missing required param "problemID"`。
   */
  problemDisplayId: z.string(),
  showLink: z.boolean(),
  /** 通过了几个测试点，口径见 caseSummarySchema */
  caseSummary: caseSummarySchema,
})

/**
 * 内嵌在别处（目前只有站内信）的提交对象。对齐旧后端的
 * `SubmissionSafeModelSerializer(exclude=("info", "contest", "ip"))` ——
 * 这些键**根本不出现**，而不是出现但值为空。（`ip` 已随 IP 功能整体删除。）
 *
 * 独立成一个 schema 而不是复用 submissionDetailSchema 传空值：形状一致了，
 * 将来有人「顺手」把空值改成真值就不会变成泄露，因为这里压根没有这些字段。
 */
export const embeddedSubmissionSchema = submissionDetailSchema
  // 留下 problemDisplayId（展示用题号）而不是数字主键：站内信页面拿它拼
  // `/problem/<题号>` 链接，给数字 id 会拼出打不开的地址。
  .omit({
    info: true,
    contestId: true,
    problemId: true,
    caseSummary: true,
  })

/**
 * 判题进度推送。**只带前端真正要用的东西**：靠 submissionId 认领、靠 result /
 * status 决定是继续等还是去拉详情。
 *
 * 这里曾经还带着 time_cost / memory_cost / err_info —— 从 statistic_info 原样
 * 抄一份出来，前端一处都没读过。耗时和错误信息在提交详情里本来就有，判完了去
 * 拉一次就是了，不必让推送顺带背一份 JSONB 的形状。
 */
export const submissionUpdateSchema = z.object({
  type: z.literal("submission_update"),
  submissionId: z.string(),
  result: judgeStatusSchema,
  status: z.enum(["pending", "judging", "finished", "error"]),
  score: z.number().optional(),
})

export const submissionListItemSchema = z.object({
  id: z.string(),
  problemDisplayId: z.string(),
  problemTitle: z.string(),
  showLink: z.boolean(),
  createTime: z.string(),
  userId: z.number().int(),
  username: z.string(),
  result: judgeStatusSchema,
  language: problemLanguageSchema,
  statisticInfo: statisticInfoSchema,
  /**
   * 来源题单，非题单入口提交的为 null。比赛提交恒为 null（比赛题不会进题单）。
   * 历史提交里只有「当年首次 AC 那一条」有值 —— 迁移 0007 从 problemset_submission
   * 回填的就是这些，其余老提交无从判断入口，一律留空。
   */
  problemSet: z.object({ id: z.number().int(), title: z.string() }).nullable(),
  /**
   * 通过了几个测试点，和详情同一个口径（见 caseSummarySchema）。列表上老师一眼要分出
   * 「差一个点」和「一个都没过」，不必逐条点开。
   */
  caseSummary: caseSummarySchema,
})

export const submissionListSchema = paginatedSchema(submissionListItemSchema)

/**
 * **一条都没交**的学生。`realName` 是从用户名里剥掉 `ks<班级号>` 前缀后剩下的那一段，
 * 不是 user.real_name 列 —— 与 F2「真名默认不下发」不冲突：这里只有教师能看到，
 * 且教师面板的用途正是点名谁没做。
 *
 * 注意它不是「未完成」的全部：交了但一次没对的学生在 `dataAttempted` 里。
 */
export const unacceptedStudentSchema = z.object({
  username: z.string(),
  realName: z.string(),
})

/**
 * **交了但一次没对**的学生。这批人原来两栏都不在 —— 不在「完成人数」（没 AC），
 * 也不在「未完成」名单（那一栏只收一条没交的），于是课堂上最该去看一眼的人
 * 反而从屏幕上消失了。`submissionCount` 是窗口内的提交次数，教师据此判断
 * 「卡了多久」。
 */
export const attemptedStudentSchema = unacceptedStudentSchema.extend({
  submissionCount: z.number().int(),
  /**
   * 已经解决的题数。查多道题时这一栏里混着「一道没对」和「三道做出两道」两种人，
   * 差几道决定了老师先管谁 —— 所以名字后面要缀 `2/3`。
   */
  solvedCount: z.number().int(),
  /**
   * 最近一条提交错在哪。教师点名字就能看到「是编译错了还是答案错了」，
   * 不必再切去提交列表翻这个人。`error` 是判题机写进 statistic_info 的 err_info，
   * 已截断；没有错误文本（比如答案错误那种）时为 null。
   */
  lastFailure: z
    .object({
      id: z.string(),
      /** 题目的展示编号，用来告诉老师错在哪道题 */
      problemDisplayId: z.string(),
      result: judgeStatusSchema,
      error: z.string().nullable(),
    })
    .nullable(),
})

export const submissionStatisticsUserSchema = z.object({
  username: z.string(),
  className: z.string().nullable(),
  submissionCount: z.number().int(),
  /** 通过的**提交条数**。correctRate 的分子就是它 */
  acceptedCount: z.number().int(),
  /**
   * 解决的**题数**（同一道题重复 AC 只算一道）。表格「已解决」那一列显示的是它 ——
   * 不指定题号查「这节课全班」时，条数和题数能差出好几倍。
   */
  solvedCount: z.number().int(),
  /**
   * 「答案对了但语法没按要求写」且**最后也没改对**的题数。这些题算在 solvedCount 里
   * （AST_CHECK_FAILED 全站都算通过），单列出来只是让教师看得见教学上没达标的那几个。
   */
  astOnlyCount: z.number().int(),
  /** 这个人还在判题队列里的条数。`submissionCount` 含它，`correctRate` 的分母不含 */
  judgingCount: z.number().int(),
  // 百分比数值，不带 %。旧后端返回 "85.5%" 字符串，展示格式化交给前端。
  correctRate: z.number(),
  /**
   * 这个人在本次查询的口径下做完了没有（查了 N 道题就要 N 道都解决）。
   *
   * `data` 里**没做完的人也在**，教师才能在同一张表里展开看他错在哪；「完成人数」
   * 和完成度算的是 `done` 为真的那些，不是 `data.length`。
   */
  done: z.boolean(),
})

/**
 * 展开行的明细，**按需拉**（GET /submissions/statistics/items）。
 *
 * 原来是随统计一起给每个人各带一份，可表格一次只展开一行 —— 生产快照上那是
 * 4.9 万行没人看的数据。`truncated` 为真时前端要说明「只显示最近 N 条」，
 * 免得老师以为这人就交了这么多。
 */
export const submissionStatisticsItemsSchema = z.object({
  /**
   * 展开某个学生时列出他这段时间的提交。**带上题目**：一节课里学生往往在好几道题
   * 之间来回跳，一串只有编号的按钮看不出他卡在哪一道 —— 前端按题目分组展示。
   *
   * 字段名沿用 submissionListItemSchema 的口径：`problemDisplayId` 是展示用题号（problem._id），
   * `problemTitle` 是标题。
   */
  items: z.array(
    z.object({
      id: z.string(),
      result: judgeStatusSchema,
      createTime: z.string(),
      problemDisplayId: z.string(),
      problemTitle: z.string(),
    }),
  ),
  truncated: z.boolean(),
})

/**
 * 统计页的方块串（GET /submissions/statistics/grid）：范围内每个学生的每一次提交，
 * 前端按「人 × 题」排成方块串，并据此算每道题做完几人。计数口径（正确率、做完、没交）
 * 仍以 submissionStatisticsSchema 为准，这里只给「每一次交了什么结果」。
 *
 * 只含普通学生（老师试题留下的提交不混进来），最多 5000 条最近的，超了 `truncated`。
 * `classSizes` 只在没传用户名（从题目页进来、按班级汇总）时给：各班花名册人数。
 */
export const submissionStatisticsGridSchema = z.object({
  /** 传了题号就按传的顺序；没传就是范围内出现过的题，按第一次有人交的时间排 */
  problems: z.array(z.object({ problemDisplayId: z.string(), title: z.string() })),
  rows: z.array(
    z.object({
      username: z.string(),
      /** 剥掉 `ks<班级号>` 前缀后的那段，同 unacceptedStudentSchema.realName */
      realName: z.string(),
      className: z.string().nullable(),
      /** 从早到晚 */
      submissions: z.array(
        z.object({
          id: z.string(),
          problemDisplayId: z.string(),
          result: judgeStatusSchema,
          createTime: z.string(),
        }),
      ),
    }),
  ),
  classSizes: z.record(z.string(), z.number().int()),
  truncated: z.boolean(),
})

export const submissionStatisticsSchema = z.object({
  submissionCount: z.number().int(),
  acceptedCount: z.number().int(),
  /**
   * 还没判完的条数（PENDING / JUDGING）。`submissionCount` 把它算在内，
   * `correctRate` 的分母不算 —— 全班同时交卷的那几秒，分母涨了分子没涨，
   * 正确率会凭空掉一截。下发它是为了让教师看得出「那几条还在判」。
   */
  judgingCount: z.number().int(),
  correctRate: z.number(),
  // 花名册人数（未禁用的普通用户）。**只有这一个分母下发**：完成度由前端算，
  // 因为「请假隐藏」会把请假的人从分母里减掉，那是后端不知道的浏览器本地状态。
  personCount: z.number().int(),
  /** 窗口里交过东西的所有人（做没做完看 `done`），按提交数倒序 */
  data: z.array(submissionStatisticsUserSchema),
  /** 一条都没交的（花名册里的人减去有提交的人） */
  dataUnaccepted: z.array(unacceptedStudentSchema),
  /**
   * 交了但没做完的（一道没对，或者查三道只做出两道）。
   *
   * 传了用户名时按花名册取，和 dataUnaccepted 同一个范围；不传用户名时没有花名册，
   * 退回「窗口内有提交但没做完的全部普通学生」—— 否则这批人两栏都不在，看起来
   * 就像统计只认成功的提交。dataUnaccepted 没有花名册就真的算不出来，仍然为空。
   */
  dataAttempted: z.array(attemptedStudentSchema),
})

/**
 * 提交列表那颗「今日提交数」标签点开之后的统计弹框（GET /submissions/today-statistics）。
 *
 * **公开接口，只下发聚合数** —— 没有用户名、没有代码、没有隐藏题目的标题，学生和
 * 匿名访客看到的和教师一样。教师那套按班级/按题号钻取的口径在
 * `submissionStatisticsSchema`，两者不是一回事，别把这个当它的简版去加字段。
 *
 * 口径跟着那颗标签走：**东八区今天、非比赛提交、不分语言**（语言分布就是
 * `languages` 这张表本身）。
 */
export const todaySubmissionStatisticsSchema = z.object({
  total: z.number().int(),
  /** 通过的条数，含 AST_CHECK_FAILED（那也是答案对了） */
  accepted: z.number().int(),
  /**
   * 还没判完的条数（PENDING / JUDGING）。`total` 把它算在内，`correctRate` 的分母
   * 不算 —— 全班同时交卷的那几秒，分母涨了分子没涨，正确率会凭空掉一截。
   */
  judging: z.number().int(),
  correctRate: z.number(),
  /** 今天交过东西的人数，按 user_id 去重 */
  userCount: z.number().int(),
  /** 按东八区钟点分的 24 个桶，**下标就是钟点**，没有提交的钟点是 0 */
  hours: z.array(z.number().int()).length(24),
  /** 按语言，提交数倒序。零提交的语言不在表里 */
  languages: z.array(z.object({ language: problemLanguageSchema, count: z.number().int() })),
  /** 按判题结果，条数倒序 */
  results: z.array(z.object({ result: judgeStatusSchema, count: z.number().int() })),
  /**
   * 今天最热的几道题，提交数倒序，最多 10 道。
   * **只含公开可见的题目** —— 这个接口不需要登录，不能拿它探未发布题目的标题。
   */
  problems: z.array(
    z.object({
      problemDisplayId: z.string(),
      problemTitle: z.string(),
      count: z.number().int(),
      acceptedCount: z.number().int(),
    }),
  ),
})

export const formatCodeRequestSchema = z.object({
  code: z.string().max(1024 * 1024),
  language: z.enum(["python", "c", "cpp", "sql"]),
})

export const formatCodeResponseSchema = z.object({ code: z.string() })

/** 试运行一次最多几组。学生那边只有「运行例子」（一般两三个）和「自己输入」（一个） */
export const TRIAL_MAX_CASES = 10
/** 后台「生成测试点」一次跑的组数上限，只有管理员能用到 */
export const TRIAL_ADMIN_MAX_CASES = 50

/**
 * 试运行：「运行例子」「自己输入」、后台「生成测试点」。走本站判题机，不落库、不算提交。
 *
 * - 带 `problemId`：按这道题的时间 / 内存限制和代码模板跑，和提交一个口径；
 * - 不带：只有管理员能这么调（后台生成测试点时题目可能还没存）。
 *
 * `output` 是这组的正确输出，给了就由判题机比对（和提交一样去掉末尾空白再比），
 * 结果是通过 / 答案错误；不给（「自己输入」、生成测试点）就只看有没有跑出错。
 */
export const trialRunRequestSchema = z.object({
  problemId: z.number().int().positive().optional(),
  contestId: z.number().int().positive().optional(),
  language: runnableLanguageSchema,
  code: z
    .string()
    .min(1)
    .max(1024 * 1024),
  cases: z
    .array(
      z.object({
        input: z.string().max(1024 * 1024),
        output: z
          .string()
          .max(1024 * 1024)
          .optional(),
      }),
    )
    .min(1)
    .max(TRIAL_ADMIN_MAX_CASES),
})

/**
 * - `done`：每组一条，顺序和请求里的 `cases` 一致。`result` 是判题机那套码；
 *   没给正确输出的组，跑完没出错就是通过。`output` 里 stdout 和 stderr 是混在一起的
 *   （判题机把两者写进同一个文件），Python 的报错原文就在这里。运行时错误的组另带
 *   `runtimeError`：和提交的 `statistic_info.runtime_error` 同一个解析（第几行、什么异常），
 *   解析不出来时没有这个字段。
 * - `compile-error`：编译没过（Python 是语法错误），一组都没跑。
 * - `too-much-output`：程序输出多到判题机回包超过上限，多半是死循环在不停打印。
 */
export type TrialRunResponse =
  | {
      status: "done"
      cases: {
        result: JudgeStatus
        output: string
        runtimeError?: NonNullable<StatisticInfo["runtime_error"]>
      }[]
    }
  | { status: "compile-error"; message: string }
  | { status: "too-much-output" }

export type StatisticInfo = z.infer<typeof statisticInfoSchema>
export type SubmissionTrace = z.infer<typeof submissionTraceSchema>
export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequestSchema>
export type SubmissionDetail = z.infer<typeof submissionDetailSchema>
export type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>
export type SubmissionStatistics = z.infer<typeof submissionStatisticsSchema>
export type TodaySubmissionStatistics = z.infer<typeof todaySubmissionStatisticsSchema>
export type SubmissionStatisticsUser = z.infer<typeof submissionStatisticsUserSchema>
export type SubmissionStatisticsItems = z.infer<typeof submissionStatisticsItemsSchema>
export type SubmissionStatisticsGrid = z.infer<typeof submissionStatisticsGridSchema>
export type UnacceptedStudent = z.infer<typeof unacceptedStudentSchema>
export type AttemptedStudent = z.infer<typeof attemptedStudentSchema>

export type SubmissionListItem = z.infer<typeof submissionListItemSchema>
export type SubmissionList = z.infer<typeof submissionListSchema>
export type EmbeddedSubmission = z.infer<typeof embeddedSubmissionSchema>
export type CreateSubmissionResponse = z.infer<typeof createSubmissionResponseSchema>
export type FormatCodeResponse = z.infer<typeof formatCodeResponseSchema>

export type FormatCodeRequest = z.infer<typeof formatCodeRequestSchema>
export type TrialRunRequest = z.infer<typeof trialRunRequestSchema>
