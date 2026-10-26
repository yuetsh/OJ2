import { createHash } from 'node:crypto'

import { config } from '../config'
import { readInfo, rstrip } from '../services/test-case'
import { judgeConfigFor, type LanguageConfig } from './languages'
import { JudgeStatus, type JudgeStatusValue } from './status'

/**
 * 判题沙箱（go-judge，见 docker/judge/）的客户端：编译、逐个测试点运行、比对输出、定状态码。
 *
 * go-judge 只管「在沙箱里跑一条命令、量出用了多少」，判题流程是这里拼起来的。2026-10 之前
 * 判题机是 QingdaoU/JudgeServer，流程在它的 judge_client.py 里；这里是**逐条照搬**它的
 * 口径，出参也保持它的形状（`{ err, data: JudgeCase[] }`、每个点的 cpu_time / memory /
 * signal / exit_code …）—— 12 万条历史提交的 `info` 就是这个形状，前端和统计都按它读。
 * 换过来时拿生产库的真实提交逐份对比过新旧两边的判定，结论见 docker/judge/README.md。
 *
 * 照搬的口径：
 * - **输出比对**：整段输出 rstrip（只剥 ASCII 空白，和 Python 的 bytes.rstrip 一样）后取
 *   md5，和测试点 info 里的 `stripped_output_md5` 比。
 * - **stdout 和 stderr 合在一起比**：JudgeServer 把两者重定向到同一个文件。Python 的
 *   SyntaxWarning、C 往 stderr 打的东西都算进输出，所以这里两个 fd 接同一个收集器。
 * - **内存**：地址空间限到题目内存的两倍（RLIMIT_AS），跑完峰值超过题目内存判超限。
 *   malloc 先成功一阵、到两倍才失败，所以内存爆了多半判「内存超限」而不是运行时错误。
 * - **输出上限 16MB**（镜像的 -output-limit）：死循环打印写满吃 SIGXFSZ，判运行时错误、
 *   信号 25，前端对它有专门的中文说明。
 * - **墙钟是 CPU 时限的 3 倍**；状态码的先后顺序照 libjudger 的 runner.c，见 verdict()。
 *
 * 和 JudgeServer 不一样的地方（都是沙箱换了带来的，判定上只会更宽松）：
 * - 学生程序不能再开进程或线程（procLimit 1）。原来是 seccomp 直接杀，信号 31；现在
 *   fork 失败、system("pause") 返回 -1，程序照样往下跑。
 * - 内存读数是 cgroup 的峰值，比原来的 ru_maxrss 小（C 的空程序 0.25MB，原来 1.5MB）。
 * - CPU 时间含内核态，原来只算用户态。
 */

/** 判题机容器里测试点的挂载点（compose 里 `…/test_case:/test_case:ro`），镜像的 -src-prefix 也是它 */
const SANDBOX_TEST_CASE_DIR = '/test_case'

/** 镜像的 -output-limit。改了这里要一起改 docker/judge/Dockerfile */
const OUTPUT_LIMIT = 16 * 1024 * 1024

/** JudgeServer 给编译器输出留的上限 */
const COMPILE_OUTPUT_LIMIT = 20 * 1024 * 1024

/** JudgeServer 的 max_stack */
const STACK_LIMIT = 128 * 1024 * 1024

/**
 * 一份提交同时跑几个测试点。JudgeServer 是按核数开进程池（服务器两核 = 两个），这里取一样的数。
 * 整台判题机同时跑几个由 go-judge 自己的 -parallelism 管（默认等于核数），多出来的在它那里排队，
 * 排队不算墙钟。
 */
const CASE_PARALLELISM = 2

/**
 * 打开 `output` 时所有测试点的输出加起来的上限。原来是判题机整个回包的上限（每组输出
 * 最多 16MB，死循环打印能把每组都写满），api、worker 容器都只有 512MB。
 */
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

const PATH = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
/** 编译只给 PATH，和 JudgeServer 一样（它的 compile_config 没有 env） */
const COMPILE_ENV = [PATH]
const RUN_ENV = [PATH, 'LANG=en_US.UTF-8', 'LANGUAGE=en_US:en', 'LC_ALL=en_US.UTF-8']

