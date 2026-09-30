export function parseProblemTemplate(template: string) {
  const section = (name: string) =>
    template.match(new RegExp(`//${name} BEGIN\\n([\\s\\S]+?)//${name} END`))?.[1] ?? ""

  return {
    prepend: section("PREPEND"),
    template: section("TEMPLATE"),
    append: section("APPEND"),
  }
}

/**
 * 编译错误里的行号扣掉模板拼在前面的行数，和运行时错误同一个口径（那边在
 * runtime-diagnosis.ts 里扣）。不扣的话有模板的题「第 N 行」和编辑器标红都落在下一行
 * —— 全库 691 条 Python 编译错误是这样。
 *
 * 认三种写法：Python 的 `File "…/solution.py", line N` 和 `(solution.py, line N)`，
 * gcc 的 `main.c:N:M:` 以及它摘录代码时左边的 `  N | `。落在模板里的行（N 不大于
 * 模板行数）是模板自己的错，原样留着。
 */
export function shiftCompileLines(message: string, prependLines: number) {
  if (prependLines <= 0) return message
  const shift = (line: string) => {
    const n = Number(line)
    return n > prependLines ? String(n - prependLines) : line
  }
  return message
    .replace(/(solution\.py", line )(\d+)/g, (_, head: string, n: string) => head + shift(n))
    .replace(/(\(solution\.py, line )(\d+)/g, (_, head: string, n: string) => head + shift(n))
    .replace(/(main\.c(?:pp)?:)(\d+)(?=:)/g, (_, head: string, n: string) => head + shift(n))
    .replace(/^(\s*)(\d+)( \|)/gm, (_, pad: string, n: string, bar: string) => pad + shift(n) + bar)
}
