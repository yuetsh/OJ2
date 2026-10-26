<script setup lang="ts">
import { isSqlProblem } from '@oj2/contract'
import { getProblem } from 'oj/api'
import { errorMessage } from 'utils/api'
import type { ProblemDetail } from 'utils/types'

// Markdown 连着整套代码高亮（两百多 KB），这里要等点开 / AI 写完才用得上，别让它拖慢页面
const Markdown = defineAsyncComponent(() => import('shared/components/Markdown.vue'))

/**
 * 「讲错误」弹层左边的题目（用户要的：演示学生的错误时题目和代码要并排）。
 * 只摆讲题用得上的：描述、输入、输出、例子 —— 题目页的状态标签、流程图、相似题都不要。
 */
const props = defineProps<{ displayId: string }>()

const problem = ref<ProblemDetail | null>(null)
const failed = ref('')

// 同一道题 ← → 换人不重拉：弹层开着时一直是这道题
const cache = new Map<string, ProblemDetail>()
watch(
  () => props.displayId,
  async (id) => {
    failed.value = ''
    const hit = cache.get(id)
    if (hit) {
      problem.value = hit
      return
    }
    problem.value = null
    try {
      const data = await getProblem(id, '')
      cache.set(id, data)
      if (props.displayId === id) problem.value = data
    } catch (error) {
      failed.value = errorMessage(error)
    }
  },
  { immediate: true },
)

const isSQL = computed(() => !!problem.value && isSqlProblem(problem.value))
</script>

<template>
  <div class="brief">
    <n-text v-if="failed" type="error">{{ failed }}</n-text>
    <n-spin v-else-if="!problem" size="small" />
    <template v-else>
      <section class="block">
        <h3 class="title">描述</h3>
        <Markdown html :content="problem.description" />
      </section>
      <template v-if="!isSQL">
        <section v-if="problem.inputDescription" class="block">
          <h3 class="title">输入</h3>
          <Markdown html :content="problem.inputDescription" />
        </section>
        <section v-if="problem.outputDescription" class="block">
          <h3 class="title">输出</h3>
          <Markdown html :content="problem.outputDescription" />
        </section>
        <section v-if="problem.samples.length" class="block">
          <h3 class="title">例子</h3>
          <div v-for="(sample, i) in problem.samples" :key="i" class="sample">
            <div class="io">
              <span class="label">例子 {{ i + 1 }} 输入</span>
              <pre>{{ sample.input }}</pre>
            </div>
            <div class="io">
              <span class="label">输出</span>
              <pre>{{ sample.output }}</pre>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.brief {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 16px;
  line-height: 1.75;
}

.title {
  margin: 0 0 4px;
  padding-left: 8px;
  border-left: 3px solid var(--success);
  font-size: 15px;
}

.sample {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.io {
  min-width: 0;
  border: 1px solid var(--divider);
  border-radius: 6px;
  padding: 4px 10px 6px;
}

.label {
  font-size: 12px;
  color: var(--text3);
}

pre {
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
