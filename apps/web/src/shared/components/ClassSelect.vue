<script setup lang="ts" generic="T extends string | null">
import { NO_CLASS } from '@oj2/contract'

import { useConfigStore } from 'shared/store/config'
import { classLabel, groupClassOptions } from 'utils/classes'

/**
 * 全站的班级下拉，所有选班的地方都用它。
 *
 * - 选项按年级分组（groupClassOptions）；框里的班不在候选里（老班、手打的、地址带进来的）也补上，
 *   不然框里是空的却在筛。
 * - 最后一项「没填班级」（NO_CLASS）：看人、看进度的地方，这批号要能和普通班一样圈出来。后端一律
 *   由 `routes/helpers.ts` 的 classCondition / rosterCondition 认这个值。只有「挑一个真班去做事」
 *   的地方（布置作业、课堂任务、登录、班级 PK、排名、抽人）用 `:no-class="false"` 关掉 ——
 *   没填班级的号凑不成一个班，没法布置、没有年级，名单也是两百多个不相干的人。
 * - `all`：能清空，空着就是「全部班级」，值是 ''。
 * - `classes`：候选班，不给就用配置里的班级列表；`label` 换选项文字（专题的「n/m 人加入」）。
 */
const props = withDefaults(
  defineProps<{
    classes?: string[]
    all?: boolean
    noClass?: boolean
    placeholder?: string
    label?: (name: string) => string
  }>(),
  { noClass: true },
)

const value = defineModel<T>('value', { required: true })
const configStore = useConfigStore()

const options = computed(() => {
  const list = props.classes ?? configStore.config?.classList ?? []
  const label = props.label ?? classLabel
  const names = (value.value ? [value.value, ...list] : list).filter((name) => name !== NO_CLASS)
  const grouped = groupClassOptions(names, (name) => ({ label: label(name), value: name }))
  // 候选里本来就有（专题按加入的人数出来的）、或者框里正选着的，关着也要列出来
  const withNoClass = props.noClass || list.includes(NO_CLASS) || value.value === NO_CLASS
  return withNoClass ? [...grouped, { label: label(NO_CLASS), value: NO_CLASS }] : grouped
})

function update(next: string | null) {
  value.value = (props.all ? (next ?? '') : next) as T
}
</script>

<template>
  <n-select
    :value="value || null"
    :options="options"
    :placeholder="placeholder ?? (all ? '全部班级' : '选班级')"
    :clearable="all"
    filterable
    @update:value="update"
  />
</template>
