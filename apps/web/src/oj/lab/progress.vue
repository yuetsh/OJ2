<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { LabDetail, LabProgress, LabRunResult, LabStudentWork } from '@oj2/contract'
import CodeEditor from 'shared/components/CodeEditor.vue'
import UserName from 'shared/components/UserName.vue'
import { useConfigStore } from 'shared/store/config'
import { errorMessage } from 'utils/api'
import { groupClassOptions } from 'utils/classes'
import { parseTime } from 'utils/functions'
import { getLab, getLabProgress, getLabStudentWork, runLabStudentStep } from 'oj/api'
import LabOutputs from './components/LabOutputs.vue'
import LabVerdict from './components/LabVerdict.vue'
import { groupProgress, studentState, type ProgressGroup, type ProgressStudent } from './utils/progress'

/**
 * 老师看全班做到哪（画布 LabProgress）：顶上一条总览，左边按「卡在第几步」分组、同一步再按没过的
 * 原因细分，右边看一个学生每一步的时间、运行次数、代码和现跑出来的图。
 * 第一版不接课堂任务（设计文档第 2 节第 7 条），所以上课盯进度就靠这一页，10 秒刷新一次。
 */
const props = defineProps<{ labID: string }>()

const theme = useThemeVars()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const configStore = useConfigStore()

const labId = computed(() => Number(props.labID))
const lab = ref<LabDetail | null>(null)
const progress = ref<LabProgress | null>(null)
const className = ref<string | null>(typeof route.query.className === 'string' ? route.query.className : null)
const openGroups = ref(new Set<string>())
const selectedId = ref<number | null>(null)

const groups = computed(() => (progress.value ? groupProgress(progress.value) : []))
const total = computed(() => progress.value?.students.length ?? 0)

const classOptions = computed(() => {
  const list = [...(progress.value?.classes ?? []), ...(configStore.config?.classList ?? [])]
  return groupClassOptions(className.value ? [className.value, ...list] : list)
})

function groupTitle(g: ProgressGroup) {
  if (g.kind === 'done') return '全部做对'
  if (g.kind === 'idle') return '还没开始'
  return `卡在第 ${g.stepIndex! + 1} 步`
}

const BAR_COLORS = ['#f0a020', '#f6c76a', '#f8d99a', '#fbe8c4']
function barColor(g: ProgressGroup, i: number) {
  if (g.kind === 'done') return theme.value.primaryColor
  if (g.kind === 'idle') return theme.value.dividerColor
  return BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]!
}

async function load(first = false) {
  const data = await getLabProgress(labId.value, className.value)
  progress.value = data
  className.value = data.className
  if (first) {
    // 一进来展开人最多的那个「卡住」的组，选中里面第一个人
    const top = groups.value.find((g) => g.kind === 'stuck')
    if (top) {
      openGroups.value = new Set([top.key])
      select(top.reasons[0]?.students[0] ?? top.students[0]!)
    }
  }
}

function changeClass(value: string) {
  className.value = value
  router.replace({ query: { ...route.query, className: value } })
  selectedId.value = null
  load(true)
}

