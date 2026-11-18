<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { ModelTrainingProgress } from '@oj2/contract'
import UserName from 'shared/components/UserName.vue'
import { useConfigStore } from 'shared/store/config'
import { errorMessage } from 'utils/api'
import ClassSelect from 'shared/components/ClassSelect.vue'
import { getModelTraining, getModelTrainingProgress } from 'oj/api'
import { itemsView, peopleView } from './utils/progress'

/**
 * 老师看全班（画布 TrainProgressPeople / TrainProgressItems）：「按人」「按数据」两种看法同一页切换。
 * 不接课堂任务，上课盯着看就靠这一页，10 秒刷新一次。
 */
const props = defineProps<{ modelTrainingID: string }>()

const theme = useThemeVars()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const configStore = useConfigStore()
/** 候选班：做过这一节的班在前，再是配置里的班 */
const classes = computed(() => [...(progress.value?.classes ?? []), ...(configStore.config?.classList ?? [])])

const lessonId = computed(() => Number(props.modelTrainingID))
const title = ref('')
const progress = ref<ModelTrainingProgress | null>(null)
const className = ref<string | null>(typeof route.query.className === 'string' ? route.query.className : null)
const view = ref<'people' | 'items'>(route.query.view === 'items' ? 'items' : 'people')
const showAll = reactive({ notPassed: false, passed: false, mislabeled: false })
const SHOW = 12

const people = computed(() => (progress.value ? peopleView(progress.value) : null))
const items = computed(() => (progress.value ? itemsView(progress.value) : null))
const total = computed(() => progress.value?.students.length ?? 0)

/** 准确率条的刻度：大家都在 50% 以上就从 50% 画起，差别看得出来 */
const scaleFrom = computed(() => {
  const bests = progress.value?.students.flatMap((s) => (s.best === null ? [] : [s.best])) ?? []
  return bests.some((b) => b < 50) ? 0 : 50
})

function at(value: number) {
  return `${Math.max(0, Math.min(100, ((value - scaleFrom.value) / (100 - scaleFrom.value)) * 100))}%`
}

async function load() {
  const data = await getModelTrainingProgress(lessonId.value, className.value)
  progress.value = data
  className.value = data.className
}

function changeClass(value: string | null) {
  if (!value) return
  className.value = value
  router.replace({ query: { ...route.query, className: value } })
  load().catch((err) => message.error(errorMessage(err)))
}

function changeView(value: 'people' | 'items') {
  view.value = value
  router.replace({ query: { ...route.query, view: value } })
}

function limit<T>(list: T[], all: boolean) {
  return all ? list : list.slice(0, SHOW)
}

const { pause, resume } = useIntervalFn(() => {
  if (!document.hidden) load().catch(() => {})
}, 10_000)
useEventListener(document, 'visibilitychange', () => (document.hidden ? pause() : resume()))

onMounted(async () => {
  getModelTraining(lessonId.value).then((d) => (title.value = d.title))
  try {
    await load()
  } catch (err) {
    message.error(errorMessage(err, '打不开'))
  }
})
</script>

