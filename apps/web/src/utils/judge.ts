import axios from "axios"
import { base64DecodeUtf8, base64EncodeUtf8 } from "./functions"
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
  Python: 71,
}

export async function createTestSubmission(code: Code, input: string) {
  const encodedCode = base64EncodeUtf8(code.value)
  const id = JUDGE0_LANGUAGE_ID[code.language]
  if (id === undefined) {
    return { status: null, output: `${code.language} 不支持在线试运行` }
  }
  let compilerOptions = ""
  if (id === 50) compilerOptions = "-lm" // 解决 GCC 的链接问题
  const payload = {
    source_code: encodedCode,
    language_id: id,
    stdin: base64EncodeUtf8(input),
    redirect_stderr_to_stdout: true,
    compiler_options: compilerOptions,
  }
  const response = await http.post("/submissions", payload, {
    params: { base64_encoded: true, wait: true },
  })
  const data = response.data
  const status: number | null = data.status?.id ?? null
  const stdout = base64DecodeUtf8(data.stdout)
  // 跑通了（3 = Accepted）就只要程序自己的输出，而且只去掉末尾的空白：
  // - C 有警告（隐式声明 sqrt、用了 gets）时 Judge0 跑通了也带回 compile_output，拼进来
  //   就成了「你的输出」的一部分，例子永远对不上；后台生成测试点时还会写进 .out
  // - 开头的空格是输出的一部分（打印菱形、三角形），原来整体 trim() 会把它削掉，
  //   对的代码被判成「只是空格不一样」
  if (status === 3) return { status, output: stdout.trimEnd() }
  // 没跑通：报错原文给人看，两段拼起来
  return {
    status,
    output: [base64DecodeUtf8(data.compile_output), stdout].join("\n").trim(),
  }
}
