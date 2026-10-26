<script setup lang="ts">
import type { ChallengeList } from '@oj2/contract'
import { getChallenges } from 'oj/api'
import { useChallengeStore } from 'oj/store/challenge'
import { useChallengeTone } from '../composables/challengeTone'
import ChallengeIcon from './ChallengeIcon.vue'

/**
 * 「还能挑战」：这几道题里我做对了、还没做到的挑战，一条一行，「去挑战」（设计稿 StkDone）。
 * 一条都没有就什么都不显示 —— 课堂题多是一两行，能出挑战的只是一部分。
 */
const props = defineProps<{
  problemIds: string[]
  language: string
  /** 变了就重拉：刚做对 / 刚做到一条挑战，列表里要去掉它 */
  refreshKey?: string
}>()

const challengeStore = useChallengeStore()
const tone = useChallengeTone()

const groups = ref<ChallengeList>([])
let sequence = 0
watch(
  () => [props.problemIds.join(','), props.language, props.refreshKey] as const,
  async () => {
    const mine = ++sequence
    if (!props.problemIds.length || !props.language) {
      groups.value = []
      return
    }
    try {
      const list = await getChallenges(props.problemIds, props.language)
      if (mine === sequence) groups.value = list
    } catch {
      if (mine === sequence) groups.value = []
    }
  },
  { immediate: true },
)

const rows = computed(() =>
  groups.value.flatMap((group) =>
    // 没做对的题不给接挑战：挑战是做对之后的事
    group.solved ? group.challenges.filter((challenge) => !challenge.mine).map((challenge) => ({ group, challenge })) : [],
  ),
)
</script>

<template>
  <section v-if="rows.length" class="challenge-list" aria-label="还能挑战">
    <div class="head">
      <span class="pill"><ChallengeIcon />挑战</span>
      <b>还能挑战</b>
    </div>
    <div v-for="({ group, challenge }, i) in rows" :key="challenge.id" class="row">
      <div class="text">
        <div class="problem">
          <b>{{ group.problemId }}</b> <span class="title">{{ group.title }}</span>
        </div>
        <b class="wording">{{ challenge.wording }}</b>
        <span class="stat"> {{ group.acCount }} 个做对的人里，{{ challenge.doneCount }} 人做到 </span>
      </div>
      <button type="button" class="go" :class="{ ghost: i > 0 }" @click="challengeStore.start(group.problemId, challenge.id)">
        去挑战
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  </section>
</template>

<style scoped>
.challenge-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  background-color: v-bind('tone.solid');
  color: v-bind('tone.onSolid');
  font-size: 13px;
  font-weight: 600;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 16px;
  padding: 12px 14px;
  border: 1px solid v-bind('tone.border');
  border-radius: 8px;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.problem {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title,
.stat {
  opacity: 0.7;
}

.stat {
  font-size: 13px;
}

.wording {
  font-size: 17px;
  line-height: 24px;
  color: v-bind('tone.text');
}

.go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border-radius: 6px;
  border: 1px solid v-bind('tone.solid');
  background-color: v-bind('tone.solid');
  color: v-bind('tone.onSolid');
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.go.ghost {
  background-color: transparent;
  color: v-bind('tone.text');
  border-color: v-bind('tone.border');
}

.go:focus-visible {
  outline: 2px solid v-bind('tone.solid');
  outline-offset: 2px;
}

/* 手机上按钮另起一行占满，好按 */
@media (max-width: 768px) {
  .row {
    grid-template-columns: minmax(0, 1fr);
  }

  .go {
    justify-content: center;
    height: 44px;
  }
}
</style>
