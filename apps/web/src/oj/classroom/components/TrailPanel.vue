<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { useTone } from "shared/composables/tone"
import UserName from "shared/components/UserName.vue"
import { attemptTone, cachedSubmission } from "oj/statistics/attempts"
import { JUDGE_STATUS, LANGUAGE_FORMAT_VALUE } from "utils/constants"
import { parseTime } from "utils/functions"
import type { ClassBoardCell, ClassBoardProblem, Submission } from "utils/types"

/**
 * 点开一个做对了的格子：他这道题今天交的每一次，一格一次、从早到晚，下面是停着的那一次的代码
 * （设计稿「课堂看板重设计」· 做对的格子也看得到轨迹）。
 *
 * 默认停在做对前最后错的那一次 —— 要讲的一般是「他最后是改了哪儿才对的」。
 * 停上去就换，不用点：老师在几格之间来回比；点也行（手机上没有悬停）
 */
const props = defineProps<{
  username: string
  problem: ClassBoardProblem
  cell: ClassBoardCell
  summary: string
  /** 「在提交列表看这 N 次」：和格子原来点进去的是同一个列表 */
  listHref: string
}>()
defineEmits<{ close: [] }>()

const tone = useTone()
const theme = useThemeVars()

const picked = ref(
  props.cell.acceptedTry
    ? Math.max(props.cell.acceptedTry - 2, 0)
    : Math.max(props.cell.trail.length - 1, 0),
)
const item = computed(() => props.cell.trail[picked.value] ?? props.cell.trail.at(-1))

const code = reactive<Record<string, Submission | "loading" | "failed">>({})
watch(
  () => item.value?.id,
  async (id) => {
    if (!id || (code[id] && code[id] !== "failed")) return
    code[id] = "loading"
    try {
      code[id] = await cachedSubmission(id)
    } catch {
      code[id] = "failed"
    }
  },
  { immediate: true },
)
const shown = computed(() => {
  const value = item.value && code[item.value.id]
  return typeof value === "object" ? value : null
})

const squares = computed(() =>
  props.cell.trail.map((row) => ({
    ...row,
    color: tone(attemptTone(row.result)).solid,
  })),
)
</script>

<template>
  <div class="trail">
    <div class="head">
      <UserName :username="username" />
      <span class="problem">
        <b>{{ problem.problemDisplayId }}</b>
        <span class="muted">{{ problem.title }}</span>
      </span>
      <div class="spacer"></div>
      <n-button quaternary size="tiny" aria-label="收起" @click="$emit('close')">
        <template #icon><Icon icon="ph:x-bold" /></template>
      </n-button>
    </div>

    <div class="line">
      <div class="squares">
        <button
          v-for="(row, index) in squares"
          :key="row.id"
          type="button"
          class="square"
          :class="{ on: index === picked }"
          :style="{ background: row.color }"
          :aria-label="`第 ${index + 1} 次：${JUDGE_STATUS[row.result]?.name ?? ''}`"
          @mouseenter="picked = index"
          @click="picked = index"
        ></button>
      </div>
      <span class="summary">{{ summary }}</span>
    </div>

    <div v-if="item" class="code">
      <div class="code-head">
        <b :style="{ color: tone(attemptTone(item.result)).color }">
          {{ JUDGE_STATUS[item.result]?.name }}
        </b>
        <span class="muted"
          >{{ parseTime(item.createTime, "HH:mm") }} · 第 {{ picked + 1 }} 次</span
        >
      </div>
      <n-code
        v-if="shown"
        class="code-body"
        :code="shown.code"
        :language="LANGUAGE_FORMAT_VALUE[shown.language]"
        show-line-numbers
      />
      <span v-else-if="code[item.id] === 'failed'" class="muted">代码没拉下来，点下面打开看</span>
      <span v-else class="muted">代码加载中…</span>
    </div>

    <div class="links">
      <a v-if="item" :href="`/submission/${item.id}`" target="_blank">打开这次提交 ↗</a>
      <a :href="listHref" target="_blank">在提交列表看这 {{ cell.trail.length }} 次 ↗</a>
    </div>
  </div>
</template>

<style scoped>
.trail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 15px;
  white-space: nowrap;
}

.problem {
  display: flex;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}

.problem .muted {
  overflow: hidden;
  text-overflow: ellipsis;
}

.spacer {
  flex: 1;
}

.line {
  display: flex;
  align-items: center;
  gap: 14px;
}

.squares {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.square {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.square.on {
  box-shadow:
    0 0 0 2px v-bind("theme.cardColor"),
    0 0 0 4px v-bind("theme.textColor1");
}

.summary {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor2");
}

.code {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  background: v-bind("theme.actionColor");
}

.code-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-body {
  max-height: 320px;
  overflow: auto;
  font-size: 15px;
}

.links {
  display: flex;
  gap: 18px;
}

.links a {
  color: v-bind("theme.primaryColor");
  text-decoration: none;
}

.links a:hover {
  text-decoration: underline;
}

.muted {
  color: v-bind("theme.textColor3");
}
</style>