<template>
  <div class="progressPage">
    <div class="topRow">
      <router-link :to="{ name: 'model training', params: { modelTrainingID } }" class="back"
        ><Icon icon="ph:caret-left-bold" />{{ title || '这一节' }}</router-link
      >
      <h1 class="title">全班情况</h1>
      <n-radio-group :value="view" @update:value="changeView">
        <n-radio-button value="people">按人</n-radio-button>
        <n-radio-button value="items">按数据</n-radio-button>
      </n-radio-group>
      <span class="grow"></span>
      <label class="classPick">
        <span class="sec">班级</span>
        <ClassSelect :value="className" :classes="classes" placeholder="选择班级" class="classSelect" @update:value="changeClass" />
      </label>
      <n-button @click="router.push({ name: 'admin model training edit', params: { modelTrainingID } })">编辑这一节</n-button>
    </div>

    <n-spin v-if="!progress" size="small" />
    <n-empty v-else-if="!progress.className" description="还没有人做过，先选一个班" />
    <n-empty v-else-if="!total" description="这个班没有学生" />

    <!-- 按人 -->
    <template v-else-if="people && view === 'people'">
      <section class="card overview">
        <div class="bar">
          <span :style="{ flexGrow: people.passed.length, background: theme.primaryColor }"></span>
          <span :style="{ flexGrow: people.notPassed.length, background: '#f0a020' }"></span>
          <span :style="{ flexGrow: people.idle.length, background: theme.dividerColor }"></span>
        </div>
        <div class="legend">
          <span class="legendItem"
            ><span class="swatch" :style="{ background: theme.primaryColor }"></span>达标 <b>{{ people.passed.length }}</b></span
          >
          <span class="legendItem"
            ><span class="swatch" style="background: #f0a020"></span>没达标 <b>{{ people.notPassed.length }}</b></span
          >
          <span class="legendItem"
            ><span class="swatch" :style="{ background: theme.dividerColor }"></span>还没开始 <b>{{ people.idle.length }}</b></span
          >
          <span class="grow"></span>
          <span class="sec">共 {{ total }} 人 · 达标线 {{ progress.threshold }}%</span>
        </div>
      </section>

      <div class="cols">
        <section class="card group">
          <div class="groupHead doing">
            <span class="cnt warnText">{{ people.notPassed.length }}</span
            >没达标
          </div>
          <div class="pr head">
            <span>名字</span><span>最高准确率</span><span class="r">训练</span><span class="r">标错的改对</span><span class="r">改坏了</span>
          </div>
          <div v-for="r in limit(people.notPassed, showAll.notPassed)" :key="r.student.id" class="pr">
            <UserName :username="r.student.username" class="ell" />
            <span class="cellBar"
              ><span class="track"
                ><span class="fill doingFill" :style="{ width: at(r.student.best ?? 0) }"></span
                ><span class="line" :style="{ left: at(progress.threshold) }"></span></span
              ><span class="pct num">{{ r.student.best }}%</span></span
            >
            <span class="r num" :class="{ warnText: r.student.runs <= 2 }">{{ r.student.runs }} 次</span>
            <span class="r num">{{ r.fixed }} / {{ people.mislabeled }}</span>
            <span class="r num" :class="{ warnText: r.broken >= 3 }">{{ r.broken }}</span>
          </div>
          <n-button v-if="!showAll.notPassed && people.notPassed.length > SHOW" text type="primary" class="more" @click="showAll.notPassed = true">
            还有 {{ people.notPassed.length - SHOW }} 人
          </n-button>
          <n-text v-if="!people.notPassed.length" depth="3" class="none">没有</n-text>
        </section>

        <div class="stack">
          <section class="card group">
            <div class="groupHead">
              <span class="cnt okText">{{ people.passed.length }}</span
              >达标
            </div>
            <div class="pr head">
              <span>名字</span><span>最高准确率</span><span class="r">训练</span><span class="r">标错的改对</span><span class="r">改坏了</span>
            </div>
            <div v-for="r in limit(people.passed, showAll.passed)" :key="r.student.id" class="pr">
              <UserName :username="r.student.username" class="ell" />
              <span class="cellBar"
                ><span class="track"
                  ><span class="fill" :style="{ width: at(r.student.best ?? 0) }"></span
                  ><span class="line" :style="{ left: at(progress.threshold) }"></span></span
                ><span class="pct num">{{ r.student.best }}%</span></span
              >
              <span class="r num">{{ r.student.runs }} 次</span>
              <span class="r num">{{ r.fixed }} / {{ people.mislabeled }}</span>
              <span class="r num" :class="{ warnText: r.broken >= 3 }">{{ r.broken }}</span>
            </div>
            <n-button v-if="!showAll.passed && people.passed.length > SHOW" text type="primary" class="more" @click="showAll.passed = true">
              还有 {{ people.passed.length - SHOW }} 人
            </n-button>
            <n-text v-if="!people.passed.length" depth="3" class="none">没有</n-text>
          </section>

          <section class="card group">
            <div class="groupHead">
              <span class="cnt sec">{{ people.idle.length }}</span
              >还没开始
            </div>
            <div class="names">
              <n-tag v-for="r in people.idle" :key="r.student.id" :bordered="true" size="medium"><UserName :username="r.student.username" /></n-tag>
              <n-text v-if="!people.idle.length" depth="3">没有</n-text>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- 按数据 -->
    <div v-else-if="items" class="cols items">
      <section class="card group">
        <div class="groupHead">
          <span class="cnt">{{ items.mislabeled.length }}</span
          >故意标错的<span class="grow"></span><span class="sec">做过的 {{ items.active }} 人</span>
        </div>
        <div class="ir head"><span>句子</span><span>给学生 → 正确</span><span>改对的人</span></div>
        <div v-for="r in limit(items.mislabeled, showAll.mislabeled)" :key="r.item.id" class="ir">
          <span class="ell" :title="r.item.text">{{ r.item.text }}</span>
          <span class="ell"
            >{{ r.item.shown }} → <b>{{ r.item.answer }}</b></span
          >
          <span class="cellBar"
            ><span class="track"><span class="fill" :style="{ width: `${items.active ? (r.fixed / items.active) * 100 : 0}%` }"></span></span
            ><span class="pct num">{{ r.fixed }} 人</span></span
          >
        </div>
        <n-button v-if="!showAll.mislabeled && items.mislabeled.length > SHOW" text type="primary" class="more" @click="showAll.mislabeled = true">
          还有 {{ items.mislabeled.length - SHOW }} 条
        </n-button>
        <n-text v-if="!items.mislabeled.length" depth="3" class="none">这一节没有故意标错的</n-text>
      </section>

      <section class="card group">
        <div class="groupHead">被改坏最多的</div>
        <div class="br head"><span>句子</span><span>正确</span><span class="r">改错的人</span></div>
        <div v-for="r in items.broken.slice(0, 15)" :key="r.item.id" class="br" :class="{ flagged: r.flagged }">
          <span class="ell" :title="r.item.text">{{ r.item.text }}</span>
          <span class="ell">{{ r.item.answer }}</span>
          <span class="r num" :class="{ warnText: r.flagged }">改成{{ r.top?.label }} {{ r.top?.count }} 人</span>
        </div>
        <n-text v-if="!items.broken.length" depth="3" class="none">还没有人改坏</n-text>
      </section>
    </div>
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

