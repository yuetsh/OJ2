import axios from "axios"
import { decode, encode } from "./functions"
import type { Code, LANGUAGE } from "./types"

const http = axios.create({ baseURL: import.meta.env.PUBLIC_JUDGE0_URL })

// Judge0 的语言 id。Flowchart 和 SQL 不在其中 —— 前者根本不是可执行代码，
// 后者由本站自己的 SQL 沙箱判，都走不到 Judge0。
const JUDGE0_LANGUAGE_ID: Partial<Record<LANGUAGE, number>> = {
  C: 50,
  "C++": 54,
  Java: 62,
  Golang: 60,
  JavaScript: 63,
  Python2: 70,
  Python3: 71,
}

/**
 * 学生在自己电脑上跑，是「程序停下来等我敲、敲完回车再往下走」；判题狗这边输入是
 * 提前备好、一口气喂进去的，屏幕上只剩对和错 —— 这个落差是入门阶段最常见的困惑。
 *
 * 所以试运行时给代码套一层前导：程序每读到一段输入，就把它原样回显到 stdout，
 * 用 \u001e 包起来当标记。回来的输出拆两次用 —— 抠掉标记段是程序真正的输出（拿去和
 * 期望比对，和不套前导时一模一样），带着标记渲染就是一份终端会话。
 *
 * 只走「样例试运行」这条路，正式提交判题一个字都不加。
 */
const ECHO_MARK = "\u001e"

// C / C++ 共用：把 stdin 换成逐字节读的流，读到一个字符就立刻回显。
//
// 两条都是踩出来的：
// - 不能按**字节**回显 —— 中文是多字节，标记插进字节中间会把 UTF-8 撕碎，
//   所以攒够一个完整的 UTF-8 字符再吐。
// - 也不能攒够一**行**再吐。样例的输入不带结尾换行（库里就是 `"700"`），
//   scanf 读完最后一个数字就撞上 EOF，那个 '\\n' 永远等不到，回显只能拖到
//   程序退出时才发生 —— 而那时 stdout 缓冲区已经先落地了，屏幕上就变成
//   「答案在前、输入在后」。
//
// cookie_io_functions_t 要 _GNU_SOURCE，见下面的 compilerOptions。
const C_PREAMBLE = `#include <stdio.h>
#include <unistd.h>
static unsigned char _oj_buf[8]; static size_t _oj_len = 0, _oj_need = 0;
static void _oj_emit(void) {
  if (!_oj_len) return;
  fflush(stdout);
  write(1, "\\x1e", 1); write(1, _oj_buf, _oj_len); write(1, "\\x1e", 1);
  _oj_len = 0; _oj_need = 0;
}
static ssize_t _oj_read(void *_oj_c, char *_oj_b, size_t _oj_n) {
  (void)_oj_c; (void)_oj_n;
  ssize_t _oj_k = read(0, _oj_b, 1);
  if (_oj_k > 0) {
    unsigned char _oj_ch = (unsigned char)_oj_b[0];
    if (_oj_len == 0) {
      _oj_need = _oj_ch < 0x80 ? 1
        : (_oj_ch & 0xE0) == 0xC0 ? 2
        : (_oj_ch & 0xF0) == 0xE0 ? 3
        : (_oj_ch & 0xF8) == 0xF0 ? 4 : 1;
    }
    _oj_buf[_oj_len++] = _oj_ch;
    if (_oj_len >= _oj_need || _oj_len >= sizeof(_oj_buf)) _oj_emit();
  }
  return _oj_k;
}
__attribute__((constructor)) static void _oj_init(void) {
  cookie_io_functions_t _oj_f = {0}; _oj_f.read = _oj_read;
  stdin = fopencookie(NULL, "r", _oj_f);
  setvbuf(stdin, NULL, _IONBF, 0);
}
__attribute__((destructor)) static void _oj_fini(void) { _oj_emit(); }
`

const PYTHON_PREAMBLE = `import builtins as _oj_b
_oj_input = _oj_b.input
def _oj_echo(_oj_prompt=""):
    _oj_value = _oj_input(_oj_prompt)
    _oj_b.print("\\x1e" + _oj_value + "\\n\\x1e", end="")
    return _oj_value
_oj_b.input = _oj_echo
`

// 没列在这里的语言照旧直接跑，只是拿不到终端会话
const PREAMBLE: Partial<Record<LANGUAGE, string>> = {
  C: C_PREAMBLE,
  "C++": C_PREAMBLE,
  Python3: PYTHON_PREAMBLE,
}

