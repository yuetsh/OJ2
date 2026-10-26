import { NO_CLASS } from '@oj2/contract'

/**
 * 班级下拉的标签：`253` → `25计算机3班`，和统计面板、班级 PK 同一个写法。
 * null（接口里没填班级的号）和 NO_CLASS（筛选里的「没填班级」）都写成「没填班级」
 */
export function classLabel(className: string | null) {
  if (className === null || className === NO_CLASS) return '没填班级'
  if (!/^\d{3,}$/.test(className)) return className
  return `${className.slice(0, 2)}计算机${className.slice(2)}班`
}

type ClassOption = { label: string; value: string }

/**
 * 全站的班级下拉都按年级分组：「25 级」底下列 251、252……，新的年级在上，组里按班号排
 * （11 班排在 2 班后面）。年级是班号前两位，和排名的「本年级」同一个口径。
 * `first` 给了就把那个年级提到最前（班级 PK 加班时先给同年级的）。
 * `toOption` 换掉选项长相（题单的「n/m 人加入」、登录框的 ks 前缀）；不是数字班号的
 * 名字不分组，按原顺序跟在最后。
 */
export function groupClassOptions<T extends ClassOption = ClassOption>(
  names: string[],
  toOption: (name: string) => T = (name) => ({ label: classLabel(name), value: name }) as T,
  first?: string,
) {
  const groups = new Map<string, string[]>()
  const rest: string[] = []
  for (const name of new Set(names)) {
    if (!/^\d{3,}$/.test(name)) {
      rest.push(name)
      continue
    }
    const grade = name.slice(0, 2)
    groups.set(grade, [...(groups.get(grade) ?? []), name])
  }
  const grouped = [...groups]
    .sort((a, b) => (a[0] === first ? -1 : b[0] === first ? 1 : b[0].localeCompare(a[0])))
    .map(([grade, list]) => ({
      type: 'group' as const,
      label: `${grade} 级`,
      key: `grade-${grade}`,
      children: list.sort((a, b) => a.localeCompare(b, 'zh', { numeric: true })).map(toOption),
    }))
  return [...grouped, ...rest.map(toOption)]
}

/**
 * 班级下拉的选项：配置里的班按年级分组，最后一项「没填班级」（这批号也要能和普通班一样
 * 圈出来看）。带进来的班不在配置里（老班、手打的）也要显示得出来，不然框里是空的却在筛
 */
export function classSelectOptions(list: string[], current: string) {
  const all = current && current !== NO_CLASS ? [current, ...list] : list
  return [...groupClassOptions(all), { label: classLabel(NO_CLASS), value: NO_CLASS }]
}
