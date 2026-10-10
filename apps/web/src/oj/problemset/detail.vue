<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { useThemeVars } from "naive-ui"
import { getProblemSetDetail, getProblemSetProblems, joinProblemSet } from "oj/api"
import { useTone } from "oj/submission/composables/tone"
import { errorMessage } from "utils/api"
import { parseTime } from "utils/functions"
import type { ProblemSet, ProblemSetProblem } from "utils/types"
import { useAuthModalStore } from "shared/store/authModal"
import { useUserStore } from "shared/store/user"
import { useFireworks } from "../problem/composables/useFireworks"
import BadgeLadder from "./components/BadgeLadder.vue"
import ClassView from "./components/ClassView.vue"

/**
 * 题单详情（设计稿「题单重设计」详情 B）：顶上一条是进度和奖章阶梯，下面题目分两列。
 *
 * - 还没加入：题目看得见、点不进去，右边一个大按钮「加入题单，开始做」。加入是用户要留的
 *   一步（「只是打开就算加入的话，会有疑惑的」），所以这里要让人一眼看懂为什么要点。
 * - 布置期内以前做对过的题标「以前做对过 · 旧代码先藏着」，规则见后端 problemSetLockCutoffs。
 * - 做完了：整条变绿，写几点做完、用了多久。烟花只在做完的那一刻放（做对最后一道、
 *   1.5 秒后跳回来的那一下），以后再打开不放。
 * - 老师多一个「全班情况」页签。
 */
const route = useRoute()
const router = useRouter()
const message = useMessage()
const theme = useThemeVars()
const tone = useTone()
const userStore = useUserStore()
const authStore = useAuthModalStore()
const { celebrate } = useFireworks()

const id = computed(() => Number(route.params.problemSetId))
const set = ref<ProblemSet | null>(null)
const problems = ref<ProblemSetProblem[]>([])
const missing = ref(false)
const joining = ref(false)
const tab = useRouteQuery<string>("tab", "problems")

async function load() {
  missing.value = false
  try {
    const [detail, list] = await Promise.all([
      getProblemSetDetail(id.value),
      getProblemSetProblems(id.value),
    ])
    set.value = detail
    problems.value = list
  } catch {
    missing.value = true
    return
  }
  const done = set.value.userProgress.completeTime
  if (set.value.userProgress.isCompleted && done && Date.now() - Date.parse(done) < 60_000) {
    celebrate()
  }
}

watch(id, load)
onMounted(load)

const progress = computed(() => set.value?.userProgress)
const joined = computed(() => !!progress.value?.isJoined)
/** 老师不用加入也能点进题目去看（不记进度），也不给他摆「加入」按钮 */
const canOpen = computed(() => joined.value || userStore.isTeacherOrAbove)
const optional = computed(() => (set.value ? set.value.problemsCount - set.value.requiredCount : 0))
const percent = computed(() =>
  set.value && progress.value?.isJoined && set.value.requiredCount
    ? Math.min(100, (progress.value.completedCount / set.value.requiredCount) * 100)
    : 0,
)
const hiddenCount = computed(() => problems.value.filter((item) => item.oldCodeHidden).length)