/** 终端会话的一段：程序打印的，或是喂进去的输入 */
export type TranscriptSegment = { kind: "output" | "input"; text: string }

/**
 * 按标记把回来的 stdout 拆成会话片段，同时还原出「程序真正的输出」。
 * 标记不成对时按普通输出处理 —— 学生代码自己打印了 \u001e 也不会把界面搞乱。
 */
function parseTranscript(raw: string) {
  const segments: TranscriptSegment[] = []
  let output = ""
  let cursor = 0
  // C 那边是一个字符一对标记（见 C_PREAMBLE 的注释），拆出来会是一长串单字符
  // 片段，合并成整段再交给界面
  const push = (kind: TranscriptSegment["kind"], text: string) => {
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) last.text += text
    else segments.push({ kind, text })
  }
  while (cursor < raw.length) {
    const open = raw.indexOf(ECHO_MARK, cursor)
    if (open === -1) break
    const close = raw.indexOf(ECHO_MARK, open + 1)
    if (close === -1) break
    if (open > cursor) {
      const text = raw.slice(cursor, open)
      push("output", text)
      output += text
    }
    push("input", raw.slice(open + 1, close))
    cursor = close + 1
  }
  if (cursor < raw.length) {
    const text = raw.slice(cursor)
    push("output", text)
    output += text
  }
  return { segments, output }
}

/**
 * 前导代码把学生代码整体往下推了几行，报错里的行号得减回来，不然学生照着行号
 * 去找，指到的是一段他没写过的代码。
 *
 * 分成两个函数是因为**改错地方的代价不一样**：编译错误整段都是编译器说的话，
 * 怎么改都安全；stdout 里混着学生程序自己打印的东西，`printf("%4d | %s")`
 * 这种表格题一改就把人家的输出改错了，所以那边只认 Python traceback 那一种
 * 极窄的写法。
 */
function shiftCompileError(text: string, offset: number) {
  if (!text || offset <= 0) return text
  const back = (n: string) => String(Math.max(1, Number(n) - offset))
  return (
    text
      .replace(
        /(\.(?:c|cpp|cc|cxx):)(\d+)/g,
        (_, head, line) => head + back(line),
      )
      // gcc 引用源码那一栏。补空格保持原来的宽度，否则下面那行 ^ 会指歪
      .replace(/^(\s*)(\d+)(\s*\|)/gm, (_, pad, line: string, tail) => {
        return pad + back(line).padStart(line.length, " ") + tail
      })
  )
}

function shiftTraceback(text: string, offset: number) {
  if (!text || offset <= 0) return text
  return text.replace(
    /(File "script\.py", line )(\d+)/g,
    (_, head, line) => head + String(Math.max(1, Number(line) - offset)),
  )
}

export async function createTestSubmission(code: Code, input: string) {
  const id = JUDGE0_LANGUAGE_ID[code.language]
  if (id === undefined) {
    return {
      status: null,
      output: `${code.language} 不支持在线试运行`,
      segments: null as TranscriptSegment[] | null,
    }
  }
  const preamble = PREAMBLE[code.language] ?? ""
  const offset = preamble ? preamble.split("\n").length - 1 : 0
  const compilerOptions = [
    id === 50 ? "-lm" : "", // 解决 GCC 的链接问题
    preamble && (id === 50 || id === 54) ? "-D_GNU_SOURCE" : "",
  ]
    .filter(Boolean)
    .join(" ")
  const payload = {
    source_code: encode(preamble + code.value),
    language_id: id,
    stdin: encode(input),
    redirect_stderr_to_stdout: true,
    compiler_options: compilerOptions,
  }
  const response = await http.post("/submissions", payload, {
    params: { base64_encoded: true, wait: true },
  })
  const data = response.data
  const compileOutput = shiftCompileError(decode(data.compile_output), offset)
  const { segments, output } = parseTranscript(
    shiftTraceback(decode(data.stdout), offset),
  )
  return {
    status: data.status && data.status.id,
    // 判定用这个：和不套前导时跑出来的一模一样
    output: [compileOutput, output].join("\n").trim(),
    // 渲染终端会话用这个；不支持回显的语言给 null。
    // 编译错误当成一段普通输出排在最前面 —— 否则编译不过的时候 stdout 是空的，
    // 会话里什么都没有，报错反倒看不见了。
    segments: preamble
      ? compileOutput
        ? [{ kind: "output" as const, text: compileOutput + "\n" }, ...segments]
        : segments
      : null,
  }
}