function toggleGroup(key: string) {
  const next = new Set(openGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openGroups.value = next
}

// ---------------------------------------------------------------- 右边：一个学生

const work = ref<LabStudentWork | null>(null)
const selectedStep = ref(0)
const stepResult = ref<LabRunResult | null>(null)
const running = ref(false)

const selected = computed(() => progress.value?.students.find((s) => s.id === selectedId.value) ?? null)
const selectedState = computed(() => (selected.value ? studentState(selected.value) : null))

async function select(student: ProgressStudent) {
  selectedId.value = student.id
  work.value = null
  stepResult.value = null
  const state = studentState(student)
  selectedStep.value = state.stepIndex ?? Math.max(0, student.steps.length - 1)
  work.value = await getLabStudentWork(labId.value, student.id)
  runSelected()
}

function pickStep(index: number) {
  selectedStep.value = index
  runSelected()
}

/** 拿学生存着的代码现跑（结果不存库）。没动过手的步骤不跑 */
async function runSelected() {
  const student = selected.value
  const cell = student?.steps[selectedStep.value]
  stepResult.value = null
  if (!student || !cell || (!cell.runs && !cell.passed)) return
  const stepId = progress.value!.steps[selectedStep.value]!.id
  running.value = true
  try {
    const result = await runLabStudentStep(labId.value, student.id, stepId)
    if (selectedId.value === student.id && progress.value!.steps[selectedStep.value]?.id === stepId) stepResult.value = result
  } catch (err) {
    message.error(errorMessage(err, '没跑起来'))
  } finally {
    running.value = false
  }
}

const shownCode = computed(() => {
  const w = work.value?.steps[selectedStep.value]
  if (!w) return null
  return (progress.value?.steps[selectedStep.value]?.kind === 'open' && w.openCode) || w.code
})
const selectedCodes = computed(() => (work.value?.steps ?? []).slice(0, selectedStep.value + 1).map((s) => s.code ?? ''))

function timeText(value: string | null) {
  return value ? parseTime(value, 'HH:mm') : ''
}

const lastRun = computed(() => {
  const times = (selected.value?.steps ?? []).map((c) => c.lastRunAt).filter((t): t is string => !!t)
  return times.sort().at(-1) ?? null
})

// 上课盯着看：页面在前台时 10 秒刷新一次
const { pause, resume } = useIntervalFn(() => {
  if (!document.hidden) load().catch(() => {})
}, 10_000)
useEventListener(document, 'visibilitychange', () => (document.hidden ? pause() : resume()))

onMounted(async () => {
  getLab(labId.value).then((data) => (lab.value = data))
  try {
    await load(true)
  } catch (err) {
    message.error(errorMessage(err, '打不开'))
  }
})
</script>

<template>
  <div class="progressPage">
    <div class="topRow">
      <router-link :to="{ name: 'lab', params: { labID } }" class="back"> <Icon icon="ph:caret-left-bold" />{{ lab?.title ?? '这一节' }} </router-link>
      <h1 class="title">全班进度</h1>
      <span class="grow"></span>
      <label class="classPick">
        <span class="sec">班级</span>
        <n-select :value="className" :options="classOptions" placeholder="选择班级" filterable class="classSelect" @update:value="changeClass" />
      </label>
      <n-button @click="router.push({ name: 'admin lab edit', params: { labID } })">编辑这一节</n-button>
    </div>

    <n-empty v-if="progress && !progress.className" description="还没有人做过，先选一个班" />
    <n-empty v-else-if="progress && !total" description="这个班没有学生" />

    <template v-else-if="progress">
      <!-- 一条总览 -->
      <section class="card overview">
        <div class="bar">
          <span v-for="(g, i) in groups" :key="g.key" :style="{ flexGrow: g.students.length, background: barColor(g, i) }"></span>
        </div>
        <div class="legend">
          <span v-for="(g, i) in groups" :key="g.key" class="legendItem">
            <span class="swatch" :style="{ background: barColor(g, i) }"></span>{{ groupTitle(g) }} <b>{{ g.students.length }}</b>
          </span>
          <span class="grow"></span>
          <span class="sec">共 {{ total }} 人</span>
        </div>
      </section>

      <div class="body">
        <!-- 左：分组 -->
        <div class="groups">
          <section v-for="g in groups" :key="g.key" class="card group">
            <button type="button" class="groupHead" :class="{ stuck: g.kind === 'stuck' }" @click="toggleGroup(g.key)">
              <Icon :icon="openGroups.has(g.key) ? 'ph:caret-down-bold' : 'ph:caret-right-bold'" class="caret" />
              <span class="cnt" :class="g.kind">{{ g.students.length }}</span>
              <span>{{ groupTitle(g) }}</span>
              <b v-if="g.stepIndex !== null" class="ell">{{ progress.steps[g.stepIndex]?.title }}</b>
            </button>
            <template v-if="openGroups.has(g.key)">
              <template v-if="g.kind === 'stuck'">
                <div v-for="r in g.reasons" :key="r.label" class="reason">
                  <div class="why">
                    <span class="num">{{ r.students.length }}</span
                    ><span>{{ r.label }}</span>
                  </div>
                  <div class="names">
                    <n-button
                      v-for="s in r.students"
                      :key="s.id"
                      size="small"
                      :type="s.id === selectedId ? 'primary' : 'default'"
                      :secondary="s.id === selectedId"
                      @click="select(s)"
                    >
                      <UserName :username="s.username" />
                    </n-button>
                  </div>
                </div>
              </template>
              <div v-else class="reason">
                <div class="names">
                  <n-button
                    v-for="s in g.students"
                    :key="s.id"
                    size="small"
                    :type="s.id === selectedId ? 'primary' : 'default'"
                    :secondary="s.id === selectedId"
                    @click="select(s)"
                  >
                    <UserName :username="s.username" />
                  </n-button>
                </div>
              </div>
            </template>
          </section>
        </div>

        <!-- 右：一个学生 -->
        <section class="card student">
          <template v-if="selected">
            <div class="studentHead">
              <b class="studentName"><UserName :username="selected.username" /></b>
              <n-tag v-if="selectedState?.kind === 'stuck'" size="small" :bordered="false" type="warning">
                第 {{ selectedState.stepIndex! + 1 }} 步{{ selectedState.tried ? '没过' : '还没做' }}
              </n-tag>
              <n-tag v-else-if="selectedState?.kind === 'done'" size="small" :bordered="false" type="success">全部做对</n-tag>
              <n-tag v-else size="small" :bordered="false">还没开始</n-tag>
              <span class="grow"></span>
              <span v-if="lastRun" class="sec">最后运行 {{ timeText(lastRun) }}</span>
            </div>

            <div class="stepRows">
              <button v-for="(cell, i) in selected.steps" :key="i" type="button" class="stepRow" :class="{ on: i === selectedStep }" @click="pickStep(i)">
                <span class="sn" :class="cell.passed ? 'done' : cell.runs ? 'cur' : 'todo'">{{ i + 1 }}</span>
                <span class="ell grow">{{ progress.steps[i]?.title }}</span>
                <span v-if="cell.passed" class="sec">{{ timeText(cell.submittedAt ?? cell.passedAt) }} {{ cell.submittedAt ? '交了' : '做对' }}</span>
                <span v-else-if="cell.runs" class="warn">运行 {{ cell.runs }} 次</span>
                <span v-else class="sec">还没动</span>
              </button>
            </div>

            <template v-if="work">
              <div v-if="work.steps[selectedStep]?.openText" class="openText">「{{ work.steps[selectedStep]!.openText }}」</div>
              <div v-if="shownCode !== null" class="codeBox">
                <CodeEditor :value="shownCode" language="Python" :font-size="14" height="auto" readonly />
              </div>
              <n-text v-else depth="3" class="sec">这一步还没动过</n-text>
              <n-spin v-if="running" size="small" />
              <template v-else-if="stepResult">
                <LabOutputs :outputs="stepResult.outputs" :truncated="stepResult.truncated" />
                <LabVerdict
                  v-if="progress.steps[selectedStep]?.kind === 'normal' || stepResult.error"
                  :result="stepResult"
                  :step="selectedStep + 1"
                  :codes="selectedCodes"
                  :check-kind="lab?.steps[selectedStep]?.checkKind ?? 'compare'"
                  teacher
                />
              </template>
            </template>
            <n-spin v-else size="small" />
          </template>
          <n-text v-else depth="3">还没选学生</n-text>
        </section>
      </div>
    </template>

    <n-spin v-else size="small" />
  </div>
</template>

<style scoped>
.progressPage {
  box-sizing: border-box;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.topRow {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--oj-link);
  text-decoration: none;
}

.title {
  margin: 0;
  font-size: 22px;
}

.grow {
  flex: 1 1 auto;
  min-width: 0;
}

.classPick {
  display: flex;
  align-items: center;
  gap: 8px;
}

.classSelect {
  width: 180px;
}

.sec {
  font-size: 13px;
  color: v-bind('theme.textColor3');
  white-space: nowrap;
}

.warn {
  font-size: 13px;
  color: #b86e00;
  white-space: nowrap;
}

.card {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
}

.overview {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar {
  display: flex;
  gap: 2px;
  height: 14px;
  border-radius: 7px;
  overflow: hidden;
}

.bar span {
  flex-basis: 0;
  min-width: 4px;
}

.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 22px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 1000px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group {
  overflow: hidden;
}

.groupHead {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.groupHead.stuck {
  background: rgba(240, 160, 32, 0.07);
}

.caret {
  flex: none;
  color: v-bind('theme.textColor3');
}

.cnt {
  min-width: 28px;
  text-align: right;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cnt.stuck {
  color: #b86e00;
}

.cnt.done {
  color: v-bind('theme.primaryColorPressed');
}

.cnt.idle {
  color: v-bind('theme.textColor3');
}

.ell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reason {
  padding: 10px 16px 12px 54px;
  border-top: 1px solid v-bind('theme.dividerColor');
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.why {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
}

.num {
  width: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.student {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  position: sticky;
  top: 12px;
}

.studentHead {
  display: flex;
  align-items: center;
  gap: 10px;
}

.studentName {
  font-size: 18px;
}

.stepRows {
  display: flex;
  flex-direction: column;
}

.stepRow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 6px;
  border: 0;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
}

.stepRow:hover {
  background: v-bind('theme.hoverColor');
}

.stepRow.on {
  font-weight: 600;
  background: rgba(24, 160, 88, 0.08);
}

.sn {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 12px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}

.sn.done {
  background: v-bind('theme.primaryColor');
  color: #ffffff;
}

.sn.cur {
  border: 2px solid #f0a020;
  color: #8a5200;
}

.sn.todo {
  border: 1.5px solid v-bind('theme.borderColor');
  color: v-bind('theme.textColor3');
}

.codeBox {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
}

.student :deep(.image) {
  max-width: min(100%, 460px);
}

.openText {
  font-size: 15px;
  line-height: 1.7;
}
</style>