export interface JudgeCase {
  cpu_time: number
  memory: number
  result: number
  test_case: string
  /** SQL 判题会带上中文原因，沙箱判题没有这个字段 */
  error_message?: string | null
  [key: string]: unknown
}

export interface JudgeResponse {
  err: string | null
  data: JudgeCase[] | unknown
}

/** 打开 output 时输出超过 MAX_OUTPUT_BYTES。试运行回「输出太多」，诊断重跑当作没诊断出来 */
export class TooMuchOutputError extends Error {
  constructor() {
    super('判题机返回的内容太大')
  }
}

/** go-judge 的 /run 回的单条结果。时间是纳秒，内存是字节 */
interface SandboxResult {
  status: string
  exitStatus: number
  error?: string
  time: number
  memory: number
  runTime: number
  files?: Record<string, string>
  fileIds?: Record<string, string>
}

interface SandboxCase {
  key: string
  stdin: { src: string } | { content: string }
  expectedMd5: string
}

function headers() {
  return { authorization: `Bearer ${config.judgeServerToken}` }
}

async function runCommand(command: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(new URL('/run', config.judgeServerUrl), {
    method: 'POST',
    signal,
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: [command] }),
  })
  if (!response.ok) throw new Error(`判题机返回 HTTP ${response.status}：${(await response.text()).slice(0, 200)}`)
  const body = (await response.json()) as unknown
  if (!Array.isArray(body) || !body[0]) throw new Error(`判题机回的结果看不懂：${JSON.stringify(body).slice(0, 200)}`)
  return body[0] as SandboxResult
}

