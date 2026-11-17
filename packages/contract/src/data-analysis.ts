import { z } from 'zod'

import { sampleUserSchema } from './common'

/**
 * 「数据分析」（代码里叫 dataAnalysis）：教 pandas / matplotlib 的新板块，设计见
 * docs/specs/2026-11-12-data-analysis-design.md。代码在独立的运行器里跑（docker/data-analysis/），
 * 下面「运行结果」那几个 schema 就是运行器回的形状，api 原样转给前端。
 */

/** normal：普通步骤；open：开放步骤（不检查，学生交一张图和一句话给老师看） */
export const DATA_ANALYSIS_STEP_KINDS = ['normal', 'open'] as const
export type DataAnalysisStepKind = (typeof DATA_ANALYSIS_STEP_KINDS)[number]

/** none：跑通就算对；compare：对照答案（默认）；script：老师写的检查脚本 */
export const DATA_ANALYSIS_CHECK_KINDS = ['none', 'compare', 'script'] as const
export type DataAnalysisCheckKind = (typeof DATA_ANALYSIS_CHECK_KINDS)[number]

export const DATA_ANALYSIS_MAX_STEPS = 30
export const DATA_ANALYSIS_MAX_CODE = 20000
/** 素材：单个文件、一节加起来的上限。素材存在库里（data_analysis_asset.data），别放太大的 */
export const DATA_ANALYSIS_ASSET_MAX_BYTES = 5 * 1024 * 1024
export const DATA_ANALYSIS_ASSETS_MAX_TOTAL_BYTES = 20 * 1024 * 1024

/** 对照答案时图里比哪几样。都不勾等于不比图，那时 figure 存 null */
export const dataAnalysisFigureCheckSchema = z.object({
  values: z.boolean(),
  title: z.boolean(),
  labels: z.boolean(),
})

const code = z.string().max(DATA_ANALYSIS_MAX_CODE)

/**
 * 出题页存的一步。`referenceCode`（答案）每个普通步骤都该有：对照答案时后面的步骤要拿前面各步的答案
 * 接着跑，学生做对后也能看到它。语义上的要求（对照答案得有答案、得比点什么）不挂在 zod 上，
 * 见 api 的 dataAnalysisStepError()，好给出中文的、指到第几步的说法。
 */
export const dataAnalysisStepInputSchema = z.object({
  /** 已有的步骤带 id（改），新加的不带（建）。没出现在列表里的已有步骤会被删掉，连同学生在那一步的进度 */
  id: z.number().int().positive().optional(),
  kind: z.enum(DATA_ANALYSIS_STEP_KINDS),
  title: z.string().trim().min(1).max(128),
  description: z.string().max(DATA_ANALYSIS_MAX_CODE),
  starterCode: code,
  referenceCode: code,
  checkKind: z.enum(DATA_ANALYSIS_CHECK_KINDS),
  compareVars: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(10),
  compareFigure: dataAnalysisFigureCheckSchema.nullable(),
  checkScript: code,
})

export const saveDataAnalysisRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string().max(DATA_ANALYSIS_MAX_CODE),
  isPublic: z.boolean(),
  steps: z.array(dataAnalysisStepInputSchema).max(DATA_ANALYSIS_MAX_STEPS),
})

export const createDataAnalysisRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
})

/** 后台列表拖动排序：全部的 id 按新顺序排好整串交上来 */
export const reorderDataAnalysesRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

export const dataAnalysisAssetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  size: z.number().int(),
})

export const adminDataAnalysisStepSchema = dataAnalysisStepInputSchema.extend({ id: z.number().int() })

export const adminDataAnalysisSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  steps: z.array(adminDataAnalysisStepSchema),
  assets: z.array(dataAnalysisAssetSchema),
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminDataAnalysisListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  isPublic: z.boolean(),
  stepCount: z.number().int(),
  /** 动过手的学生数（至少运行过一次） */
  students: z.number().int(),
  createdBy: sampleUserSchema,
  updatedAt: z.string(),
})

/**
 * 出题页「试跑这一步」：拿编辑器里还没存的内容，用答案把第 1 步一直跑到第 index 步。
 * 素材用这一节已经上传的（上传是即时的，不等保存）。
 */
export const dataAnalysisTrialRequestSchema = z.object({
  steps: z.array(dataAnalysisStepInputSchema).min(1).max(DATA_ANALYSIS_MAX_STEPS),
  index: z.number().int().min(0),
})

// ---------------------------------------------------------------- 运行结果（运行器回的形状）

