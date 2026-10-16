/**
 * 账号名单下成表格：用户名、密码两列。批量建号建完下名单、用户列表按班下名单共用这一份。
 * 开头带 BOM，Excel 打开中文才不乱码
 */
export function downloadAccountsCsv(
  rows: { username: string; password: string }[],
  filename: string,
) {
  const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const csv =
    "﻿用户名,密码\n" + rows.map((it) => `${cell(it.username)},${cell(it.password)}`).join("\n")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
