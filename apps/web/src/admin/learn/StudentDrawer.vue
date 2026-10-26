<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import { getLearnStudent } from 'admin/api'
import { parseTime, readableDuration } from 'utils/functions'
import type { LearnStudentDetail } from 'utils/types'
import UserName from 'shared/components/UserName.vue'
import { useBackClose } from 'shared/composables/backClose'
import { useBreakpoints } from 'shared/composables/breakpoints'
import { splitTitle, type TutorialType } from 'oj/learn/lesson'
import { EXERCISE_KIND } from './kinds'

/**
 * 一个学生的自学明细：点方块格里的名字从右边滑出来。
 *
 * 一课一段，标题行后面一串小方块是这课的每道练一练（绿 = 做对，红 = 做过还没对，
 * 灰 = 没做）；有没做对的课默认展开，逐题写着第几次做对、最后错在哪，下面接着这课的
 * 配套题做没做对（不论早晚，读这课之前做对的也算）。
 */
const router = useRouter()
const props = defineProps<{
  userId: number | null
  type: TutorialType
  /** 课 id → 第几课，跟方块格表头的编号一致 */
  steps: Map<number, number>
}>()
const show = defineModel<boolean>('show', { required: true })

const theme = useThemeVars()
const { isDesktop } = useBreakpoints()
useBackClose(show, () => !isDesktop.value)

type Lesson = LearnStudentDetail['lessons'][number]
type Exercise = Lesson['exercises'][number]
type Problem = Lesson['problems'][number]

const detail = ref<LearnStudentDetail | null>(null)
const loading = ref(false)
const expanded = ref(new Set<number>())

const summary = computed(() => {
  const lessons = detail.value?.lessons ?? []
  const exercises = lessons.flatMap((lesson) => lesson.exercises)
  // 一道题挂在两课只算一次
  const problems = new Map(lessons.flatMap((lesson) => lesson.problems).map((p) => [p.id, p]))
  return {
    problemSolved: [...problems.values()].filter((p) => p.solved).length,
    problemTotal: problems.size,
    opened: lessons.filter((lesson) => lesson.viewCount > 0).length,
    seconds: lessons.reduce((n, lesson) => n + lesson.totalSeconds, 0),
    solved: exercises.filter((ex) => ex.solved).length,
    total: exercises.length,
  }
})

function solvedOf(lesson: Lesson) {
  return lesson.exercises.filter((ex) => ex.solved).length
}

function stateOf(ex: Exercise) {
  if (ex.solved) return 'solved'
  return ex.attempts > 0 ? 'wrong' : 'todo'
}

function problemStateOf(problem: Problem) {
  if (problem.solved) return 'solved'
  return problem.submissions > 0 ? 'wrong' : 'todo'
}

/** 提交列表按这个人、这道题筛好，新标签页打开 */
function submissionsHref(problem: Problem) {
  return router.resolve({
    path: '/submission',
    query: { problem: problem.displayId, username: detail.value?.username, exactUsername: '1' },
  }).href
}

function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

watch(
  () => [show.value, props.userId, props.type] as const,
  async ([open, userId, type]) => {
    if (!open || !userId) return
    if (detail.value?.userId !== userId) detail.value = null
    loading.value = true
    try {
      const data = await getLearnStudent(userId, { type })
      detail.value = data
      expanded.value = new Set(
        data.lessons
          .filter(
            (lesson) =>
              (lesson.exercises.some((ex) => ex.attempts > 0) && lesson.exercises.some((ex) => !ex.solved)) ||
              lesson.problems.some((p) => p.submissions > 0 && !p.solved),
          )
          .map((lesson) => lesson.tutorialId),
      )
    } catch {
      detail.value = null
    } finally {
      loading.value = false
    }
  },
)
</script>