export const dataAnalysisTextOutputSchema = z.object({ kind: z.literal('text'), text: z.string() })
export const dataAnalysisTableOutputSchema = z.object({
  kind: z.literal('table'),
  columns: z.array(z.string()),
  /** 每行第一格是索引 */
  rows: z.array(z.array(z.string())),
  shape: z.tuple([z.number().int(), z.number().int()]),
  /** 行太多时只给头尾，中间在第几行之后省略 */
  skipAfter: z.number().int().nullable(),
  colsTruncated: z.boolean(),
})
export const dataAnalysisImageOutputSchema = z.object({ kind: z.literal('image'), png: z.string() })
export const dataAnalysisOutputSchema = z.discriminatedUnion('kind', [
  dataAnalysisTextOutputSchema,
  dataAnalysisTableOutputSchema,
  dataAnalysisImageOutputSchema,
])

/**
 * `type` 是 Python 的异常名（英文原文，前端翻译），外加运行器自己的两个：
 * Timeout（超时）、Crashed（进程意外退出，多半是内存）。`step` 从 1 数。
 */
export const dataAnalysisRunErrorSchema = z.object({
  step: z.number().int(),
  type: z.string(),
  message: z.string(),
  line: z.number().int().nullable(),
  traceback: z.string(),
})

export const dataAnalysisCheckResultSchema = z.object({
  passed: z.boolean(),
  /** 给学生看的中文说法，最多三条 */
  messages: z.array(z.string()),
  /** 检查脚本自己炸了（老师写错了），只给老师看 */
  scriptError: z.string().optional(),
})

export const dataAnalysisRunResultSchema = z.object({
  ok: z.boolean(),
  outputs: z.array(dataAnalysisOutputSchema),
  truncated: z.boolean(),
  error: dataAnalysisRunErrorSchema.nullable(),
  /** 学生代码报错、或答案本身有问题时是 null */
  check: dataAnalysisCheckResultSchema.nullable(),
  /** 答案跑不通 / 答案里没有要比的变量：这时不判学生 */
  referenceError: dataAnalysisRunErrorSchema.nullable(),
  /** 比图时答案画了什么（「4 根柱子，标题「各科平均分」」） */
  referenceSummary: z.string().nullable(),
  timeMs: z.number().int(),
})

/** 素材预览：表格类素材的前几行。不是表格的（或读不出来的）table 为 null */
export const dataAnalysisAssetPreviewSchema = z.object({
  table: dataAnalysisTableOutputSchema.nullable(),
  error: z.string().nullable(),
})

// ---------------------------------------------------------------- 学生这边

export const dataAnalysisListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  stepCount: z.number().int(),
  /** 当前学生做对（开放步骤：交了）几步；没登录是 0 */
  passedCount: z.number().int(),
  /** 只有老师看得到没公开的，这时是 false */
  isPublic: z.boolean(),
})

export const dataAnalysisStepSchema = z.object({
  id: z.number().int(),
  kind: z.enum(DATA_ANALYSIS_STEP_KINDS),
  title: z.string(),
  description: z.string(),
  starterCode: z.string(),
  checkKind: z.enum(DATA_ANALYSIS_CHECK_KINDS),
  /** 学生存着的代码；没动过手是 null（前端就用 starterCode） */
  code: z.string().nullable(),
  passed: z.boolean(),
  runs: z.number().int(),
  /** 老师的写法：做对了才给（设计文档第 2 节第 9 条），老师自己看永远给 */
  referenceCode: z.string().nullable(),
  /** 开放步骤交了的那句话 */
  openText: z.string().nullable(),
  submittedAt: z.string().nullable(),
})

export const dataAnalysisDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  assets: z.array(dataAnalysisAssetSchema),
  steps: z.array(dataAnalysisStepSchema),
})

/** 自动保存一步的代码 */
export const saveDataAnalysisCodeRequestSchema = z.object({ code: z.string().max(DATA_ANALYSIS_MAX_CODE) })

/** 运行第 k 步：带上第 1…k 步编辑器里的代码（前面的步骤可能改过还没存，跑的就是学生眼前那一份） */
export const runDataAnalysisStepRequestSchema = z.object({
  codes: z.array(z.string().max(DATA_ANALYSIS_MAX_CODE)).min(1).max(DATA_ANALYSIS_MAX_STEPS),
  /**
   * 这几段代码各是哪一步的（和 codes 一一对应）。课上老师调了步骤顺序、学生没刷新时，只核步数会把
   * 第 1 步的代码存到第 2 步上。可省是为了上线那一刻还开着的旧页面照样能运行。
   */
  stepIds: z.array(z.number().int().positive()).max(DATA_ANALYSIS_MAX_STEPS).optional(),
})

