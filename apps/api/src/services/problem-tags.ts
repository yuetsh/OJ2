import { inArray, sql } from "drizzle-orm"

import { schema, type DbOrTx } from "../db"

/**
 * 把一批标签名去空格、去重（大小写不敏感），保留每个名字第一次出现时的原始大小写。
 * 解析和批量打标签两条路都用它，口径对齐旧 resolve_tags。
 */
export function normalizeTagNames(names: string[]) {
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    wanted.push(name)
  }
  return wanted
}

/**
 * 一条 `lower(name) in (...)` 把已有标签全查回来，按小写名建 Map。
 * 以前是每个名字一条 SELECT，一次改十个标签就是十次往返。
 */
export async function findTagsByName(tx: DbOrTx, names: string[]) {
  const map = new Map<string, number>()
  if (names.length === 0) return map
  const rows = await tx
    .select({ id: schema.problemTag.id, name: schema.problemTag.name })
    .from(schema.problemTag)
    .where(
      inArray(
        sql`lower(${schema.problemTag.name})`,
        names.map((name) => name.toLowerCase()),
      ),
    )
  for (const row of rows) map.set(row.name.toLowerCase(), row.id)
  return map
}
