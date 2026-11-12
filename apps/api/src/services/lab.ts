/**
 * 「数据分析」：和运行器（docker/lab/）打交道的那一层。
 *
 * 运行器不联网，走 unix socket（config.labSocket）；协议见 docker/lab/README.md。
 * 每次运行把这一节的素材原样带过去（运行器里没有素材目录，学生读不到别的节的文件），
 * 素材按 id 缓存在内存里 —— lab_asset 只增不改，同一个 id 的内容永远不变。
 */
import type { LabAssetPreview, LabFigureCheck, LabRunResult, LabStepInput } from '@oj2/contract'
import { eq, inArray } from 'drizzle-orm'

import { config } from '../config'
import { db, schema } from '../db'

export class LabRunnerError extends Error {}
/** 同一个人上一次还没跑完 */
export class LabBusyError extends Error {}

/** 运行器自己的墙钟是 20 秒；并发满了要排队，这里给足余量 */
const RUN_TIMEOUT_MS = 90_000

export interface LabRunnerRequest {
  assets: { name: string; data: string }[]
  steps: string[]
  reference?: string[]
  check: { kind: 'none' } | { kind: 'compare'; vars: string[]; figure: LabFigureCheck | null } | { kind: 'script'; script: string }
}

const inFlight = new Set<number>()

/** 发一次运行。同一个人同时只能有一次在跑（运行器那边总共就三个名额）。 */
export async function runLab(userId: number, request: LabRunnerRequest): Promise<LabRunResult> {
  if (inFlight.has(userId)) throw new LabBusyError()
  inFlight.add(userId)
  try {
    return await callRunner(request)
  } finally {
    inFlight.delete(userId)
  }
}

async function callRunner(request: LabRunnerRequest): Promise<LabRunResult> {
  let res: Response
  try {
    res = await fetch('http://lab/run', {
      unix: config.labSocket,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    })
  } catch (error) {
    throw new LabRunnerError(`连不上运行器（${config.labSocket}）：${error instanceof Error ? error.message : error}`)
  }
  if (!res.ok) throw new LabRunnerError(`运行器回了 HTTP ${res.status}：${await res.text()}`)
  // 运行器回的就是契约 labRunResultSchema 的形状（docker/lab/runner.py 的 handle_run），不再 parse
  return (await res.json()) as LabRunResult
}

// ---------------------------------------------------------------- 素材

const ASSET_CACHE_LIMIT = 64 * 1024 * 1024
const assetCache = new Map<number, string>()
let assetCacheSize = 0

function rememberAsset(id: number, base64: string) {
  assetCache.set(id, base64)
  assetCacheSize += base64.length
  for (const [oldId, value] of assetCache) {
    if (assetCacheSize <= ASSET_CACHE_LIMIT) break
    assetCache.delete(oldId)
    assetCacheSize -= value.length
  }
}

/** 一节的全部素材，按运行器要的形状（base64）。 */
export async function labAssetsPayload(labId: number) {
  const rows = await db.select({ id: schema.labAsset.id, name: schema.labAsset.name }).from(schema.labAsset).where(eq(schema.labAsset.labId, labId))
  const missing = rows.filter((row) => !assetCache.has(row.id)).map((row) => row.id)
  if (missing.length) {
    const data = await db.select({ id: schema.labAsset.id, data: schema.labAsset.data }).from(schema.labAsset).where(inArray(schema.labAsset.id, missing))
    for (const row of data) rememberAsset(row.id, Buffer.from(row.data).toString('base64'))
  }
  return rows.map((row) => ({ name: row.name, data: assetCache.get(row.id) ?? '' }))
}

/** 素材文件名：直接当文件名写进运行目录，学生代码里也按它读 */
export function labAssetNameError(name: string): string | null {
  if (!name || name.length > 100) return '文件名要在 100 个字以内'
  if (/[/\\\0]/.test(name) || name.startsWith('.')) return '文件名里不能有斜杠，也不能以点开头'
  return null
}