<template>
  <n-drawer v-model:show="show" :width="isDesktop ? 520 : '100%'" placement="right">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div v-if="detail" class="head">
          <UserName :username="detail.username" class="head-name" />
          <span class="muted small num">
            打开过 {{ summary.opened }} 课
            <template v-if="summary.seconds"> · 停留 {{ readableDuration(summary.seconds) }}</template>
            <template v-if="summary.total"> · 练一练 {{ summary.solved }}/{{ summary.total }}</template>
            <template v-if="summary.problemTotal"> · 配套题 {{ summary.problemSolved }}/{{ summary.problemTotal }}</template>
          </span>
        </div>
        <span v-else>自学明细</span>
      </template>

      <!-- 抽屉是传送出去的，scoped CSS 里的 v-bind() 够不着，颜色挂在这层 style 上 -->
      <n-spin
        :show="loading"
        :style="{
          '--ok': theme.successColor,
          '--bad': theme.errorColor,
        }"
      >
        <div v-if="detail && !detail.lessons.length" class="muted none">还没打开过</div>
        <div v-for="lesson in detail?.lessons ?? []" :key="lesson.tutorialId" class="lesson">
          <button type="button" class="lesson-head" @click="toggle(lesson.tutorialId)">
            <span class="lesson-line">
              <span class="lesson-title">
                <span class="muted num">第 {{ steps.get(lesson.tutorialId) }} 课</span>
                {{ splitTitle(lesson.title).kp }}
              </span>
              <span class="grow" />
              <span v-if="lesson.exercises.length" class="small num"> {{ solvedOf(lesson) }}/{{ lesson.exercises.length }} </span>
              <span class="squares">
                <span v-for="ex in lesson.exercises" :key="ex.exerciseId" class="square" :class="stateOf(ex)" />
              </span>
              <Icon
                v-if="lesson.exercises.length || lesson.problems.length"
                :icon="expanded.has(lesson.tutorialId) ? 'ph:caret-down-bold' : 'ph:caret-right-bold'"
                :width="12"
                class="muted"
              />
            </span>
            <span class="lesson-line small muted num">
              <template v-if="lesson.viewCount">
                打开 {{ lesson.viewCount }} 次
                <template v-if="lesson.totalSeconds"> · 停留 {{ readableDuration(lesson.totalSeconds) }}</template>
                <template v-if="lesson.lastViewedAt"> · {{ parseTime(lesson.lastViewedAt, 'M月D日 HH:mm') }}</template>
              </template>
              <template v-else>没打开过，直接做的练一练</template>
              <template v-if="!lesson.exercises.length"> · 这课没有练一练</template>
              <template v-if="lesson.problems.length"> · 配套题 {{ lesson.problems.filter((p) => p.solved).length }}/{{ lesson.problems.length }}</template>
            </span>
          </button>

          <div v-if="expanded.has(lesson.tutorialId) && (lesson.exercises.length || lesson.problems.length)" class="ex-list">
            <div v-for="ex in lesson.exercises" :key="ex.exerciseId" class="ex">
              <span class="square" :class="stateOf(ex)" />
              <div class="ex-body">
                <div class="ex-question">
                  <span class="kind">{{ EXERCISE_KIND[ex.type] ?? ex.type }}</span>
                  {{ ex.question || '（没有题干）' }}
                </div>
                <div class="small num">
                  <span v-if="ex.solved" class="ok">做对了（第 {{ ex.attemptsToSolve }} 次）</span>
                  <template v-else-if="ex.attempts > 0">
                    <span class="bad">还没做对，交了 {{ ex.attempts }} 次</span>
                  </template>
                  <span v-else class="muted">没做</span>
                  <span v-if="ex.lastWrongAnswer" class="muted"> · 最后错在 {{ ex.lastWrongAnswer }}</span>
                </div>
              </div>
            </div>
            <div v-if="lesson.problems.length" class="sub-head small muted">配套题</div>
            <div v-for="problem in lesson.problems" :key="problem.id" class="ex">
              <span class="square" :class="problemStateOf(problem)" />
              <div class="ex-body">
                <div class="ex-question">
                  <span class="kind num">{{ problem.displayId }}</span>
                  {{ problem.title }}
                </div>
                <div class="small num">
                  <span v-if="problem.solved" class="ok">做对了</span>
                  <span v-else-if="problem.submissions" class="bad">交了 {{ problem.submissions }} 次还没对</span>
                  <span v-else class="muted">没交</span>
                  <template v-if="problem.lastSubmitAt">
                    <span class="muted"> · {{ parseTime(problem.lastSubmitAt, 'YYYY年M月D日') }} · </span>
                    <a :href="submissionsHref(problem)" target="_blank" class="link">看提交</a>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.head-name {
  font-size: 18px;
}
.muted {
  opacity: 0.6;
}
.small {
  font-size: 12px;
}
.num {
  font-variant-numeric: tabular-nums;
}
.grow {
  flex: 1;
}
.none {
  padding: 24px 0;
  text-align: center;
}
.lesson {
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}
.lesson:first-child {
  border-top: 0;
}
.lesson-head {
  width: 100%;
  padding: 12px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}
.lesson-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.lesson-title {
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.squares {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}
.square {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  background: rgba(128, 128, 128, 0.18);
}
.square.solved {
  background: #18a058;
}
.square.wrong {
  background: var(--bad);
}
.ex-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 0 14px;
}
.ex {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.ex .square {
  margin-top: 4px;
}
.ex-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ex-question {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.kind {
  height: 20px;
  padding: 0 6px;
  margin-right: 4px;
  border-radius: 3px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  background: rgba(128, 128, 128, 0.12);
}
.ok {
  color: var(--ok);
}
.sub-head {
  margin-top: 4px;
}
.link {
  color: #18a058;
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.bad {
  color: var(--bad);
}
</style>
