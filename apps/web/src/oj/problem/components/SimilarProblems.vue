<script lang="ts">
import type { ProblemRow } from "utils/types"

/**
 * 同一道题两处（题面末尾、结果页签）都挂着时只拉一次。放在模块级：写在 setup 里就成了
 * 每个实例各一份
 */
const cache = new Map<string, Promise<ProblemRow[]>>()
</script>

<script setup lang="ts">
import { storeToRefs } from "pinia"
import { getSimilarProblems } from "oj/api"
import { useProblemStore } from "oj/store/problem"

/**
 * 相似题推荐。题面末尾（做对了、或者错了 3 次以上）和结果页签（不在课堂里的题做对之后）
 * 两处用：原来只在题面最底下，学生交完不会再滚回去看。什么时候出现由调用方的 v-if 决定。
 */
const props = defineProps<{ title: string }>()

const { problem } = storeToRefs(useProblemStore())
const list = ref<ProblemRow[]>([])

watch(
  () => problem.value?._id,
  async (id) => {
    list.value = []
    if (!id) return
    if (!cache.has(id))
      cache.set(
        id,
        getSimilarProblems(id).catch(() => []),
      )
    const rows = await cache.get(id)!
    if (problem.value?._id === id) list.value = rows
  },
  { immediate: true },
)

// getSimilarProblems 已经过 toProblemRow，难度是中文，不是 Low/Mid/High
function difficultyType(difficulty: string) {
  if (difficulty === "简单") return "success"
  if (difficulty === "困难") return "error"
  return "warning"
}
</script>

<template>
  <section v-if="list.length" class="similar">
    <h3 class="title">{{ props.title }}</h3>
    <n-list bordered>
      <n-list-item v-for="sp in list" :key="sp._id">
        <n-flex align="center" justify="space-between" :wrap="false">
          <router-link :to="{ name: 'problem', params: { problemID: sp._id } }" class="link">
            <n-tag size="small" :bordered="false">{{ sp._id }}</n-tag>
            <span class="name">{{ sp.title }}</span>
          </router-link>
          <n-tag v-if="sp.difficulty" size="small" :type="difficultyType(sp.difficulty)">
            {{ sp.difficulty }}
          </n-tag>
        </n-flex>
      </n-list-item>
    </n-list>
  </section>
</template>

<style scoped>
.similar {
  margin-top: 20px;
}

.title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.link:hover .name {
  text-decoration: underline;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
