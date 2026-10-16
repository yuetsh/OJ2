/**
 * 进程内的短缓存，同时到达的相同请求只查一次库。
 *
 * 给「谁来看都一样」的聚合用：排名的那群人做对了哪些题、全服班级对抗、全部题目的
 * 做对人数。这些在本机 16 核上就要 40–250ms，服务器只有两核、还要判题，而上课时一个班
 * 几十个人会在同一分钟打开同一张榜。缓存的是原始数据，「我」排第几、前后一名这些
 * 因人而异的部分照旧每次现算。
 *
 * 放进程内不放 Redis：值是几百 KB 的对象，序列化来回比重算省不了多少；api 只有一个
 * 进程，两个站点各算各的也没关系。不做失效，等它过期 —— 调用方选的 TTL 都很短。
 *
 * 缓存的是 Promise 本身：第一个请求还在查的时候，后到的直接等同一个结果。
 * 查失败了马上丢掉，下一个请求重新查，不把错误缓存住。
 */
const entries = new Map<string, { value: Promise<unknown>; expiresAt: number }>()

/** 键的种类有限（几个班 × 几个时间段），超过这么多才顺手扫一遍过期的 */
const SWEEP_ABOVE = 200

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = entries.get(key)
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>

  if (entries.size > SWEEP_ABOVE) {
    for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
  }
  const value = load()
  entries.set(key, { value, expiresAt: now + ttlMs })
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key)
  })
  return value
}
