<script setup lang="ts">
import { useChallengeStore } from "oj/store/challenge"
import { useChallengeTone } from "../composables/challengeTone"
import ChallengeIcon from "./ChallengeIcon.vue"

/**
 * 挑战中：编辑器顶上一条紫色的，写着要求和全站几人做到，随时「不挑战了」（设计稿 StkDoing）。
 * 做到了换成「挑战成功」，留着让学生看一眼自己是照什么要求写的，再「回到普通模式」
 */
const challengeStore = useChallengeStore()
const tone = useChallengeTone()
const active = computed(() => challengeStore.active)
const done = computed(() => !!active.value?.mine)
</script>

<template>
  <div v-if="active" class="challenge-bar">
    <span class="pill">
      <svg
        v-if="done"
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
      <ChallengeIcon v-else />
      {{ done ? "挑战成功" : "挑战" }}
    </span>
    <b class="wording">{{ active.wording }}</b>
    <span class="spacer" />
    <span v-if="!done" class="meta">{{ active.doneCount }} 人做到</span>
    <button type="button" class="quit" @click="challengeStore.stop()">
      {{ done ? "回到普通模式" : "不挑战了" }}
    </button>
  </div>
</template>

<style scoped>
.challenge-bar {
  height: 44px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: v-bind("tone.soft");
  border-bottom: 1px solid v-bind("tone.border");
  white-space: nowrap;
  min-width: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  background-color: v-bind("tone.solid");
  color: v-bind("tone.onSolid");
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.wording {
  font-size: 15px;
  color: v-bind("tone.text");
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spacer {
  flex-grow: 1;
}

.meta {
  font-size: 13px;
  opacity: 0.75;
}

.quit {
  height: 28px;
  padding: 0 10px;
  border: 1px solid v-bind("tone.border");
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("tone.text");
  cursor: pointer;
  flex-shrink: 0;
}

/* 手机上一行放不下：说法最要紧，让它折行，人数不写了 */
@media (max-width: 768px) {
  .challenge-bar {
    height: auto;
    min-height: 44px;
    padding: 6px 12px;
    white-space: normal;
  }

  .wording {
    flex: 1 1 0;
  }

  .spacer,
  .meta {
    display: none;
  }
}

.quit:focus-visible {
  outline: 2px solid v-bind("tone.solid");
  outline-offset: 2px;
}
</style>
