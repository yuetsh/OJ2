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

export async function createTestSubmission(code: Code, input: string) {
  const encodedCode = encode(code.value)
  const id = JUDGE0_LANGUAGE_ID[code.language]
  if (id === undefined) {
    return { status: null, output: `${code.language} 不支持在线试运行` }
  }
  let compilerOptions = ""
  if (id === 50) compilerOptions = "-lm" // 解决 GCC 的链接问题
  const payload = {
    source_code: encodedCode,
    language_id: id,
    stdin: encode(input),
    redirect_stderr_to_stdout: true,
    compiler_options: compilerOptions,
  }
  const response = await http.post("/submissions", payload, {
    params: { base64_encoded: true, wait: true },
  })
  const data = response.data
  return {
    status: data.status && data.status.id,
    output: [decode(data.compile_output), decode(data.stdout)]
      .join("\n")
      .trim(),
  }
}
