import { normalizeLanguage } from "@oj2/contract"

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
 * 0019 迁移把数据并成了一个值。查配置一律走 `judgeConfigFor()`，别直接下标 ——
 * 那里带着旧值的别名，迁移之前排进队列的任务、旧客户端传上来的值都还能判。
 *
 * SQL 题不走这里，走 `judge/sql/`；流程图题走 AI 评分。
 */
const defaultEnv = ["LANG=en_US.UTF-8", "LANGUAGE=en_US:en", "LC_ALL=en_US.UTF-8"]

/**
 * gcc-14 起这四类老写法从 warning 提成了 error，而 `-w` 只关警告、压不住 error：
 * 隐式函数声明（忘了 `#include <stdio.h>` 就用 printf）、int 与指针互赋、
 * 不兼容的指针类型、`int main` 里写不带值的 `return;`（全库 4 条，gcc-13 下能跑，
 * 放行后退出码不定，多半判运行时错误，说明会让补 return 0）。判题机镜像 2026-09 从 gcc-13 升到 14（见 docker/judge/），
 * 不加这几个开关的话，**一批历史题解和 20 篇 C 教程的示例会突然全部 CE**。
 *
 * 只给 C 加：C++ 那边这些本来就是 error，g++ 升版不改判定。
 * 哪天决定「就是要学生写规范」，是删掉这几个开关，不是改镜像 —— 删之前先拿
 * docs/c-tutorials/verify-code.sh 全量过一遍教程。
 */
const cLooseErrors =
  "-Wno-error=implicit-function-declaration -Wno-error=int-conversion -Wno-error=incompatible-pointer-types -Wno-error=return-mismatch"

export const languageConfigs: Record<string, Record<string, unknown>> = {
  C: {
    template: "",
    compile: {
      src_name: "main.c",
      exe_name: "main",
      max_cpu_time: 3000,
      max_real_time: 10000,
      max_memory: 256 * 1024 * 1024,
      compile_command: `/usr/bin/gcc -DONLINE_JUDGE -O2 -w -fmax-errors=3 -std=c17 ${cLooseErrors} {src_path} -lm -o {exe_path}`,
    },
    run: {
      command: "{exe_path}",
      seccomp_rule: { "Standard IO": "c_cpp", "File IO": "c_cpp_file_io" },
      env: defaultEnv,
    },
  },
  "C++": {
    template: "",
    compile: {
      src_name: "main.cpp",
      exe_name: "main",
      max_cpu_time: 10000,
      max_real_time: 20000,
      max_memory: 1024 * 1024 * 1024,
      compile_command:
        "/usr/bin/g++ -DONLINE_JUDGE -O2 -w -fmax-errors=3 -std=c++20 {src_path} -lm -o {exe_path}",
    },
    run: {
      command: "{exe_path}",
      seccomp_rule: { "Standard IO": "c_cpp", "File IO": "c_cpp_file_io" },
      env: defaultEnv,
    },
  },
  Python: {
    template: "",
    compile: {
      src_name: "solution.py",
      exe_name: "solution.py",
      max_cpu_time: 3000,
      max_real_time: 10000,
      max_memory: 128 * 1024 * 1024,
      compile_command: "/usr/bin/python3 -m py_compile {src_path}",
    },
    run: {
      command: "/usr/bin/python3 -BS {exe_path}",
      seccomp_rule: "general",
      env: defaultEnv,
    },
  },
}

/**
 * 按语言取判题配置。**判题侧一律走这个函数**，不要直接 `languageConfigs[x]`：
 * 它先过 `normalizeLanguage()`，所以 `Python3` / `Python2` 这类旧值也能命中。
 */
export function judgeConfigFor(language: string) {
  return languageConfigs[language] ?? languageConfigs[normalizeLanguage(language) ?? ""] ?? null
}