/** 做完用了多久：从加入到做完 */
const spent = computed(() => {
  const p = progress.value
  if (!p?.joinTime || !p.completeTime) return ""
  const minutes = Math.round((Date.parse(p.completeTime) - Date.parse(p.joinTime)) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / 1440)} 天`
})

const columns = computed(() => {
  const half = Math.ceil(problems.value.length / 2)
  return [problems.value.slice(0, half), problems.value.slice(half)].filter((col) => col.length)
})

function indexOf(item: ProblemSetProblem) {
  return problems.value.indexOf(item) + 1
}

function solvedAt(time: string) {
  const today = parseTime(new Date(), "YYYY-MM-DD") === parseTime(time, "YYYY-MM-DD")
  return parseTime(time, today ? "HH:mm" : "M月D日")
}

function problemLink(item: ProblemSetProblem) {
  return {
    name: "problemset problem",
    params: { problemSetId: id.value, problemID: item.problem._id },
  }
}

async function join() {
  if (!userStore.isAuthed) {
    authStore.openLoginModal()
    return
  }
  if (joining.value) return
  joining.value = true
  try {
    await joinProblemSet(id.value)
    message.success("加入了，现在开始在这里做对的题都会记进度")
    await load()
  } catch (err) {
    message.error(errorMessage(err, "加入失败"))
  } finally {
    joining.value = false
  }
}

/** 编辑只给出题人和超管（后台按归属校验，别人点进去是 404） */
const canEdit = computed(
  () => !!set.value && (userStore.isSuperAdmin || set.value.createdBy.id === userStore.user?.id),
)

const info = computed(() => tone("info"))
const success = computed(() => tone("success"))
const warning = computed(() => tone("warning"))
const purple = { color: "#5b3fa8", background: "rgba(122, 95, 208, 0.12)" }
</script>

<template>
  <n-result
    v-if="missing"
    status="404"
    title="题单不存在"
    description="可能还没公开，或者已经删掉了"
  >
    <template #footer>
      <n-button @click="router.push({ name: 'problemsets' })">回到题单列表</n-button>
    </template>
  </n-result>

  <div v-else-if="set" class="page oj-page">
    <section class="band" :class="{ done: progress?.isCompleted }">
      <span v-if="progress?.isCompleted" class="done-mark" aria-hidden="true">✓</span>
      <div class="head">
        <div class="row">
          <router-link :to="{ name: 'problemsets' }" class="muted back">‹ 题单</router-link>
          <h2 class="ell">{{ set.title }}</h2>
          <span v-if="set.assigning" class="pill assign"
            >布置到 {{ parseTime(set.assignedUntil!, "M月D日") }}</span
          >
        </div>
        <template v-if="progress?.isCompleted">
          <div class="done-text">
            <b>全部做完了</b> · {{ parseTime(progress.completeTime!, "M月D日 HH:mm") }}
            <template v-if="spent">，加入后用了 {{ spent }}</template>
          </div>
        </template>
        <template v-else-if="joined">
          <div class="row baseline">
            <span class="muted small">做对</span>
            <span class="num count">{{ progress!.completedCount }}</span>
            <span class="muted num">/ {{ set.requiredCount }} 道</span>
            <span class="muted tiny gap">
              <template v-if="optional > 0">另有 {{ optional }} 道选做 · </template>
              {{ parseTime(progress!.joinTime!, "M月D日 HH:mm") }} 加入
            </span>
          </div>
          <div class="bar"><div class="fill" :style="{ width: `${percent}%` }"></div></div>
        </template>
        <div v-else class="muted small">
          {{ set.createdBy.username }} 出的 · {{ set.problemsCount }} 道<template
            v-if="optional > 0"
            >，{{ optional }} 道选做</template
          ><template v-else>，全部必做</template>
          <template v-if="!set.badges.length"> · 这个题单没有奖章</template>
        </div>
        <div v-if="set.description && set.description !== set.title" class="sec small desc">
          {{ set.description }}
        </div>
      </div>
      <template v-if="set.badges.length">
        <span class="divider"></span>
        <div class="ladder-box"><BadgeLadder :set="set" /></div>
      </template>
      <div class="spacer"></div>
      <div v-if="!joined && !userStore.isTeacherOrAbove" class="join">
        <n-button type="primary" size="large" :loading="joining" @click="join">
          加入题单，开始做
        </n-button>
        <span class="muted tiny">加入以后，在题单里做对的题才算进度</span>
      </div>
    </section>

    <div v-if="!joined && hiddenCount" class="notice" :style="purple">
      <svg
        class="lock"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      其中 <b>{{ hiddenCount }}</b> 道你以前做对过。布置期内（到
      {{
        parseTime(set.assignedUntil!, "M月D日")
      }}）这几道的旧代码先藏起来，在题单里重新做对就能看。
    </div>

    <div v-if="userStore.isTeacherOrAbove" class="tabs">
      <button class="seg" :class="{ on: tab !== 'class' }" @click="tab = 'problems'">题目</button>
      <button class="seg" :class="{ on: tab === 'class' }" @click="tab = 'class'">全班情况</button>
      <div class="spacer"></div>
      <n-button
        v-if="canEdit"
        size="small"
        @click="router.push({ name: 'admin problemset edit', params: { problemSetId: set.id } })"
      >
        编辑题单
      </n-button>
    </div>

    <ClassView v-if="userStore.isTeacherOrAbove && tab === 'class'" :problem-set-id="set.id" />

    <template v-else>
      <div v-if="problems.length" class="cols">
        <section v-for="(col, ci) in columns" :key="ci" class="card list">
          <component
            :is="canOpen ? 'router-link' : 'div'"
            v-for="item in col"
            :key="item.id"
            :to="canOpen ? problemLink(item) : undefined"
            class="prow"
            :class="{ off: !canOpen }"
          >
            <span v-if="item.isCompleted" class="dot done-dot">✓</span>
            <span v-else-if="item.wrongCount" class="dot tried-dot">!</span>
            <span v-else class="dot empty-dot"></span>
            <span class="muted num idx">{{ indexOf(item) }}</span>
            <span class="ell ptitle">{{ item.problem.title }}</span>
            <span v-if="!item.isRequired" class="opt">选做</span>
            <span
              v-if="item.oldCodeHidden"
              class="old"
              :style="purple"
              title="以前做对过，旧代码在布置期内先藏着"
              ><svg
                class="lock"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg
              ><span class="old-long">以前做对过 · 旧代码先藏着</span
              ><span class="old-short">做对过</span></span
            >
            <div class="spacer"></div>
            <span v-if="item.isCompleted && item.solvedTime" class="muted num tiny"
              >{{ solvedAt(item.solvedTime) }} 做对</span
            >
            <span v-else-if="item.wrongCount && joined" class="tiny tried"
              >交过 {{ item.wrongCount }} 次</span
            >
            <span v-else-if="canOpen" class="go">去做 ›</span>
          </component>
        </section>
      </div>
      <n-empty v-else description="这个题单还没有题目" />
      <div v-if="joined && problems.length" class="muted tiny foot">做对一道会自动回到这里</div>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
}

.band {
  box-sizing: border-box;
  padding: 22px 24px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px 20px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.band.done {
  background: v-bind("success.background");
  border-color: transparent;
}

.done-mark {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
  background: v-bind("theme.successColor");
  color: #ffffff;
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.done-text {
  font-size: var(--oj-fs-body);
  color: v-bind("success.color");
}

.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 360px;
  max-width: 100%;
  min-width: 0;
}

.head h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.desc {
  line-height: 1.5;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.row.baseline {
  align-items: baseline;
  gap: 6px;
}

.back {
  flex-shrink: 0;
  font-size: var(--oj-fs-sec);
  text-decoration: none;
}

.count {
  font-size: 28px;
  font-weight: 700;
}

.gap {
  margin-left: 6px;
}

.bar {
  height: 8px;
  border-radius: 4px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.fill {
  height: 100%;
  background: v-bind("theme.successColor");
}

.divider {
  width: 1px;
  align-self: stretch;
  background: v-bind("theme.dividerColor");
}

/* 窄屏时阶梯要能横向滚，可 overflow-x 一设，纵向也跟着被裁：下一个奖章的金圈画在图标外 2px，
   上沿会被切掉一条。上下留出几像素给它 */
.ladder-box {
  max-width: 100%;
  overflow-x: auto;
  padding: 4px 2px;
}

.join {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.lock {
  flex-shrink: 0;
  vertical-align: -1px;
}

.old .lock {
  margin-right: 3px;
}

/* 手机上长文案会把题目名挤得只剩一两个字，换成短的；锁的图标还在，全文在悬停提示里 */
.old-short {
  display: none;
}

.notice {
  box-sizing: border-box;
  padding: 12px 18px;
  border-radius: var(--oj-radius);
  font-size: var(--oj-fs-sec);
}

.tabs {
  display: flex;
  align-items: center;
}

.seg {
  height: var(--oj-ctrl-h);
  padding: 0 16px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.seg:first-child {
  border-radius: 4px 0 0 4px;
}

.seg + .seg {
  border-left: none;
  border-radius: 0 4px 4px 0;
}

.seg.on {
  color: v-bind("success.color");
  background: v-bind("success.background");
  font-weight: 600;
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 16px;
  align-items: start;
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
  overflow: hidden;
}

.list {
  display: flex;
  flex-direction: column;
}

.prow {
  height: var(--oj-row-h);
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.prow:last-child {
  border-bottom: none;
}

a.prow:hover {
  background: v-bind("theme.hoverColor");
}

.prow.off {
  color: v-bind("theme.textColor3");
}

.dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.done-dot {
  background: v-bind("theme.successColor");
  color: #ffffff;
}

.tried-dot {
  background: v-bind("warning.background");
  color: v-bind("warning.color");
}

.empty-dot {
  border: 1.5px dashed v-bind("theme.borderColor");
}

.idx {
  width: 20px;
  text-align: right;
  font-size: var(--oj-fs-sec);
  flex-shrink: 0;
}

.ptitle {
  font-size: var(--oj-fs-body);
}

.opt {
  height: 22px;
  padding: 0 7px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  border: 1px solid v-bind("theme.borderColor");
  color: v-bind("theme.textColor3");
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.old {
  height: 22px;
  padding: 0 7px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.tried {
  color: v-bind("warning.color");
}

.go {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.primaryColor");
  flex-shrink: 0;
}

.foot {
  text-align: center;
}

.pill {
  height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.assign {
  color: v-bind("info.color");
  background: v-bind("info.background");
}

.spacer {
  flex-grow: 1;
}

.muted {
  color: v-bind("theme.textColor3");
}

.sec {
  color: v-bind("theme.textColor2");
}

.small {
  font-size: var(--oj-fs-sec);
}

.tiny {
  font-size: var(--oj-fs-meta);
}

.num {
  font-variant-numeric: tabular-nums;
}

.ell {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 640px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }

  .band {
    padding: 16px;
  }

  .prow {
    padding: 0 12px;
    gap: 10px;
  }

  .head {
    width: 100%;
  }

  .divider {
    display: none;
  }

  .join {
    align-items: stretch;
    width: 100%;
  }

  .old-long {
    display: none;
  }

  .old-short {
    display: inline;
  }
}
</style>
