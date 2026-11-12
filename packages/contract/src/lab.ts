import { z } from 'zod'

import { sampleUserSchema } from './common'

/**
 * 「数据分析」（代码里叫 lab）：教 pandas / matplotlib 的新板块，设计见
 * docs/specs/2026-11-12-data-analysis-lab-design.md。代码在独立的运行器里跑（docker/lab/），
 * 下面「运行结果」那几个 schema 就是运行器回的形状，api 原样转给前端。
 */

/** normal：普通步骤；open：开放步骤（不检查，学生交一张图和一句话给老师看） */
export const LAB_STEP_KINDS = ['normal', 'open'] as const
export type LabStepKind = (typeof LAB_STEP_KINDS)[number]

/** none：跑通就算对；compare：对照答案（默认）；script：老师写的检查脚本 */
export const LAB_CHECK_KINDS = ['none', 'compare', 'script'] as const
export type LabCheckKind = (typeof LAB_CHECK_KINDS)[number]

export const LAB_MAX_STEPS = 30
export const LAB_MAX_CODE = 20000
/** 素材：单个文件、一节加起来的上限。素材存在库里（lab_asset.data），别放太大的 */
export const LAB_ASSET_MAX_BYTES = 5 * 1024 * 1024
export const LAB_ASSETS_MAX_TOTAL_BYTES = 20 * 1024 * 1024

/** 对照答案时图里比哪几样。都不勾等于不比图，那时 figure 存 null */
export const labFigureCheckSchema = z.object({
  values: z.boolean(),
  title: z.boolean(),
  labels: z.boolean(),
})

const code = z.string().max(LAB_MAX_CODE)

/**
 * 出题页存的一步。`referenceCode`（答案）每个普通步骤都该有：对照答案时后面的步骤要拿前面各步的答案
 * 接着跑，学生做对后也能看到它。语义上的要求（对照答案得有答案、得比点什么）不挂在 zod 上，
 * 见 api 的 labStepError()，好给出中文的、指到第几步的说法。
 */
export const labStepInputSchema = z.object({
  /** 已有的步骤带 id（改），新加的不带（建）。没出现在列表里的已有步骤会被删掉，连同学生在那一步的进度 */
  id: z.number().int().positive().optional(),
  kind: z.enum(LAB_STEP_KINDS),
  title: z.string().trim().min(1).max(128),
  description: z.string().max(LAB_MAX_CODE),
  starterCode: code,
  referenceCode: code,
  checkKind: z.enum(LAB_CHECK_KINDS),
  compareVars: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(10),
  compareFigure: labFigureCheckSchema.nullable(),
  checkScript: code,
})

export const saveLabRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
  description: z.string().max(LAB_MAX_CODE),
  isPublic: z.boolean(),
  steps: z.array(labStepInputSchema).max(LAB_MAX_STEPS),
})

export const createLabRequestSchema = z.object({
  title: z.string().trim().min(1).max(128),
})

/** 后台列表拖动排序：全部的 id 按新顺序排好整串交上来 */
export const reorderLabsRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

export const labAssetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  size: z.number().int(),
})

export const adminLabStepSchema = labStepInputSchema.extend({ id: z.number().int() })

export const adminLabSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  steps: z.array(adminLabStepSchema),
  assets: z.array(labAssetSchema),
  createdBy: sampleUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminLabListItemSchema = z.object({
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
export const labTrialRequestSchema = z.object({
  steps: z.array(labStepInputSchema).min(1).max(LAB_MAX_STEPS),
  index: z.number().int().min(0),
})

// ---------------------------------------------------------------- 运行结果（运行器回的形状）

export const labTextOutputSchema = z.object({ kind: z.literal('text'), text: z.string() })
export const labTableOutputSchema = z.object({
  kind: z.literal('table'),
  columns: z.array(z.string()),
  /** 每行第一格是索引 */
  rows: z.array(z.array(z.string())),
  shape: z.tuple([z.number().int(), z.number().int()]),
  /** 行太多时只给头尾，中间在第几行之后省略 */
  skipAfter: z.number().int().nullable(),
  colsTruncated: z.boolean(),
})
export const labImageOutputSchema = z.object({ kind: z.literal('image'), png: z.string() })
export const labOutputSchema = z.discriminatedUnion('kind', [labTextOutputSchema, labTableOutputSchema, labImageOutputSchema])

/**
 * `type` 是 Python 的异常名（英文原文，前端翻译），外加运行器自己的两个：
 * Timeout（超时）、Crashed（进程意外退出，多半是内存）。`step` 从 1 数。
 */
export const labRunErrorSchema = z.object({
  step: z.number().int(),
  type: z.string(),
  message: z.string(),
  line: z.number().int().nullable(),
  traceback: z.string(),
})

export const labCheckResultSchema = z.object({
  passed: z.boolean(),
  /** 给学生看的中文说法，最多三条 */
  messages: z.array(z.string()),
  /** 检查脚本自己炸了（老师写错了），只给老师看 */
  scriptError: z.string().optional(),
})

export const labRunResultSchema = z.object({
  ok: z.boolean(),
  outputs: z.array(labOutputSchema),
  truncated: z.boolean(),
  error: labRunErrorSchema.nullable(),
  /** 学生代码报错、或答案本身有问题时是 null */
  check: labCheckResultSchema.nullable(),
  /** 答案跑不通 / 答案里没有要比的变量：这时不判学生 */
  referenceError: labRunErrorSchema.nullable(),
  /** 比图时答案画了什么（「4 根柱子，标题「各科平均分」」） */
  referenceSummary: z.string().nullable(),
  timeMs: z.number().int(),
})

/** 素材预览：表格类素材的前几行。不是表格的（或读不出来的）table 为 null */
export const labAssetPreviewSchema = z.object({
  table: labTableOutputSchema.nullable(),
  error: z.string().nullable(),
})

// ---------------------------------------------------------------- 学生这边

export const labListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  stepCount: z.number().int(),
  /** 当前学生做对（开放步骤：交了）几步；没登录是 0 */
  passedCount: z.number().int(),
  /** 只有老师看得到没公开的，这时是 false */
  isPublic: z.boolean(),
})

