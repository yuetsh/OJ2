/**
 * 「数据分析」运行器冒烟测试 —— **换镜像或改了 runner / kernel / compare 之后跑这个**（项目不写测试，验证一律实跑）。
 *
 *   bun docker/lab/smoke.ts                                  # 连 data/lab-run/lab.sock（dev compose 的位置）
 *   LAB_SOCKET=/path/to/lab.sock bun docker/lab/smoke.ts
 *   LAB_SMOKE_OUT=/tmp/x bun docker/lab/smoke.ts             # 顺便把画出来的图存下来，肉眼看中文有没有变方框
 *
 * 直接打 unix socket，不经过 api。核的是：
 *   1. 设计稿里那节课（读表 → 平均分 → 柱状图）三步各自的对错和说法
 *   2. 报错停在哪一步、哪一行；超时、内存、print 太多
 *   3. 关得住：不联网、杀不了别的进程、连不上 socket、看不到别人的目录、fork 炸弹
 *   4. 检查脚本、seaborn / 词云的中文
 *   5. 40 个人同时点「运行」要多久
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const socket = process.env.LAB_SOCKET ?? join(import.meta.dir, '../../data/lab-run/lab.sock')
const outDir = process.env.LAB_SMOKE_OUT
if (outDir) mkdirSync(outDir, { recursive: true })

const xlsx = readFileSync(join(import.meta.dir, 'fixtures/成绩.xlsx')).toString('base64')
const assets = [{ name: '成绩.xlsx', data: xlsx }]

interface Output {
  kind: 'text' | 'table' | 'image'
  text?: string
  shape?: [number, number]
  png?: string
}
interface RunError {
  step: number
  type: string
  message: string
  line: number | null
}
interface RunResult {
  ok: boolean
  outputs: Output[]
  truncated: boolean
  error: RunError | null
  check: { passed: boolean; messages: string[]; scriptError?: string } | null
  referenceError: RunError | null
  referenceSummary: string | null
  timeMs: number
}

async function call(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://lab${path}`, {
    unix: socket,
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function run(body: Record<string, unknown>): Promise<RunResult> {
  const { status, json } = await call('/run', { assets, ...body })
  if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(json)}`)
  return json
}

// ---------------------------------------------------------------- 设计稿里的那节课

const step1 = `import pandas as pd
df = pd.read_excel('成绩.xlsx')
df.head()`
const step2 = `avg = df[['语文', '数学', '英语', '专业课']].mean().round(1)
print(avg)`
const step3 = `import matplotlib.pyplot as plt
plt.bar(avg.index, avg.values)
plt.title('各科平均分')
plt.show()`
const step3Wrong = `import matplotlib.pyplot as plt
plt.bar(df['姓名'], df['数学'])
plt.title('各科平均分')
plt.show()`
const compareAvg = { kind: 'compare', vars: ['avg'] }
const compareFig = { kind: 'compare', figure: { values: true, title: true, labels: false } }

let failed = 0
async function test(name: string, fn: () => Promise<string | null | void>) {
  const t0 = performance.now()
  try {
    const problem = await fn()
    const ms = Math.round(performance.now() - t0)
    if (problem) {
      failed++
      console.log(`  ✗ ${name} —— ${problem}`)
    } else {
      console.log(`  ✓ ${name} (${ms}ms)`)
    }
  } catch (e) {
    failed++
    console.log(`  ✗ ${name} —— ${e instanceof Error ? e.message : e}`)
  }
}

function saveImages(prefix: string, r: RunResult) {
  if (!outDir) return
  r.outputs.filter((o) => o.kind === 'image').forEach((o, i) => writeFileSync(join(outDir, `${prefix}-${i + 1}.png`), Buffer.from(o.png!, 'base64')))
}

const expectMessage = (r: RunResult, needle: string) =>
  r.check?.passed === false && r.check.messages.some((m) => m.includes(needle))
    ? null
    : `应该没过并提到「${needle}」，实际 ${JSON.stringify(r.check ?? r.error)}`

const health = await call('/health')
console.log(`运行器：预热 ${health.json.warmSeconds}s，并发 ${health.json.concurrency}，${JSON.stringify(health.json.versions)}\n`)

console.log('设计稿那节课')
await test('第 1 步：最后一行 df.head() 显示成 5 行 5 列的表', async () => {
  const r = await run({ steps: [step1] })
  const t = r.outputs.find((o) => o.kind === 'table')
  return r.ok && r.check?.passed && t?.shape?.join() === '5,5' ? null : JSON.stringify(r).slice(0, 300)
})
await test('第 2 步：avg 对得上答案', async () => {
  const r = await run({ steps: [step1, step2], reference: [step1, step2], check: compareAvg })
  const printed = r.outputs[0]?.text ?? ''
  return r.check?.passed && printed.includes('70.2') ? null : JSON.stringify(r).slice(0, 300)
})
await test('第 2 步：忘了保留一位小数 → 说出哪一项差多少', async () => {
  const r = await run({ steps: [step1, step2.replace('.round(1)', '')], reference: [step1, step2], check: compareAvg })
  return expectMessage(r, '「语文」这一项：你的是 70.25，应该是 70.2')
})
await test('第 2 步：变量名写错 → 没有找到 avg', async () => {
  const r = await run({ steps: [step1, step2.replace('avg', 'ave').replace('print(avg)', 'print(ave)')], reference: [step1, step2], check: compareAvg })
  return expectMessage(r, '没有找到 avg')
})
await test('第 3 步：画成 40 根柱子 → 应该是 4 根', async () => {
  const r = await run({ steps: [step1, step2, step3Wrong], reference: [step1, step2, step3], check: compareFig })
  saveImages('3-wrong', r)
  return expectMessage(r, '应该是 4 根柱子（语文、数学、英语、专业课），你画了 40 根')
})
await test('第 3 步：画对了；出题页那句「画了什么」', async () => {
  const r = await run({ steps: [step1, step2, step3], reference: [step1, step2, step3], check: compareFig })
  saveImages('3-right', r)
  if (!r.check?.passed) return JSON.stringify(r.check)
  return r.referenceSummary === '4 根柱子，标题「各科平均分」' ? null : `summary = ${r.referenceSummary}`
})
await test('第 3 步：标题写错', async () => {
  const r = await run({ steps: [step1, step2, step3.replace('各科平均分', '平均分')], reference: [step1, step2, step3], check: compareFig })
  return expectMessage(r, '标题：你的是「平均分」，应该是「各科平均分」')
})
await test('第 3 步：画成折线图', async () => {
  const r = await run({ steps: [step1, step2, step3.replace('plt.bar', 'plt.plot')], reference: [step1, step2, step3], check: compareFig })
  return expectMessage(r, '应该画柱状图，你画的是折线图')
})
await test('第 3 步：用 avg.plot.bar() 画也算对', async () => {
  const alt = `import matplotlib.pyplot as plt
avg.plot.bar(title='各科平均分')`
  const r = await run({ steps: [step1, step2, alt], reference: [step1, step2, step3], check: compareFig })
  return r.check?.passed ? null : JSON.stringify(r.check)
})
await test('答案里没有要比的变量 → referenceError，不冤枉学生', async () => {
  const r = await run({ steps: [step1, step2], reference: [step1, 'avg2 = 1'], check: compareAvg })
  return r.referenceError?.message.includes('答案里没有 avg') && r.check === null ? null : JSON.stringify(r).slice(0, 300)
})
await test('答案报错 → referenceError 带着答案的错', async () => {
  const r = await run({ steps: [step1, step2], reference: [step1, 'avg = 1 / 0'], check: compareAvg })
  return r.referenceError?.type === 'ZeroDivisionError' && r.check === null ? null : JSON.stringify(r).slice(0, 300)
})

console.log('\n报错')
await test('第 2 步语法错 → 停在第 2 步、报行号', async () => {
  const r = await run({ steps: [step1, 'avg = df[["语文"]].mean(\nprint(avg)'] })
  return r.error?.step === 2 && r.error.type === 'SyntaxError' && r.error.line ? null : JSON.stringify(r.error)
})
await test('第 3 步第 2 行 NameError', async () => {
  const r = await run({ steps: [step1, step2, 'import matplotlib.pyplot as plt\nplt.bar(avgs.index, avgs.values)'] })
  return r.error?.step === 3 && r.error.type === 'NameError' && r.error.line === 2 ? null : JSON.stringify(r.error)
})
await test('跑第 3 步时第 1 步坏了 → 报在第 1 步', async () => {
  const r = await run({ steps: [step1.replace('成绩.xlsx', '成绩表.xlsx'), step2, step3] })
  return r.error?.step === 1 && r.error.type === 'FileNotFoundError' ? null : JSON.stringify(r.error)
})
await test('报错之前 print 的东西还在', async () => {
  const r = await run({ steps: ['print("先打印")\n1 / 0'] })
  return r.error?.type === 'ZeroDivisionError' && r.outputs[0]?.text === '先打印\n' ? null : JSON.stringify(r)
})
await test('input() 读不到东西', async () => {
  const r = await run({ steps: ['x = input()'] })
  return r.error?.type === 'EOFError' ? null : JSON.stringify(r.error)
})
await test('死循环 → 超时', async () => {
  const r = await run({ steps: ['while True:\n    pass'] })
  return r.error?.type === 'Timeout' ? null : JSON.stringify(r.error)
})
await test('吃内存 → 报错，不拖垮运行器', async () => {
  const r = await run({ steps: ['x = bytearray(2 * 1024 * 1024 * 1024)'] })
  return r.error && ['MemoryError', 'Crashed'].includes(r.error.type) ? null : JSON.stringify(r.error)
})
await test('print 太多 → 截断', async () => {
  const r = await run({ steps: ['for i in range(100000):\n    print(i)'] })
  return r.ok && r.truncated && (r.outputs[0]?.text?.length ?? 0) <= 65536 ? null : `truncated=${r.truncated}`
})

console.log('\n关得住')
await test('不联网', async () => {
  const r = await run({ steps: ['import socket\nsocket.create_connection(("1.1.1.1", 80), timeout=3)'] })
  return r.error?.type === 'OSError' ? null : JSON.stringify(r.error)
})
await test('杀不了母进程', async () => {
  const r = await run({ steps: ['import os\nos.kill(1, 9)'] })
  return r.error?.type === 'PermissionError' ? null : JSON.stringify(r.error)
})
await test('连不上运行器自己的 socket', async () => {
  const r = await run({ steps: ['import socket\ns = socket.socket(socket.AF_UNIX)\ns.connect("/run/lab/lab.sock")'] })
  return r.error?.type === 'PermissionError' ? null : JSON.stringify(r.error)
})
await test('列不出别人的运行目录', async () => {
  const r = await run({ steps: ['import os\nos.listdir("/tmp/runs")'] })
  return r.error?.type === 'PermissionError' ? null : JSON.stringify(r.error)
})
await test('写不了根目录', async () => {
  const r = await run({ steps: ['open("/opt/lab/kernel.py", "w")'] })
  return r.error && ['PermissionError', 'OSError'].includes(r.error.type) ? null : JSON.stringify(r.error)
})
await test('fork 炸弹被进程数限住', async () => {
  const r = await run({ steps: ['import os\nwhile True:\n    os.fork()'] })
  return r.error ? null : 'fork 炸弹居然没报错'
})
await test('运行器还活着', async () => {
  const h = await call('/health')
  return h.json.ok ? null : JSON.stringify(h.json)
})

console.log('\n检查脚本、中文')
await test('检查脚本没过 → 老师写的提示', async () => {
  const script = "assert df['总分'].max() <= 400, '总分算错了，检查是不是把姓名列也加进去了'"
  const r = await run({ steps: [step1, "df['总分'] = df['语文'] + df['数学'] + df['英语'] + df['专业课'] + 1000"], check: { kind: 'script', script } })
  return expectMessage(r, '总分算错了')
})
await test('检查脚本通过', async () => {
  const script = "assert df['总分'].max() <= 400, '总分算错了'"
  const r = await run({ steps: [step1, "df['总分'] = df['语文'] + df['数学'] + df['英语'] + df['专业课']"], check: { kind: 'script', script } })
  return r.check?.passed ? null : JSON.stringify(r.check)
})
await test('seaborn 画图（会重设字体）', async () => {
  const code = `import seaborn as sns
import matplotlib.pyplot as plt
sns.set_theme()
sns.barplot(x=avg.index, y=avg.values)
plt.title('各科平均分（seaborn）')`
  const r = await run({ steps: [step1, step2, code] })
  saveImages('seaborn', r)
  return r.ok && r.outputs.some((o) => o.kind === 'image') ? null : JSON.stringify(r.error)
})
await test('jieba 分词 + 中文词云', async () => {
  const code = `import jieba
from wordcloud import WordCloud
text = '数据分析就是用数据说话，用 pandas 读表，用 matplotlib 画图，数据分析很有意思'
words = ' '.join(jieba.lcut(text))
WordCloud(width=400, height=200, background_color='white').generate(words)`
  const r = await run({ steps: [code] })
  saveImages('wordcloud', r)
  return r.ok && r.outputs.some((o) => o.kind === 'image') ? null : JSON.stringify(r.error ?? r.outputs)
})

console.log('\n并发')
for (const n of [1, 10, 40]) {
  await test(`${n} 个人同时点第 3 步的运行（对照答案，每人两个进程）`, async () => {
    const t0 = performance.now()
    const done: number[] = []
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        run({ steps: [step1, step2, step3Wrong], reference: [step1, step2, step3], check: compareFig }).then((r) => {
          done.push(performance.now() - t0)
          return r
        }),
      ),
    )
    done.sort((a, b) => a - b)
    const bad = results.filter((r) => r.check?.passed !== false).length
    console.log(`      中位 ${(done[Math.floor(n / 2)]! / 1000).toFixed(2)}s，最后一个 ${(done[n - 1]! / 1000).toFixed(2)}s`)
    return bad ? `${bad} 个结果不对` : null
  })
}

console.log(failed ? `\n❌ ${failed} 项没过` : '\n✓ 全部通过')
process.exit(failed ? 1 : 0)
