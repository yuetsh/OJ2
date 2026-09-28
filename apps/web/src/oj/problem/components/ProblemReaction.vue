<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { storeToRefs } from "pinia"
import { getReaction, setReaction } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useUserStore } from "shared/store/user"
import { REACTIONS } from "utils/constants"
import type { ReactionCounts, ReactionKey } from "utils/types"

/**
 * 题目点评：七个选项，每人每题只能评一次，做对了才能评。
 *
 * 原来是一个轮盘：鼠标移到扇区上才看得清是哪一项，每块的字只有 12px 左右，
 * 移过去的同时圆心就报出「N 人选择」—— 学生还没想好就先看到了大家怎么选。
 * 现在是一排大按钮，**选之前不给人数**（后端本来就要自己评过才返回 counts），
 * 选完变成一张横条图，看大家是怎么觉得的（设计文档第 7 节）。
 *
 * `guard`：AC 之后那个强制弹窗用。弹窗是自己冒出来的，学生手还在键盘上、鼠标还在
 * 原来的位置，所以前 600ms 点不了，也不响应 Enter / 空格（键盘触发的 click 的
 * detail 是 0）。抽屉里的是学生自己点开的，不设防。
 */
const props = defineProps<{ guard?: boolean }>()
const emit = defineEmits<{ submitted: [] }>()

const userStore = useUserStore()
const { problem } = storeToRefs(useProblemStore())
const theme = useThemeVars()

const GUARD_MS = 600

const mine = ref<ReactionKey | null>(null)
const counts = ref<ReactionCounts | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const submitting = ref<ReactionKey | null>(null)
const submitFailed = ref(false)
const ready = ref(!props.guard)
let loadSequence = 0

const solved = computed(() => problem.value?.myStatus === 0)

const state = computed(() => {
  if (!userStore.isAuthed) return "anonymous"
  if (loading.value) return "loading"
  if (loadFailed.value) return "failed"
  if (mine.value !== null && counts.value) return "results"
  if (solved.value) return "choose"
  return "locked"
})

// 选项出现的那一刻起算：换题、登录之后重新出现也重新算
const { start: armGuard, stop: disarmGuard } = useTimeoutFn(
  () => {
    ready.value = true
  },
  GUARD_MS,
  { immediate: false },
)
watch(
  () => state.value === "choose",
  (choosing) => {
    if (!choosing || !props.guard) return
    ready.value = false
    disarmGuard()
    armGuard()
  },
  { immediate: true },
)

function onOptionClick(key: ReactionKey, event: MouseEvent) {
  if (!ready.value) return
  if (props.guard && event.detail === 0) return
  pick(key)
}

async function pick(key: ReactionKey) {
  if (!problem.value || !solved.value || mine.value !== null || submitting.value) return
  submitting.value = key
  submitFailed.value = false
  try {
    const res = await setReaction(problem.value.id, key)
    mine.value = res.mine
    counts.value = res.counts
    emit("submitted")
  } catch {
    // 留在这里让他再点一次：弹窗关不掉，没有别的出路
    submitFailed.value = true
  } finally {
    submitting.value = null
  }
}

