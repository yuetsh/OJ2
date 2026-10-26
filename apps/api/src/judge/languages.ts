/**
 * 判题沙箱认得的语言，**只有 C / C++ / Python 这三种**。
 *
 * Java / Golang / JavaScript 在 2026-09 连同镜像里的 JDK、Go、Node 工具链一起砍掉了：
 * 前端从来没给过它们入口（后台题目的语言复选框只有 Python / C / C++ / SQL），
 * 生产库 12 万条提交里它们一共 62 条，全是很早以前的。砍掉之后判题镜像小了一半多。
 *
 * 契约 `judgeLanguageSchema` 里那几个键**故意留着** —— 那是渲染历史提交要用的。
 * 想恢复某种语言，得同时改这里和 `docker/judge/Dockerfile` 的工具链，再重建镜像。
 *
 * `Python` 这个键 2026-09 之前叫 `Python3`（库里还有 3 条更老的 `Python2`），
 * 0019 迁移把数据并成了一个值。
 *
 * SQL 题不走这里，走 `judge/sql/`；流程图题走 AI 评分。
 *
 * 命令里的文件名都是相对沙箱工作目录（/w）的。编译错误因此是 `main.c:3:5: error`，
 * 不带目录；Python 的回溯会被解释器补成绝对路径 `/w/solution.py`，前端显示前去掉。
 * 限额（CPU 毫秒、墙钟毫秒、字节）的口径照搬 JudgeServer，怎么换算见 sandbox.ts。
 */
export interface LanguageConfig {
  compile: {
    /** 学生代码写成的文件名 */
    srcName: string
    /** 编译产物。Python 没有产物，「编译」只是 py_compile 查一遍语法，运行的还是源文件 */
    exeName: string
    command: string[]
    maxCpuTime: number
    maxRealTime: number
    maxMemory: number
  }
  run: {
    command: string[]
  }
}

/**
 * gcc-14 起这五类老写法从 warning 提成了 error，而 `-w` 只关警告、压不住 error：
 * 隐式函数声明（忘了 `#include <stdio.h>` 就用 printf）、int 与指针互赋、
 * 不兼容的指针类型、`int main` 里写不带值的 `return;`（全库 4 条，gcc-13 下能跑，
 * 放行后退出码不定，多半判运行时错误，说明会让补 return 0）、省略 int 的
 * `main()`（全库判过的 45 条，其中 8 条 AC）。判题机镜像 2026-09 从 gcc-13 升到 14（见 docker/judge/），
 * 不加这几个开关的话，**一批历史题解和 20 篇 C 教程的示例会突然全部 CE**。
 *
 * 只给 C 加：C++ 那边这些本来就是 error，g++ 升版不改判定。
 * 哪天决定「就是要学生写规范」，是删掉这几个开关，不是改镜像 —— 删之前先拿
 * docs/c-tutorials/verify-code.sh 全量过一遍教程。
 */
const cLooseErrors = [
  '-Wno-error=implicit-function-declaration',
  '-Wno-error=int-conversion',
  '-Wno-error=incompatible-pointer-types',
  '-Wno-error=return-mismatch',
  '-Wno-error=implicit-int',
]

export const languageConfigs: Record<string, LanguageConfig> = {
  C: {
    compile: {
      srcName: 'main.c',
      exeName: 'main',
      command: ['/usr/bin/gcc', '-DONLINE_JUDGE', '-O2', '-w', '-fmax-errors=3', '-std=c17', ...cLooseErrors, 'main.c', '-lm', '-o', 'main'],
      maxCpuTime: 3000,
      maxRealTime: 10000,
      maxMemory: 256 * 1024 * 1024,
    },
    run: { command: ['main'] },
  },
  'C++': {
    compile: {
      srcName: 'main.cpp',
      exeName: 'main',
      command: ['/usr/bin/g++', '-DONLINE_JUDGE', '-O2', '-w', '-fmax-errors=3', '-std=c++20', 'main.cpp', '-lm', '-o', 'main'],
      maxCpuTime: 10000,
      maxRealTime: 20000,
      maxMemory: 1024 * 1024 * 1024,
    },
    run: { command: ['main'] },
  },
  Python: {
    compile: {
      srcName: 'solution.py',
      exeName: 'solution.py',
      command: ['/usr/bin/python3', '-m', 'py_compile', 'solution.py'],
      maxCpuTime: 3000,
      maxRealTime: 10000,
      maxMemory: 128 * 1024 * 1024,
    },
    run: { command: ['/usr/bin/python3', '-BS', 'solution.py'] },
  },
}

/** 按语言取判题配置，判题机不认的语言（Java 等历史值、SQL、流程图）返回 null */
export function judgeConfigFor(language: string) {
  return languageConfigs[language] ?? null
}
