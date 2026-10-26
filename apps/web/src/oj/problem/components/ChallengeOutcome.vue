<script setup lang="ts">
import type { AstResultInfo } from "@oj2/contract"
import { useChallengeStore } from "oj/store/challenge"
import { clearChallengeLines, showChallengeLines } from "oj/problem/utils/errorMark"
import { useChallengeTone } from "../composables/challengeTone"
import ChallengeIcon from "./ChallengeIcon.vue"

/**
 * 挑战中交的这一次，挑战成没成（设计稿 StkFail / StkPass）。答案本身是对的 —— 没做到挑战
 * 也照样算做对，所以没做到时大字写「答案对了，挑战还差一点」，不是错误的红色。
 */
const props = defineProps<{
  passed: boolean
  results: AstResultInfo[]
  wording: string
}>()

const challengeStore = useChallengeStore()
const tone = useChallengeTone()

const failed = computed(() => props.results.filter((result) => !result.passed))

/** 「print() 至多调用 1 次，现在 3 次」 */
const reason = computed(() =>
  failed.value
    .map((result) =>
      result.actual !== undefined
        ? `${result.description}，现在 ${result.actual} 次`
        : result.description,
    )
    .join("；"),
)

const lines = computed(() => [...new Set(failed.value.flatMap((result) => result.lines ?? []))])

// 编辑器里把那几行标紫。做到了、换了一次提交就清掉
watch(
  () => (props.passed ? [] : lines.value),
  (value) => (value.length ? showChallengeLines(value) : clearChallengeLines()),
  { immediate: true },
)
onUnmounted(clearChallengeLines)

/** 做到了：本班、全站第几个。刚判完那一刻列表还没重拉，先不显示 */
const mine = computed(() => (props.passed ? (challengeStore.active?.mine ?? null) : null))
</script>

<template>
  <div class="challenge-outcome">
    <div class="line">
      <span class="badge" :class="{ outline: !passed }" aria-hidden="true">
        <ChallengeIcon :size="18" />
      </span>
      <div class="text">
        <b class="title">{{ passed ? "挑战成功" : "答案对了，挑战还差一点" }}</b>
        <span class="sub">{{ passed ? wording : reason }}</span>
      </div>
    </div>
    <div v-if="!passed" class="chips">
      <span class="chip ok">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        测试点全对
      </span>
      <span v-if="lines.length" class="chip mark">第 {{ lines.join("、") }} 行</span>
    </div>
    <div v-if="mine" class="tiles">
      <div v-if="mine.classRank !== null" class="tile">
        <b>第 {{ mine.classRank }} 个</b>
        <span>本班做到的</span>
      </div>
      <div class="tile">
        <b>第 {{ mine.siteRank }} 个</b>
        <span>全站做到的</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.challenge-outcome {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex-shrink: 0;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: v-bind("tone.solid");
  color: v-bind("tone.onSolid");
}

.badge.outline {
  background-color: transparent;
  border: 2px solid v-bind("tone.solid");
  color: v-bind("tone.solid");
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  font-size: 22px;
  line-height: 28px;
  color: v-bind("tone.text");
}

.sub {
  font-size: 14px;
  opacity: 0.75;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border-radius: 13px;
  font-size: 13px;
}

.chip.ok {
  background-color: rgba(24, 160, 88, 0.12);
  color: #18a058;
}

.chip.mark {
  background-color: v-bind("tone.soft");
  color: v-bind("tone.text");
  font-weight: 600;
}

.tiles {
  display: flex;
  gap: 10px;
}

.tile {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid v-bind("tone.border");
  background-color: v-bind("tone.soft");
}

.tile b {
  font-size: 24px;
  line-height: 30px;
  font-variant-numeric: tabular-nums;
  color: v-bind("tone.text");
}

.tile span {
  font-size: 13px;
  opacity: 0.75;
}
</style>