async function load(problemId: number) {
  const sequence = ++loadSequence
  loading.value = true
  loadFailed.value = false
  try {
    const res = await getReaction(problemId)
    if (sequence !== loadSequence) return
    mine.value = res.mine
    counts.value = res.counts
  } catch {
    if (sequence === loadSequence) loadFailed.value = true
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch(
  [() => userStore.isAuthed, () => problem.value?.id],
  ([isAuthed, problemId]) => {
    mine.value = null
    counts.value = null
    submitting.value = null
    submitFailed.value = false
    if (!isAuthed || problemId === undefined) {
      loadSequence += 1
      loading.value = false
      return
    }
    load(problemId)
  },
  { immediate: true },
)

const results = computed(() => {
  const all = counts.value
  if (!all) return null
  const total = REACTIONS.reduce((sum, item) => sum + (all[item.key] ?? 0), 0)
  const max = Math.max(1, ...REACTIONS.map((item) => all[item.key] ?? 0))
  return {
    total,
    mineLabel: REACTIONS.find((item) => item.key === mine.value)?.label ?? "",
    // 顺序和选项一致、不按人数排：每道题的图都长一个样，一眼能比
    rows: REACTIONS.map((item) => ({
      ...item,
      count: all[item.key] ?? 0,
      width: `${((all[item.key] ?? 0) / max) * 100}%`,
    })),
  }
})
</script>

<template>
  <section
    class="reaction"
    :style="{
      '--accent': theme.primaryColor,
      '--border': theme.borderColor,
      '--card': theme.cardColor,
      '--hover': theme.hoverColor,
    }"
    aria-label="题目点评"
  >
    <n-empty v-if="state === 'anonymous'" description="登录之后才能点评" />

    <n-flex v-else-if="state === 'loading'" justify="center" class="pad">
      <n-spin size="small" />
    </n-flex>

    <n-empty v-else-if="state === 'failed'" description="点评暂时读不出来，过一会儿再打开看看" />

    <n-empty
      v-else-if="state === 'locked'"
      description="做对之后才能点评。评完就能看到大家是怎么觉得的"
    />

    <template v-else-if="state === 'choose'">
      <p class="hint">选一个最接近的，<b>每道题只能评一次</b>。选完就能看到大家是怎么选的</p>
      <div class="options" :class="{ waiting: !ready }" role="group" aria-label="题目点评的选项">
        <button
          v-for="item in REACTIONS"
          :key="item.key"
          type="button"
          class="option"
          :class="{ picking: submitting === item.key }"
          :disabled="!!submitting"
          :aria-busy="submitting === item.key"
          @click="onOptionClick(item.key, $event)"
        >
          <span class="option-icon" aria-hidden="true">
            <n-spin v-if="submitting === item.key" :size="28" />
            <Icon v-else :icon="item.icon" />
          </span>
          <span class="option-label">{{ item.label }}</span>
        </button>
      </div>
      <n-text v-if="submitFailed" type="error" class="error">没记上，再点一次</n-text>
    </template>

    <template v-else-if="results">
      <p class="hint">
        你选了<b>「{{ results.mineLabel }}」</b> · 一共 {{ results.total }} 人点评过这道题
      </p>
      <ul class="bars">
        <li
          v-for="row in results.rows"
          :key="row.key"
          class="bar-row"
          :class="{ mine: row.key === mine }"
        >
          <span class="bar-icon" aria-hidden="true"><Icon :icon="row.icon" /></span>
          <span class="bar-label">{{ row.label }}</span>
          <span class="bar-track"><span class="bar-fill" :style="{ width: row.width }" /></span>
          <span class="bar-count">{{ row.count }} 人</span>
        </li>
      </ul>
      <slot name="after" />
    </template>
  </section>
</template>

<style scoped>
.reaction {
  max-width: 560px;
  margin: 0 auto;
}

.pad {
  padding: 32px 0;
}

.hint {
  margin: 0 0 14px;
  font-size: 14px;
  opacity: 0.8;
}

.options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  transition: opacity 0.25s;
}

/* 防误触那 600ms：看得出是「还没好」，而不是坏了 */
.options.waiting {
  opacity: 0.45;
  pointer-events: none;
}

.option {
  /* 一行 4 个，7 个排成 4 + 3，第二行居中 */
  flex: 0 0 calc((100% - 30px) / 4);
  min-width: 0;
  height: 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background-color: var(--card);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    transform 0.15s;
}

.option:hover:not(:disabled) {
  border-color: var(--accent);
  background-color: var(--hover);
  transform: translateY(-2px);
}

.option:disabled {
  cursor: default;
  opacity: 0.55;
}

.option.picking {
  opacity: 1;
  border-color: var(--accent);
}

.option-icon {
  display: flex;
  font-size: 34px;
  line-height: 1;
}

.option-label {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}

.error {
  display: block;
  margin-top: 10px;
  text-align: center;
}

.bars {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar-row {
  display: grid;
  grid-template-columns: 24px 4.5em 1fr 3.5em;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 14px;
}

.bar-row.mine {
  background-color: var(--hover);
  box-shadow: inset 3px 0 0 var(--accent);
  font-weight: 600;
}

.bar-icon {
  display: flex;
  font-size: 20px;
}

.bar-track {
  height: 10px;
  border-radius: 5px;
  background-color: rgba(128, 128, 128, 0.14);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: 5px;
  background-color: rgba(128, 128, 128, 0.45);
}

.bar-row.mine .bar-fill {
  background-color: var(--accent);
}

.bar-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
