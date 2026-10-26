/**
 * 判题沙箱冒烟测试 —— **换镜像之后跑这个**（项目不写测试，验证一律实跑）。
 *
 *   bun docker/judge/smoke.ts                                   # 打 .env 里的 JUDGE_SERVER_URL
 *   JUDGE_SERVER_URL=http://localhost:8082 bun docker/judge/smoke.ts
 *
 * 走的是线上那份判题代码（apps/api/src/judge/sandbox.ts 的 judge()），不经过 api / worker /
 * 队列，所以不需要起后端，也不需要库里有题 —— 测试点内联传进去。
 *
 * 它核的是四件事：
 *   1. 三种语言都能编译、运行、判对（languageConfigs 就是线上那份，不是另抄的）
 *   2. 六种结果状态的**整数值**没变（落库的值，见 packages/contract/src/judge-status.ts）
 *   3. gcc 的宽松度没变 —— 忘了 #include 的老代码照样能过（gcc-14 默认会把它判 CE）
 *   4. 从 JudgeServer 照搬过来的几条口径：stderr 算进输出、死循环打印判运行时错误（信号 25）
 */
import { JudgeStatus } from '@oj2/contract'

import { judge, sandboxVersion, type JudgeCase } from '../../apps/api/src/judge/sandbox'

const url = process.env.JUDGE_SERVER_URL ?? 'http://localhost:8081'
if (!process.env.JUDGE_SERVER_TOKEN) {
  console.error('JUDGE_SERVER_TOKEN 没设 —— 在 OJ2 根目录跑，bun 会自己读 .env')
  process.exit(2)
}

interface Case {
  language: string
  name: string
  code: string
  expect: number
  /** 默认 3000ms / 128MB，跑得慢或要撑爆内存的用例自己改 */
  cpu?: number
  memory?: number
  /** 再核一下第一个测试点的信号 */
  signal?: number
}

const sumTestCase = [{ input: '1 2\n', output: '3\n' }]

const cases: Case[] = [
  // ---------------------------------------------------------------- C
  {
    language: 'C',
    name: 'C 正常通过',
    expect: JudgeStatus.ACCEPTED,
    code: `#include <stdio.h>
int main(void) {
  int a, b;
  scanf("%d %d", &a, &b);
  printf("%d\\n", a + b);
  return 0;
}`,
  },
  {
    // 这条是升 gcc 的主要风险点：gcc-14 起 implicit-function-declaration 是
    // error，languages.ts 里的几个 -Wno-error 就是为它加的。这条挂了说明那些
    // 开关没生效 —— 后果是一批历史题解和 20 篇 C 教程的示例突然全 CE。
    language: 'C',
    name: 'C 忘了 #include 仍能过（gcc 宽松度）',
    expect: JudgeStatus.ACCEPTED,
    code: `int main(void) {
  int a, b;
  scanf("%d %d", &a, &b);
  printf("%d\\n", a + b);
  return 0;
}`,
  },
  {
    // gcc-14 把 int 函数里不带值的 return;（-Wreturn-mismatch）、省略 int 的
    // main()（-Wimplicit-int）也提成了 error
    language: 'C',
    name: 'C 不带值的 return;、省略 int 的 main() 仍能过（gcc 宽松度）',
    expect: JudgeStatus.ACCEPTED,
    code: `#include <stdio.h>
int check(int a) {
  if (a < 0) return;
  return a;
}
main(void) {
  int a, b;
  scanf("%d %d", &a, &b);
  printf("%d\\n", check(a) + b);
  return 0;
}`,
  },
  {
    language: 'C',
    name: 'C 答案错误',
    expect: JudgeStatus.WRONG_ANSWER,
    code: `#include <stdio.h>
int main(void) {
  int a, b;
  scanf("%d %d", &a, &b);
  printf("%d\\n", a + b + 1);
  return 0;
}`,
  },
  {
    language: 'C',
    name: 'C 编译错误',
    expect: JudgeStatus.COMPILE_ERROR,
    code: `int main(void) { return }`,
  },
  {
    language: 'C',
    name: 'C 运行超时',
    expect: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED,
    cpu: 1000,
    code: `int main(void) {
  volatile long x = 0;
  while (1) x++;
  return 0;
}`,
  },
  {
    // 地址空间限在内存限制的两倍，所以 malloc 会先成功一阵子再失败，
    // 退出时峰值已经超过内存限制 → 判 MLE 而不是 RE（sandbox.ts 的 verdict）。
    language: 'C',
    name: 'C 内存超限',
    expect: JudgeStatus.MEMORY_LIMIT_EXCEEDED,
    memory: 64,
    code: `#include <stdlib.h>
#include <string.h>
int main(void) {
  for (;;) {
    char *p = malloc(8 * 1024 * 1024);
    if (!p) return 1;
    memset(p, 1, 8 * 1024 * 1024);
  }
}`,
  },
  {
    language: 'C',
    name: 'C 运行时错误',
    expect: JudgeStatus.RUNTIME_ERROR,
    signal: 11,
    code: `int main(void) {
  int *p = 0;
  *p = 1;
  return 0;
}`,
  },
  {
    // 写满 16MB 吃 SIGXFSZ。前端按信号 25 给「循环停不下来」的说明
    language: 'C',
    name: 'C 死循环打印判运行时错误',
    expect: JudgeStatus.RUNTIME_ERROR,
    signal: 25,
    code: `#include <stdio.h>
int main(void) {
  for (;;) printf("hello world\\n");
}`,
  },
  {
    // JudgeServer 把 stdout 和 stderr 写进同一个文件再比，往 stderr 打东西就是答案错误
    language: 'C',
    name: 'C 往 stderr 打的也算输出',
    expect: JudgeStatus.WRONG_ANSWER,
    code: `#include <stdio.h>
int main(void) {
  int a, b;
  scanf("%d %d", &a, &b);
  fprintf(stderr, "debug\\n");
  printf("%d\\n", a + b);
  return 0;
}`,
  },
  // ---------------------------------------------------------------- Python
  {
    language: 'Python',
    name: 'Python 正常通过',
    expect: JudgeStatus.ACCEPTED,
    code: `a, b = map(int, input().split())
print(a + b)`,
  },
  {
    language: 'Python',
    name: 'Python 编译错误',
    expect: JudgeStatus.COMPILE_ERROR,
    code: `def (:`,
  },
  {
    language: 'Python',
    name: 'Python 运行超时',
    expect: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED,
    cpu: 1000,
    code: `while True:
    pass`,
  },
  {
    language: 'Python',
    name: 'Python 运行时错误',
    expect: JudgeStatus.RUNTIME_ERROR,
    code: `print(1 / 0)`,
  },
  {
    // 学生程序开不了进程（procLimit 1），subprocess 抛 OSError
    language: 'Python',
    name: 'Python 开不了子进程',
    expect: JudgeStatus.RUNTIME_ERROR,
    code: `import subprocess
subprocess.run(['true'])`,
  },
  // ---------------------------------------------------------------- C++
  {
    language: 'C++',
    name: 'C++ 正常通过',
    expect: JudgeStatus.ACCEPTED,
    code: `#include <iostream>
int main() {
  int a, b;
  std::cin >> a >> b;
  std::cout << a + b << std::endl;
  return 0;
}`,
  },
  {
    language: 'C++',
    name: 'C++ 编译错误',
    expect: JudgeStatus.COMPILE_ERROR,
    code: `int main() { return }`,
  },
]

