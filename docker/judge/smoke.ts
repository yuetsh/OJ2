/**
 * 判题沙箱冒烟测试 —— **换镜像之后跑这个**（项目不写测试，验证一律实跑）。
 *
 *   bun docker/judge/smoke.ts                                   # 打 .env 里的 JUDGE_SERVER_URL
 *   JUDGE_SERVER_URL=http://localhost:8082 bun docker/judge/smoke.ts
 *
 * 直接打判题机的 /judge，不经过 api / worker / 队列，所以不需要起后端，也不需要
 * 库里有题 —— 测试点用 `test_case` 内联传进去，判题机会当场写进临时目录。
 *
 * 它核的是三件事：
 *   1. 三种语言都能编译、运行、判对（languageConfigs 就是线上那份，不是另抄的）
 *   2. 六种结果状态的**整数值**没变（落库的值，见 packages/contract/src/judge-status.ts）
 *   3. gcc 的宽松度没变 —— 忘了 #include 的老代码照样能过（gcc-14 默认会把它判 CE）
 */
import { createHash } from "node:crypto"

import { JudgeStatus } from "@oj2/contract"

import { languageConfigs } from "../../apps/api/src/judge/languages"

const url = process.env.JUDGE_SERVER_URL ?? "http://localhost:8081"
const rawToken = process.env.JUDGE_SERVER_TOKEN
if (!rawToken) {
  console.error("JUDGE_SERVER_TOKEN 没设 —— 在 OJ2 根目录跑，bun 会自己读 .env")
  process.exit(2)
}
const token = createHash("sha256").update(rawToken).digest("hex")

interface Case {
  language: string
  name: string
  code: string
  expect: number
  /** 默认 3000ms / 128MB，跑得慢或要撑爆内存的用例自己改 */
  cpu?: number
  memory?: number
}

const sumTestCase = [{ input: "1 2\n", output: "3\n" }]

const cases: Case[] = [
  // ---------------------------------------------------------------- C
  {
    language: "C",
    name: "C 正常通过",
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
    language: "C",
    name: "C 忘了 #include 仍能过（gcc 宽松度）",
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
    language: "C",
    name: "C 不带值的 return;、省略 int 的 main() 仍能过（gcc 宽松度）",
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
    language: "C",
    name: "C 答案错误",
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
    language: "C",
    name: "C 编译错误",
    expect: JudgeStatus.COMPILE_ERROR,
    code: `int main(void) { return }`,
  },
  {
    language: "C",
    name: "C 运行超时",
    expect: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED,
    cpu: 1000,
    code: `int main(void) {
  volatile long x = 0;
  while (1) x++;
  return 0;
}`,
  },
  {
    // RLIMIT_AS 是 max_memory 的两倍，所以 malloc 会先成功一阵子再失败，
    // 退出时 ru_maxrss 已经超过 max_memory → judger 判 MLE 而不是 RE。
    language: "C",
    name: "C 内存超限",
    expect: JudgeStatus.MEMORY_LIMIT_EXCEEDED,
    memory: 64 * 1024 * 1024,
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
    language: "C",
    name: "C 运行时错误",
    expect: JudgeStatus.RUNTIME_ERROR,
    code: `int main(void) {
  int *p = 0;
  *p = 1;
  return 0;
}`,
  },
  // ---------------------------------------------------------------- Python
  {
    language: "Python",
    name: "Python 正常通过",
    expect: JudgeStatus.ACCEPTED,
    code: `a, b = map(int, input().split())
print(a + b)`,
  },
  {
    language: "Python",
    name: "Python 编译错误",
    expect: JudgeStatus.COMPILE_ERROR,
    code: `def (:`,
  },
  {
    language: "Python",
    name: "Python 运行超时",
    expect: JudgeStatus.CPU_TIME_LIMIT_EXCEEDED,
    cpu: 1000,
    code: `while True:
    pass`,
  },
  {
    language: "Python",
    name: "Python 运行时错误",
    expect: JudgeStatus.RUNTIME_ERROR,
    code: `print(1 / 0)`,
  },
  // ---------------------------------------------------------------- C++
  {
    language: "C++",
    name: "C++ 正常通过",
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
    language: "C++",
    name: "C++ 编译错误",
    expect: JudgeStatus.COMPILE_ERROR,
    code: `int main() { return }`,
  },
]

const names: Record<number, string> = {
  [JudgeStatus.COMPILE_ERROR]: "CE",
  [JudgeStatus.WRONG_ANSWER]: "WA",
  [JudgeStatus.ACCEPTED]: "AC",
  [JudgeStatus.CPU_TIME_LIMIT_EXCEEDED]: "TLE(cpu)",
  [JudgeStatus.REAL_TIME_LIMIT_EXCEEDED]: "TLE(real)",
  [JudgeStatus.MEMORY_LIMIT_EXCEEDED]: "MLE",
  [JudgeStatus.RUNTIME_ERROR]: "RE",
  [JudgeStatus.SYSTEM_ERROR]: "SE",
}
const label = (code: number) => `${names[code] ?? "?"}(${code})`

async function runCase(item: Case) {
  const response = await fetch(new URL("/judge", url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Judge-Server-Token": token,
    },
    body: JSON.stringify({
      language_config: languageConfigs[item.language],
      src: item.code,
      max_cpu_time: item.cpu ?? 3000,
      max_memory: item.memory ?? 128 * 1024 * 1024,
      test_case: sumTestCase,
      output: false,
      io_mode: {
        io_mode: "Standard IO",
        input: "input.txt",
        output: "output.txt",
      },
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const body = (await response.json()) as {
    err: string | null
    data: unknown
  }
  // 编译失败走 err 通道，不会有逐测试点的结果
  if (body.err === "CompileError") return { result: JudgeStatus.COMPILE_ERROR }
  if (body.err) throw new Error(`${body.err}: ${JSON.stringify(body.data)}`)

  const results = body.data as { result: number; cpu_time: number }[]
  // 多个测试点取最坏的那个，和 run.ts 的口径一致
  const failed = results.find((r) => r.result !== JudgeStatus.ACCEPTED)
  return failed ?? results[0]!
}

/** 判题机刚重建时 gunicorn 还没起来，先等它 —— 否则整屏都是连接被关。 */
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(new URL("/ping", url), {
        method: "POST",
        headers: { "X-Judge-Server-Token": token },
      })
      if (response.ok) return
    } catch {
      // 还没起来，接着等
    }
    await Bun.sleep(500)
  }
  console.error(`连不上判题机 ${url}（等了 30 秒）`)
  process.exit(2)
}

await waitReady()

let failures = 0
console.log(`判题机 ${url}\n`)
for (const item of cases) {
  try {
    const got = await runCase(item)
    const pass = got.result === item.expect
    if (!pass) failures++
    const time = "cpu_time" in got ? ` ${got.cpu_time}ms` : ""
    console.log(
      `${pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${item.name.padEnd(32)}` +
        ` 期望 ${label(item.expect).padEnd(10)} 实得 ${label(got.result)}${time}`,
    )
  } catch (error) {
    failures++
    console.log(`\x1b[31m✗\x1b[0m ${item.name.padEnd(32)} ${error}`)
  }
}

console.log(
  failures === 0
    ? `\n\x1b[32m全部 ${cases.length} 条通过\x1b[0m`
    : `\n\x1b[31m${failures} / ${cases.length} 条不对\x1b[0m`,
)
process.exit(failures === 0 ? 0 : 1)