/** 开放步骤交上去：一句话 + 交的那一刻的代码（第 1…k 步，图由它现跑） */
export const submitDataAnalysisOpenRequestSchema = z.object({
  codes: z.array(z.string().max(DATA_ANALYSIS_MAX_CODE)).min(1).max(DATA_ANALYSIS_MAX_STEPS),
  /** 同运行 */
  stepIds: z.array(z.number().int().positive()).max(DATA_ANALYSIS_MAX_STEPS).optional(),
  text: z.string().trim().min(1).max(500),
})

/** 学生运行一步的回应：运行结果 + 这次做对了的话老师的写法 */
export const dataAnalysisStepRunResponseSchema = dataAnalysisRunResultSchema.extend({
  passed: z.boolean(),
  referenceCode: z.string().nullable(),
})

// ---------------------------------------------------------------- 老师：全班进度（画布 DataAnalysisProgress）

export const dataAnalysisProgressCellSchema = z.object({
  passed: z.boolean(),
  runs: z.number().int(),
  /** 最近一次没过的原因：给学生的头一条说法，或 `error:异常名`；做对了 / 没跑过是 null */
  lastFailure: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  passedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
})

export const dataAnalysisProgressSchema = z.object({
  /** 看的是哪个班；这一节还没人做、也猜不出正在上课的班时是 null */
  className: z.string().nullable(),
  /** 做过这一节的班，人多的在前（班级下拉里排最前面） */
  classes: z.array(z.string()),
  steps: z.array(z.object({ id: z.number().int(), title: z.string(), kind: z.enum(DATA_ANALYSIS_STEP_KINDS) })),
  /** 这个班的全部学生（没动手的也在），steps 和上面一一对应 */
  students: z.array(
    z.object({
      id: z.number().int(),
      username: z.string(),
      className: z.string().nullable(),
      steps: z.array(dataAnalysisProgressCellSchema),
    }),
  ),
})

/** 点名字看一个学生：每一步存着的代码、开放步骤交的东西 */
export const dataAnalysisStudentWorkSchema = z.object({
  steps: z.array(
    z.object({
      code: z.string().nullable(),
      openText: z.string().nullable(),
      openCode: z.string().nullable(),
    }),
  ),
})

export type DataAnalysisProgressCell = z.infer<typeof dataAnalysisProgressCellSchema>
export type DataAnalysisProgress = z.infer<typeof dataAnalysisProgressSchema>
export type DataAnalysisStudentWork = z.infer<typeof dataAnalysisStudentWorkSchema>
export type DataAnalysisStepRunResponse = z.infer<typeof dataAnalysisStepRunResponseSchema>
export type DataAnalysisListItem = z.infer<typeof dataAnalysisListItemSchema>
export type DataAnalysisStep = z.infer<typeof dataAnalysisStepSchema>
export type DataAnalysisDetail = z.infer<typeof dataAnalysisDetailSchema>
export type SaveDataAnalysisCodeRequest = z.infer<typeof saveDataAnalysisCodeRequestSchema>
export type RunDataAnalysisStepRequest = z.infer<typeof runDataAnalysisStepRequestSchema>
export type SubmitDataAnalysisOpenRequest = z.infer<typeof submitDataAnalysisOpenRequestSchema>

export type DataAnalysisFigureCheck = z.infer<typeof dataAnalysisFigureCheckSchema>
export type DataAnalysisStepInput = z.infer<typeof dataAnalysisStepInputSchema>
export type SaveDataAnalysisRequest = z.infer<typeof saveDataAnalysisRequestSchema>
export type CreateDataAnalysisRequest = z.infer<typeof createDataAnalysisRequestSchema>
export type ReorderDataAnalysesRequest = z.infer<typeof reorderDataAnalysesRequestSchema>
export type DataAnalysisAsset = z.infer<typeof dataAnalysisAssetSchema>
export type AdminDataAnalysisStep = z.infer<typeof adminDataAnalysisStepSchema>
export type AdminDataAnalysis = z.infer<typeof adminDataAnalysisSchema>
export type AdminDataAnalysisListItem = z.infer<typeof adminDataAnalysisListItemSchema>
export type DataAnalysisTrialRequest = z.infer<typeof dataAnalysisTrialRequestSchema>
export type DataAnalysisOutput = z.infer<typeof dataAnalysisOutputSchema>
export type DataAnalysisTableOutput = z.infer<typeof dataAnalysisTableOutputSchema>
export type DataAnalysisRunError = z.infer<typeof dataAnalysisRunErrorSchema>
export type DataAnalysisCheckResult = z.infer<typeof dataAnalysisCheckResultSchema>
export type DataAnalysisRunResult = z.infer<typeof dataAnalysisRunResultSchema>
export type DataAnalysisAssetPreview = z.infer<typeof dataAnalysisAssetPreviewSchema>