.num {
  font-variant-numeric: tabular-nums;
}

.warnText {
  color: #b86e00;
  font-weight: 700;
}

.okText {
  color: v-bind('theme.primaryColor');
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

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.cols.items {
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.group {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.groupHead {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  font-size: 15px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.groupHead.doing {
  background: rgba(240, 160, 32, 0.08);
}

.cnt {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}

.pr,
.ir,
.br {
  display: grid;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  font-size: 14px;
}

.pr {
  grid-template-columns: 96px minmax(0, 1fr) 56px 84px 52px;
}

.ir {
  grid-template-columns: minmax(0, 1fr) 120px 170px;
  min-height: 48px;
}

.br {
  grid-template-columns: minmax(0, 1fr) 64px 120px;
  min-height: 48px;
}

.br.flagged {
  background: rgba(240, 160, 32, 0.1);
}

.head {
  min-height: 34px;
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.r {
  text-align: right;
}

.ell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.cellBar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.track {
  position: relative;
  flex: 1 1 auto;
  height: 8px;
  border-radius: 4px;
  background: v-bind('theme.dividerColor');
}

.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: v-bind('theme.primaryColor');
}

.doingFill {
  background: #f0a020;
}

.line {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 16px;
  background: v-bind('theme.textColor2');
}

.pct {
  width: 42px;
  text-align: right;
  flex-shrink: 0;
}

.names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
}

.more {
  align-self: center;
  margin: 10px 0;
}

.none {
  padding: 14px 16px;
}

@media (max-width: 900px) {
  .cols,
  .cols.items {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
