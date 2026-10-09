<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getProblemSetLocks } from "oj/api"
import { parseTime } from "utils/functions"
import type { ProblemSetLock } from "utils/types"

/**
 * 「旧代码为什么藏着」那一句（设计稿「题单重设计」旧代码藏着时学生看到的）：
 * 题单《X》布置中，这道题以前的代码先藏着 · 在题单里做对，或 M月D日 之后就能看。
 * 规则在后端 problemSetLockCutoffs；查不到是哪个题单（比如刚过期）就说通用的一句
 */
const props = defineProps<{ problem: { id: number } | { displayId: string } }>()
const theme = useThemeVars()

const locks = ref<ProblemSetLock[]>([])

watch(
  () => ("id" in props.problem ? props.problem.id : props.problem.displayId),
  async () => {
    try {
      locks.value = await getProblemSetLocks(props.problem)
    } catch {
      locks.value = []
    }
  },
  { immediate: true },
)

const first = computed(() => locks.value[0])
</script>

<template>
  <span v-if="first">
    题单<router-link :to="{ name: 'problemset', params: { problemSetId: first.problemSetId } }"
      >《{{ first.title }}》</router-link
    >布置中，这道题以前的代码先藏着 · 在题单里做对，或
    {{ parseTime(first.assignedUntil, "M月D日") }} 之后就能看
  </span>
  <span v-else>这道题正在题单里布置，以前的代码先藏着 · 在题单里做对，或者布置期结束就能看</span>
</template>

<style scoped>
a {
  color: v-bind("theme.primaryColor");
  text-decoration: none;
}
</style>