async function readFile(fileId: string, signal?: AbortSignal) {
  const response = await fetch(new URL(`/file/${fileId}`, config.judgeServerUrl), { signal, headers: headers() })
  if (!response.ok) throw new Error(`判题机取文件返回 HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** 用完的文件删掉。删不掉也不要紧，判题机 10 分钟后自己清（-file-timeout） */
function deleteFile(fileId: string) {
  void fetch(new URL(`/file/${fileId}`, config.judgeServerUrl), { method: 'DELETE', headers: headers() }).catch(() => {})
}

const md5 = (buffer: Uint8Array) => createHash('md5').update(buffer).digest('hex')

/**
 * 状态码，照 libjudger runner.c 的判定顺序：退出码非 0 → 运行时错误；段错误时内存超了算
 * 内存超限、否则运行时错误；其余信号 → 运行时错误，然后依次用内存、墙钟、CPU 覆盖。
 * 后面的覆盖前面的，所以超时优先于内存超限优先于运行时错误。
 */
function verdict(sandbox: SandboxResult, cpuTime: number, realTime: number, signal: number, limits: { cpu: number; real: number; memory: number }) {
  if (sandbox.status === 'Internal Error' || sandbox.status === 'File Error') return JudgeStatus.SYSTEM_ERROR
  const exitCode = signal ? 0 : sandbox.exitStatus
  let result: JudgeStatusValue = JudgeStatus.ACCEPTED
  if (exitCode !== 0) result = JudgeStatus.RUNTIME_ERROR
  if (signal === 11) {
    result = sandbox.memory > limits.memory ? JudgeStatus.MEMORY_LIMIT_EXCEEDED : JudgeStatus.RUNTIME_ERROR
  } else {
    if (signal !== 0) result = JudgeStatus.RUNTIME_ERROR
    if (sandbox.memory > limits.memory || sandbox.status === 'Memory Limit Exceeded') result = JudgeStatus.MEMORY_LIMIT_EXCEEDED
    if (realTime > limits.real) result = JudgeStatus.REAL_TIME_LIMIT_EXCEEDED
    if (cpuTime > limits.cpu) result = JudgeStatus.CPU_TIME_LIMIT_EXCEEDED
  }
  // 被 go-judge 按时限杀掉的，读数可能正好卡在限上、没有「超过」
  if (sandbox.status === 'Time Limit Exceeded' && result !== JudgeStatus.CPU_TIME_LIMIT_EXCEEDED && result !== JudgeStatus.REAL_TIME_LIMIT_EXCEEDED) {
    result = cpuTime >= limits.cpu ? JudgeStatus.CPU_TIME_LIMIT_EXCEEDED : JudgeStatus.REAL_TIME_LIMIT_EXCEEDED
  }
  return result
}

/**
 * 收出来的信号：go-judge 按时限杀是 SIGKILL，写满输出上限单独报一个状态，其实就是 SIGXFSZ。
 * 被 seccomp 拦下（Dangerous Syscall）按 SIGSYS 记，和 JudgeServer 一样判运行时错误 ——
 * go-judge 默认的 seccomp 规则是让系统调用返回错误而不是杀进程，正常碰不到，防的是它改默认
 */
function signalOf(sandbox: SandboxResult) {
  if (sandbox.status === 'Signalled' || sandbox.status === 'Time Limit Exceeded') return sandbox.exitStatus
  if (sandbox.status === 'Output Limit Exceeded') return 25
  if (sandbox.status === 'Dangerous Syscall') return 31
  return 0
}

async function compile(language: LanguageConfig, source: string, signal?: AbortSignal) {
  const { compile } = language
  const result = await runCommand(
    {
      args: compile.command,
      env: COMPILE_ENV,
      files: [{ content: '' }, { name: 'stdout', max: COMPILE_OUTPUT_LIMIT }, { name: 'stdout', max: COMPILE_OUTPUT_LIMIT }],
      cpuLimit: compile.maxCpuTime * 1e6,
      clockLimit: compile.maxRealTime * 1e6,
      memoryLimit: compile.maxMemory * 2,
      addressSpaceLimit: true,
      stackLimit: STACK_LIMIT,
      procLimit: 64,
      copyIn: { [compile.srcName]: { content: source } },
      copyOut: ['stdout'],
      copyOutCached: [compile.exeName],
    },
    signal,
  )
  const exeId = result.fileIds?.[compile.exeName]
  const cpuTime = Math.floor(result.time / 1e6)
  const realTime = Math.floor(result.runTime / 1e6)
  const failed =
    verdict(result, cpuTime, realTime, signalOf(result), { cpu: compile.maxCpuTime, real: compile.maxRealTime, memory: compile.maxMemory }) !==
    JudgeStatus.ACCEPTED
  if (!failed && exeId) return { exeId }
  if (exeId) deleteFile(exeId)
  // 编译器自己的报错原样给；没有报错（编译超时、被杀）就是 JudgeServer 那句英文
  const output = (result.files?.stdout ?? '').trim()
  const { files: _files, fileIds: _fileIds, ...info } = result
  return { error: output || `Compiler runtime error, info: ${JSON.stringify(info)}` }
}

async function runCase(
  language: LanguageConfig,
  exeId: string,
  item: SandboxCase,
  limits: { cpu: number; memory: number },
  output: boolean,
  signal?: AbortSignal,
): Promise<{ judged: JudgeCase; outputBytes: number }> {
  const real = limits.cpu * 3
  const result = await runCommand(
    {
      args: language.run.command,
      env: RUN_ENV,
      files: [item.stdin, { name: 'stdout', max: OUTPUT_LIMIT }, { name: 'stdout', max: OUTPUT_LIMIT }],
      cpuLimit: limits.cpu * 1e6,
      clockLimit: real * 1e6,
      memoryLimit: limits.memory * 2,
      addressSpaceLimit: true,
      stackLimit: STACK_LIMIT,
      procLimit: 1,
      copyIn: { [language.compile.exeName]: { fileId: exeId } },
      copyOutCached: ['stdout'],
    },
    signal,
  )
  const cpuTime = Math.floor(result.time / 1e6)
  const realTime = Math.floor(result.runTime / 1e6)
  const signalNumber = signalOf(result)
  let status: JudgeStatusValue = verdict(result, cpuTime, realTime, signalNumber, { cpu: limits.cpu, real, memory: limits.memory })

  const stdoutId = result.fileIds?.stdout
  let outputMd5: string | null = null
  let text: string | null = null
  let outputBytes = 0
  if (stdoutId) {
    try {
      // 只有正常跑完的才比对；输出只在要的时候读回来
      if (status === JudgeStatus.ACCEPTED || output) {
        const bytes = await readFile(stdoutId, signal)
        outputBytes = bytes.length
        if (status === JudgeStatus.ACCEPTED) {
          outputMd5 = md5(rstrip(bytes))
          if (outputMd5 !== item.expectedMd5) status = JudgeStatus.WRONG_ANSWER
        }
        if (output) text = new TextDecoder().decode(bytes)
      }
    } finally {
      deleteFile(stdoutId)
    }
  } else if (status === JudgeStatus.ACCEPTED) {
    status = JudgeStatus.SYSTEM_ERROR
  }

  return {
    outputBytes,
    judged: {
      cpu_time: cpuTime,
      real_time: realTime,
      memory: result.memory,
      signal: signalNumber,
      exit_code: signalNumber ? 0 : result.exitStatus,
      error: 0,
      result: status,
      test_case: item.key,
      output_md5: outputMd5,
      output: text,
    },
  }
}

/**
 * `testCase` 是测试点目录名（正常判题），或者内联的测试点（试运行、诊断重跑、样例重跑，
 * 编号从 1 起）。`output` 让每个点带回程序的原样输出；只有试运行和诊断要，正常判题不开。
 * `memoryLimit` 是 MB，`timeLimit` 是毫秒，都是题目上的值。
 *
 * 学生代码的问题（编不过）走 `err: 'CompileError'`；题目或判题机的问题（读不到测试点）走
 * 别的 `err`；判题机连不上、超时直接抛错。和 JudgeServer 的三种出口一一对应。
 */
export async function judge(
  language: string,
  source: string,
  timeLimit: number,
  memoryLimit: number,
  testCase: string | { input: string; output: string }[],
  { output = false, signal }: { output?: boolean; signal?: AbortSignal } = {},
): Promise<JudgeResponse> {
  const languageConfig = judgeConfigFor(language)
  if (!languageConfig) throw new Error(`Unsupported judge language: ${language}`)

  let cases: SandboxCase[]
  if (typeof testCase === 'string') {
    const info = await readInfo(testCase)
    if (!info?.test_cases) return { err: 'JudgeClientError', data: 'Test case not found' }
    cases = Object.entries(info.test_cases).map(([key, item]) => ({
      key,
      stdin: { src: `${SANDBOX_TEST_CASE_DIR}/${testCase}/${item.input_name}` },
      expectedMd5: item.stripped_output_md5,
    }))
  } else {
    cases = testCase.map((item, index) => ({
      key: String(index + 1),
      stdin: { content: item.input },
      expectedMd5: md5(rstrip(new TextEncoder().encode(item.output))),
    }))
  }

  const compiled = await compile(languageConfig, source, signal)
  if ('error' in compiled) return { err: 'CompileError', data: compiled.error }

  try {
    const limits = { cpu: timeLimit, memory: memoryLimit * 1024 * 1024 }
    const results: JudgeCase[] = []
    let outputBytes = 0
    let next = 0
    let stopped = false
    const worker = async () => {
      while (!stopped && next < cases.length) {
        const item = cases[next++]!
        const ran = await runCase(languageConfig, compiled.exeId, item, limits, output, signal)
        outputBytes += ran.outputBytes
        // 一组写满 16MB 就到上限了：那一组是被截断的，再多读也只是把 worker 撑大
        if (output && outputBytes >= MAX_OUTPUT_BYTES) {
          stopped = true
          throw new TooMuchOutputError()
        }
        results.push(ran.judged)
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CASE_PARALLELISM, cases.length) }, worker))
    } finally {
      stopped = true
    }
    return { err: null, data: results.sort((left, right) => Number(left.test_case) - Number(right.test_case)) }
  } finally {
    deleteFile(compiled.exeId)
  }
}

/** 只编译不运行，编不过时给出编译器的报错。判题机不认的语言当编得过 */
export async function compileError(language: string, source: string, signal?: AbortSignal) {
  const languageConfig = judgeConfigFor(language)
  if (!languageConfig) return null
  const compiled = await compile(languageConfig, source, signal)
  if ('error' in compiled) return compiled.error
  deleteFile(compiled.exeId)
  return null
}

/** 判题机在不在、是哪个版本。worker 每 5 秒问一次，写进后台的「判题机列表」（judge/heartbeat.ts） */
export async function sandboxVersion(signal?: AbortSignal) {
  const response = await fetch(new URL('/version', config.judgeServerUrl), { signal, headers: headers() })
  if (!response.ok) throw new Error(`判题机返回 HTTP ${response.status}`)
  const body = (await response.json()) as { buildVersion?: unknown }
  return typeof body.buildVersion === 'string' ? body.buildVersion : 'unknown'
}
