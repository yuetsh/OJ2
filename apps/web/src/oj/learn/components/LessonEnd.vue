<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { TutorialProblem } from "@oj2/contract"
import { splitTitle, type LessonState, type ProjectGroup } from "../lesson"
import SegBar from "./SegBar.vue"

/**
 * 一课的结尾（设计稿「一课的结尾」）：练一练做到几道 → 全对就是「第 N 课学完了」→
 * 老师挑的几道题 → 下一课。练一练没做完时下一课按钮是次要样式，不拦着。
 */
const props = defineProps<{
  step: number
  total: number
  courseLabel: string
  exerciseCount: number
  solvedCount: number
  /** 第一道还没做对的练一练，点了跳回去 */
  firstUnsolved: { id: number; index: number } | null
  problems: TutorialProblem[]
  next: { title: string; to: string } | null
  groups: ProjectGroup[]
  stateOf: (id: number) => LessonState
  doneCount: number
  /** 窄屏：进度条短一点、题号挪到题目名下面 */
  compact?: boolean
}>()
const emit = defineEmits<{ jump: [exerciseId: number] }>()

const finished = computed(() => props.exerciseCount > 0 && props.solvedCount >= props.exerciseCount)
const nextParts = computed(() => (props.next ? splitTitle(props.next.title) : null))
</script>

<template>
  <div class="end">
    <section v-if="finished" class="banner">
      <span class="check"><Icon icon="ph:check-bold" :width="compact ? 22 : 24" /></span>
      <div class="banner-text">
        <span class="banner-title">第 {{ step }} 课学完了</span>
        <div class="banner-progress">
          <SegBar
            :groups="groups"
            :state-of="stateOf"
            :width="compact ? 8 : 13"
            :height="compact ? 5 : 6"
            :gap="compact ? 2 : 3"
            :group-gap="compact ? 5 : 8"
          />
          <span class="muted num"
            >{{ compact ? "" : `${courseLabel} 学完 ` }}{{ doneCount }} / {{ total
            }}{{ compact ? "" : " 课" }}</span
          >
        </div>
      </div>
    </section>
    <section v-else-if="exerciseCount" class="card practice">
      <span class="strong">练一练</span>
      <span class="num">{{ solvedCount }} / {{ exerciseCount }}</span>
      <span class="boxes">
        <span v-for="n in exerciseCount" :key="n" class="box" :class="{ on: n <= solvedCount }" />
      </span>
      <span class="grow" />
      <a v-if="firstUnsolved" href="#" class="link" @click.prevent="emit('jump', firstUnsolved.id)">
        <Icon icon="ph:arrow-up-bold" :width="14" />第 {{ firstUnsolved.index }} 道还没做对
      </a>
    </section>

    <section v-if="problems.length" class="card problems">
      <div class="problems-head strong">去做几道题</div>
      <router-link
        v-for="problem in problems"
        :key="problem.id"
        :to="`/problem/${problem.displayId}`"
        class="problem"
      >
        <span v-if="!compact" class="pid num">{{ problem.displayId }}</span>
        <span class="ptitle">
          <span class="ellipsis">{{ problem.title }}</span>
          <span v-if="compact" class="sub">
            <span class="num muted">{{ problem.displayId }}</span>
            <span v-if="problem.mustDo" class="must">必会</span>
          </span>
        </span>
        <span v-if="!compact && problem.mustDo" class="must">必会</span>
        <span v-if="problem.solved" class="solved"
          ><Icon icon="ph:check-bold" :width="13" />做对过</span
        >
        <span v-else class="go">去做<Icon icon="ph:caret-right-bold" :width="12" /></span>
      </router-link>
    </section>

    <section v-if="next && nextParts" class="card next">
      <div class="next-text">
        <div class="muted small">下一课 · 第 {{ step + 1 }} 课</div>
        <div class="next-title">
          <span class="next-kp">{{ nextParts.kp }}</span>
          <span v-if="nextParts.scene" class="muted">{{ nextParts.scene }}</span>
        </div>
      </div>
      <n-button
        :type="finished ? 'primary' : 'default'"
        size="large"
        icon-placement="right"
        tag="a"
        :href="next.to"
        @click.prevent="$router.push(next.to)"
      >
        下一课
        <template #icon><Icon icon="ph:caret-right-bold" /></template>
      </n-button>
    </section>
  </div>
</template>

<style scoped>
.end {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 28px 0 24px;
}
.card {
  border: 1px solid var(--learn-line);
  border-radius: 8px;
}
.strong {
  font-weight: 700;
  font-size: 15px;
}
.num {
  font-variant-numeric: tabular-nums;
}
.muted {
  opacity: 0.6;
}
.small {
  font-size: 12px;
}
.grow {
  flex: 1;
}
.banner {
  border: 1px solid var(--learn-green-line);
  background: var(--learn-green-bg);
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.check {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  flex-shrink: 0;
  background: var(--learn-green);
  color: #fff;
  display: grid;
  place-items: center;
}
.banner-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.banner-title {
  font-size: 19px;
  font-weight: 700;
}
.banner-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
}
.practice {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.boxes {
  display: flex;
  gap: 4px;
}
.box {
  width: 34px;
  height: 8px;
  border-radius: 4px;
  background: var(--learn-todo);
}
.box.on {
  background: var(--learn-green);
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--learn-green-text);
  text-decoration: none;
}
.problems {
  overflow: hidden;
}
.problems-head {
  height: 46px;
  padding: 0 16px;
  display: flex;
  align-items: center;
}
.problem {
  min-height: 48px;
  padding: 0 16px;
  border-top: 1px solid var(--learn-line);
  display: flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}
.problem:hover {
  background: var(--learn-soft);
}
.pid {
  width: 40px;
  font-size: 13px;
  opacity: 0.6;
}
.ptitle {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 14px;
  padding: 6px 0;
}
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.must {
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  background: var(--learn-orange-bg);
  color: var(--learn-orange-text);
  flex-shrink: 0;
}
.solved,
.go {
  width: 64px;
  justify-content: flex-end;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  font-weight: 600;
  color: var(--learn-green-text);
}
.next {
  padding: 16px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.next-text {
  flex: 1;
  min-width: 0;
}
.next-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.next-kp {
  font-size: 17px;
  font-weight: 700;
}
</style>