const names: Record<number, string> = {
  [JudgeStatus.COMPILE_ERROR]: 'CE',
  [JudgeStatus.WRONG_ANSWER]: 'WA',
  [JudgeStatus.ACCEPTED]: 'AC',
  [JudgeStatus.CPU_TIME_LIMIT_EXCEEDED]: 'TLE(cpu)',
  [JudgeStatus.REAL_TIME_LIMIT_EXCEEDED]: 'TLE(real)',
  [JudgeStatus.MEMORY_LIMIT_EXCEEDED]: 'MLE',
  [JudgeStatus.RUNTIME_ERROR]: 'RE',
  [JudgeStatus.SYSTEM_ERROR]: 'SE',
}
const label = (code: number) => `${names[code] ?? '?'}(${code})`

async function runCase(item: Case) {
  const body = await judge(item.language, item.code, item.cpu ?? 3000, item.memory ?? 128, sumTestCase)
  // 编译失败走 err 通道，不会有逐测试点的结果
  if (body.err === 'CompileError') return { result: JudgeStatus.COMPILE_ERROR }
  if (body.err) throw new Error(`${body.err}: ${JSON.stringify(body.data)}`)

  const results = body.data as JudgeCase[]
  // 多个测试点取最坏的那个，和 run.ts 的口径一致
  const failed = results.find((r) => r.result !== JudgeStatus.ACCEPTED)
  return failed ?? results[0]!
}

/** 判题机刚重建时还没起来，先等它 —— 否则整屏都是连接被拒。 */
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      return await sandboxVersion()
    } catch {
      // 还没起来，接着等
    }
    await Bun.sleep(500)
  }
  console.error(`连不上判题机 ${url}（等了 30 秒）`)
  process.exit(2)
}

const version = await waitReady()

let failures = 0
console.log(`判题机 ${url}（go-judge ${version}）\n`)
for (const item of cases) {
  try {
    const got = await runCase(item)
    const pass = got.result === item.expect && (item.signal === undefined || ('signal' in got && got.signal === item.signal))
    if (!pass) failures++
    const time = 'cpu_time' in got ? ` ${got.cpu_time}ms` : ''
    const signal = item.signal !== undefined && 'signal' in got ? ` 信号 ${got.signal}` : ''
    console.log(
      `${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${item.name.padEnd(32)}` +
        ` 期望 ${label(item.expect).padEnd(10)} 实得 ${label(got.result)}${signal}${time}`,
    )
  } catch (error) {
    failures++
    console.log(`\x1b[31m✗\x1b[0m ${item.name.padEnd(32)} ${error}`)
  }
}

console.log(failures === 0 ? `\n\x1b[32m全部 ${cases.length} 条通过\x1b[0m` : `\n\x1b[31m${failures} / ${cases.length} 条不对\x1b[0m`)
process.exit(failures === 0 ? 0 : 1)