// ---------------------------------------------------------------- 素材预览

const PREVIEW_READERS: Record<string, (name: string) => string> = {
  xlsx: (name) => `df = pd.read_excel(${pyString(name)})`,
  // 老师从 Excel 另存的 CSV 多半是 GBK，先按 UTF-8 读，读不了再换
  csv: (name) =>
    `try:\n    df = pd.read_csv(${pyString(name)}, encoding='utf-8-sig')\nexcept UnicodeDecodeError:\n    df = pd.read_csv(${pyString(name)}, encoding='gbk')`,
}

function pyString(value: string) {
  // JSON 的字符串转义在 Python 里同样成立
  return JSON.stringify(value)
}

const previewCache = new Map<number, LabAssetPreview>()

/** 表格类素材（xlsx / csv）的内容，拿运行器读一遍。按素材 id 缓存（素材只增不改）。 */
export async function labAssetPreview(labId: number, asset: { id: number; name: string }): Promise<LabAssetPreview> {
  const cached = previewCache.get(asset.id)
  if (cached) return cached
  const ext = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const reader = PREVIEW_READERS[ext]
  if (!reader) return { table: null, error: null }
  const result = await callRunner({
    assets: (await labAssetsPayload(labId)).filter((a) => a.name === asset.name),
    steps: [`import pandas as pd\n${reader(asset.name)}\ndf`],
    check: { kind: 'none' },
  })
  const table = result.outputs.find((o) => o.kind === 'table') ?? null
  const preview: LabAssetPreview = {
    table: table && table.kind === 'table' ? table : null,
    error: result.error ? `读不出来：${result.error.type} ${result.error.message}` : null,
  }
  if (previewCache.size > 500) previewCache.clear()
  previewCache.set(asset.id, preview)
  return preview
}

// ---------------------------------------------------------------- 步骤

type StepLike = Pick<LabStepInput, 'kind' | 'title' | 'starterCode' | 'referenceCode' | 'checkKind' | 'compareVars' | 'compareFigure' | 'checkScript'>

/** 出题页存之前的语义检查：说到第几步、差什么。 */
export function labStepError(step: StepLike, index: number): string | null {
  const where = `第 ${index + 1} 步「${step.title}」`
  if (step.kind === 'open') {
    return step.checkKind === 'none' ? null : `${where}是开放步骤，不检查`
  }
  if (step.checkKind === 'compare') {
    if (!step.referenceCode.trim()) return `${where}要对照答案，先写答案`
    if (!step.compareVars.length && !step.compareFigure) return `${where}要对照答案，至少选一个要比的变量，或者比画出来的图`
  }
  if (step.checkKind === 'script' && !step.checkScript.trim()) return `${where}选了检查脚本，脚本还没写`
  return null
}

/** 答案链里的一步：没写答案的（演示步骤、开放步骤）拿初始代码顶上 */
export function referenceOf(step: Pick<LabStepInput, 'referenceCode' | 'starterCode'>) {
  return step.referenceCode.trim() ? step.referenceCode : step.starterCode
}

export function checkOf(step: StepLike): LabRunnerRequest['check'] {
  if (step.kind === 'open' || step.checkKind === 'none') return { kind: 'none' }
  if (step.checkKind === 'script') return { kind: 'script', script: step.checkScript }
  return { kind: 'compare', vars: step.compareVars, figure: step.compareFigure }
}

/**
 * 跑到第 index 步的请求。`studentCodes` 是学生第 1…index 步的代码；出题页试跑时不传，就用答案自己跑一遍。
 */
export function buildRunRequest(steps: StepLike[], index: number, assets: LabRunnerRequest['assets'], studentCodes?: string[]): LabRunnerRequest {
  const chain = steps.slice(0, index + 1)
  const reference = chain.map(referenceOf)
  const check = checkOf(chain[index]!)
  return {
    assets,
    steps: studentCodes ?? reference,
    ...(check.kind === 'compare' ? { reference } : {}),
    check,
  }
}
