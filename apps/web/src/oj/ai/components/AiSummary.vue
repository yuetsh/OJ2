<script setup lang="ts">
import type { LearningPeriod } from "@oj2/contract"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import Markdown from "shared/components/Markdown.vue"
import { parseTime } from "utils/functions"
import { streamAI } from "utils/stream"
import { getLatestAnalysis } from "../../api"

/**
 * AI 小结。进来先拿这个时间段上次生成的那份（老师钉住的优先），没有才出按钮 ——
 * 一份小结要等十几秒、也要花钱，不在进页面时自动生成。
 */
const props = defineProps<{
  period: LearningPeriod
  username?: string
  /** 手机：默认只露前几行 */
  compact?: boolean
}>()

const theme = useThemeVars()
const content = ref("")
const createdAt = ref("")
const pinned = ref(false)
const generating = ref(false)
const waiting = ref(false)
const failed = ref("")
const expanded = ref(false)
let controller: AbortController | null = null

async function load() {
  controller?.abort()
  generating.value = false
  failed.value = ""
  expanded.value = false
  const period = props.period
  const username = props.username
  const record = await getLatestAnalysis(period, username).catch(() => null)
  if (period !== props.period || username !== props.username) return
  content.value = record?.analysis ?? ""
  createdAt.value = record?.createTime ?? ""
  pinned.value = record?.isPinned ?? false
}

watch(() => [props.period, props.username], load, { immediate: true })
onBeforeUnmount(() => controller?.abort())

async function generate() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  generating.value = true
  waiting.value = true
  failed.value = ""
  content.value = ""
  pinned.value = false
  expanded.value = true
  try {
    await streamAI(
      "ai/analysis",
      { period: props.period, username: props.username || undefined },
      {
        signal: current.signal,
        onDelta(delta) {
          waiting.value = false
          content.value += delta
        },
      },
    )
    createdAt.value = new Date().toISOString()
  } catch (error) {
    if (current.signal.aborted) return
    failed.value = (error as Error).message || "AI 服务暂时不可用，请稍后再试"
  } finally {
    if (controller === current) {
      generating.value = false
      waiting.value = false
    }
  }
}

const folded = computed(() => props.compact && !expanded.value && !generating.value)
</script>

<template>
  <section class="card">
    <h3><Icon icon="ph:sparkle" />AI 帮你分析</h3>
    <template v-if="content">
      <div class="body" :class="{ folded }">
        <Markdown :content="content" />
      </div>
      <div v-if="!generating" class="foot">
        <a v-if="folded" href="#" @click.prevent="expanded = true">展开全文 ▾</a>
        <span v-if="createdAt"
          >{{ parseTime(createdAt, "M月D日") }} 生成{{ pinned ? " · 老师置顶" : "" }}</span
        >
        <a href="#" @click.prevent="generate">重新分析</a>
      </div>
    </template>
    <n-spin v-else-if="waiting" size="small">
      <div class="waiting">正在看{{ username ? "他" : "你" }}的做题记录…</div>
    </n-spin>
    <div v-else class="empty">
      <p>让 AI 按这些数据，写一段{{ username ? "给他" : "给你" }}的小结和下一步建议</p>
      <n-button type="primary" @click="generate">
        <template #icon><Icon icon="ph:sparkle" /></template>
        AI 帮我分析
      </n-button>
    </div>
    <p v-if="failed" class="failed">{{ failed }}</p>
  </section>
</template>

<style scoped>
.card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(107, 71, 194, 0.3);
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--oj-fs-h2);
  color: #7c5cd0;
}

.body.folded {
  max-height: 150px;
  overflow: hidden;
  /* Chrome 105 只认带前缀的，不带前缀的到 120 才有 */
  -webkit-mask-image: linear-gradient(#000 60%, transparent);
  mask-image: linear-gradient(#000 60%, transparent);
}

.foot {
  display: flex;
  gap: 12px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.foot a {
  color: #18a058;
  text-decoration: none;
}

.waiting {
  height: 60px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.empty p,
.failed {
  margin: 0;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
}

.failed {
  color: v-bind("theme.errorColor");
}
</style>