export const labStepSchema = z.object({
  id: z.number().int(),
  kind: z.enum(LAB_STEP_KINDS),
  title: z.string(),
  description: z.string(),
  starterCode: z.string(),
  checkKind: z.enum(LAB_CHECK_KINDS),
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

export const labDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  assets: z.array(labAssetSchema),
  steps: z.array(labStepSchema),
})

/** 自动保存一步的代码 */
export const saveLabCodeRequestSchema = z.object({ code: z.string().max(LAB_MAX_CODE) })

/** 运行第 k 步：带上第 1…k 步编辑器里的代码（前面的步骤可能改过还没存，跑的就是学生眼前那一份） */
export const runLabStepRequestSchema = z.object({
  codes: z.array(z.string().max(LAB_MAX_CODE)).min(1).max(LAB_MAX_STEPS),
})

/** 开放步骤交上去：一句话 + 交的那一刻的代码（第 1…k 步，图由它现跑） */
export const submitLabOpenRequestSchema = z.object({
  codes: z.array(z.string().max(LAB_MAX_CODE)).min(1).max(LAB_MAX_STEPS),
  text: z.string().trim().min(1).max(500),
})

/** 学生运行一步的回应：运行结果 + 这次做对了的话老师的写法 */
export const labStepRunResponseSchema = labRunResultSchema.extend({
  passed: z.boolean(),
  referenceCode: z.string().nullable(),
})

// ---------------------------------------------------------------- 老师：全班进度（画布 LabProgress）

export const labProgressCellSchema = z.object({
  passed: z.boolean(),
  runs: z.number().int(),
  /** 最近一次没过的原因：给学生的头一条说法，或 `error:异常名`；做对了 / 没跑过是 null */
  lastFailure: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  passedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
})

export const labProgressSchema = z.object({
  /** 看的是哪个班；这一节还没人做、也猜不出正在上课的班时是 null */
  className: z.string().nullable(),
  /** 做过这一节的班，人多的在前（班级下拉里排最前面） */
  classes: z.array(z.string()),
  steps: z.array(z.object({ id: z.number().int(), title: z.string(), kind: z.enum(LAB_STEP_KINDS) })),
  /** 这个班的全部学生（没动手的也在），steps 和上面一一对应 */
  students: z.array(
    z.object({
      id: z.number().int(),
      username: z.string(),
      className: z.string().nullable(),
      steps: z.array(labProgressCellSchema),
    }),
  ),
})

/** 点名字看一个学生：每一步存着的代码、开放步骤交的东西 */
export const labStudentWorkSchema = z.object({
  steps: z.array(
    z.object({
      code: z.string().nullable(),
      openText: z.string().nullable(),
      openCode: z.string().nullable(),
    }),
  ),
})

export type LabProgressCell = z.infer<typeof labProgressCellSchema>
export type LabProgress = z.infer<typeof labProgressSchema>
export type LabStudentWork = z.infer<typeof labStudentWorkSchema>
export type LabStepRunResponse = z.infer<typeof labStepRunResponseSchema>
export type LabListItem = z.infer<typeof labListItemSchema>
export type LabStep = z.infer<typeof labStepSchema>
export type LabDetail = z.infer<typeof labDetailSchema>
export type SaveLabCodeRequest = z.infer<typeof saveLabCodeRequestSchema>
export type RunLabStepRequest = z.infer<typeof runLabStepRequestSchema>
export type SubmitLabOpenRequest = z.infer<typeof submitLabOpenRequestSchema>

export type LabFigureCheck = z.infer<typeof labFigureCheckSchema>
export type LabStepInput = z.infer<typeof labStepInputSchema>
export type SaveLabRequest = z.infer<typeof saveLabRequestSchema>
export type CreateLabRequest = z.infer<typeof createLabRequestSchema>
export type ReorderLabsRequest = z.infer<typeof reorderLabsRequestSchema>
export type LabAsset = z.infer<typeof labAssetSchema>
export type AdminLabStep = z.infer<typeof adminLabStepSchema>
export type AdminLab = z.infer<typeof adminLabSchema>
export type AdminLabListItem = z.infer<typeof adminLabListItemSchema>
export type LabTrialRequest = z.infer<typeof labTrialRequestSchema>
export type LabOutput = z.infer<typeof labOutputSchema>
export type LabTableOutput = z.infer<typeof labTableOutputSchema>
export type LabRunError = z.infer<typeof labRunErrorSchema>
export type LabCheckResult = z.infer<typeof labCheckResultSchema>
export type LabRunResult = z.infer<typeof labRunResultSchema>
export type LabAssetPreview = z.infer<typeof labAssetPreviewSchema>
