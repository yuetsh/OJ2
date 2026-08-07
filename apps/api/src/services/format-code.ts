import { config } from "../config"

export class CodeFormatError extends Error {
  constructor(
    message: string,
    readonly kind: "syntax" | "tool",
  ) {
    super(message)
  }
}

async function runFormatter(command: string[], code: string) {
  let process: ReturnType<typeof Bun.spawn>
  try {
    process = Bun.spawn(command, {
      stdin: new Blob([code]),
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    throw new CodeFormatError(String(error), "tool")
  }

  const timeout = setTimeout(() => process.kill(), 5_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout as ReadableStream<Uint8Array>).text(),
    new Response(process.stderr as ReadableStream<Uint8Array>).text(),
  ])
  clearTimeout(timeout)
  return { exitCode, stdout, stderr }
}

function formatSql(code: string) {
  return code
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) =>
      statement.replace(
        /\b(select|from|where|join|left|right|inner|outer|on|group by|order by|having|limit|insert into|values|update|set|delete from|create table|drop table|alter table|and|or|as)\b/gi,
        (keyword) => keyword.toUpperCase(),
      ),
    )
    .join(";\n\n") + (code.trim().endsWith(";") ? ";" : "")
}

export async function formatCode(code: string, language: "python" | "c" | "cpp" | "sql") {
  if (language === "sql") return formatSql(code)

  if (language === "python") {
    const result = await runFormatter(
      [config.ruffPath, "format", "--stdin-filename", "code.py", "-"],
      code,
    )
    if (result.exitCode !== 0) {
      throw new CodeFormatError(result.stderr || "Invalid Python syntax", "syntax")
    }
    return result.stdout
  }

  const filename = language === "c" ? "code.c" : "code.cpp"
  const result = await runFormatter(
    [
      config.clangFormatPath,
      `-assume-filename=${filename}`,
      "-style={BasedOnStyle: LLVM, IndentWidth: 4, BreakBeforeBraces: Attach}",
    ],
    code,
  )
  if (result.exitCode !== 0) {
    throw new CodeFormatError(result.stderr || "Formatting failed", "tool")
  }
  return result.stdout
}
