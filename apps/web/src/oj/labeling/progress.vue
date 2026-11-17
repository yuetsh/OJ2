<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { LabelingProgress } from '@oj2/contract'
import UserName from 'shared/components/UserName.vue'
import { useConfigStore } from 'shared/store/config'
import { errorMessage } from 'utils/api'
import { groupClassOptions } from 'utils/classes'
import { getLabeling, getLabelingProgress } from 'oj/api'
import LabelingImage from './components/LabelingImage.vue'
import SpanText from './components/SpanText.vue'
import { itemsView, peopleView } from './utils/progress'

/**
 * 老师看全班（画布 LabelProgressPeople / LabelProgressItems）：「按人」「按数据」两种看法同一页切换。
 * 第一版不接课堂任务，上课盯着看就靠这一页，10 秒刷新一次。
 */
const props = defineProps<{ labelingID: string }>()

const theme = useThemeVars()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const configStore = useConfigStore()

const labelingId = computed(() => Number(props.labelingID))
const title = ref('')
const progress = ref<LabelingProgress | null>(null)
const className = ref<string | null>(typeof route.query.className === 'string' ? route.query.className : null)
const view = ref<'people' | 'items'>(route.query.view === 'items' ? 'items' : 'people')
const showAllDone = ref(false)

const people = computed(() => (progress.value ? peopleView(progress.value) : null))
const itemRows = computed(() => (progress.value ? itemsView(progress.value) : []))
const total = computed(() => progress.value?.students.length ?? 0)
const itemCount = computed(() => progress.value?.items.length ?? 0)
const shownDone = computed(() => (showAllDone.value ? people.value!.done : people.value!.done.slice(0, 8)))

const classOptions = computed(() => {
  const list = [...(progress.value?.classes ?? []), ...(configStore.config?.classList ?? [])]
  return groupClassOptions(className.value ? [className.value, ...list] : list)
})

async function load() {
  const data = await getLabelingProgress(labelingId.value, className.value)
  progress.value = data
  className.value = data.className
}

function changeClass(value: string) {
  className.value = value
  router.replace({ query: { ...route.query, className: value } })
  load().catch((err) => message.error(errorMessage(err)))
}

function changeView(value: 'people' | 'items') {
  view.value = value
  router.replace({ query: { ...route.query, view: value } })
}

function percent(n: number, d: number) {
  return `${d ? (n / d) * 100 : 0}%`
}

const { pause, resume } = useIntervalFn(() => {
  if (!document.hidden) load().catch(() => {})
}, 10_000)
useEventListener(document, 'visibilitychange', () => (document.hidden ? pause() : resume()))

onMounted(async () => {
  getLabeling(labelingId.value).then((d) => (title.value = d.title))
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
      <router-link :to="{ name: 'labeling', params: { labelingID } }" class="back"><Icon icon="ph:caret-left-bold" />{{ title || '这一节' }}</router-link>
      <h1 class="title">全班情况</h1>
      <n-radio-group :value="view" @update:value="changeView">
        <n-radio-button value="people">按人</n-radio-button>
        <n-radio-button value="items">按数据</n-radio-button>
      </n-radio-group>
      <span class="grow"></span>
      <label class="classPick">
        <span class="sec">班级</span>
        <n-select :value="className" :options="classOptions" placeholder="选择班级" filterable class="classSelect" @update:value="changeClass" />
      </label>
      <n-button @click="router.push({ name: 'admin labeling edit', params: { labelingID } })">编辑这一节</n-button>
    </div>

    <n-empty v-if="progress && !progress.className" description="还没有人做过，先选一个班" />
    <n-empty v-else-if="progress && !total" description="这个班没有学生" />
    <n-empty v-else-if="progress && !itemCount" description="这一节还没有数据" />

    <!-- 按人 -->
    <template v-else-if="progress && people && view === 'people'">
      <section class="card overview">
        <div class="bar">
          <span :style="{ flexGrow: people.done.length, background: theme.primaryColor }"></span>
          <span :style="{ flexGrow: people.doing.length, background: '#f0a020' }"></span>
          <span :style="{ flexGrow: people.idle.length, background: theme.dividerColor }"></span>
        </div>
        <div class="legend">
          <span class="legendItem"
            ><span class="swatch" :style="{ background: theme.primaryColor }"></span>做完了 <b>{{ people.done.length }}</b></span
          >
          <span class="legendItem"
            ><span class="swatch" style="background: #f0a020"></span>做到一半 <b>{{ people.doing.length }}</b></span
          >
          <span class="legendItem"
            ><span class="swatch" :style="{ background: theme.dividerColor }"></span>还没开始 <b>{{ people.idle.length }}</b></span
          >
          <span class="grow"></span>
          <span class="sec"
            >共 {{ total }} 人<template v-if="people.doneAverage !== null">
              · 做完的平均一次就对 {{ people.doneAverage.toFixed(1) }} / {{ itemCount }}</template
            ></span
          >
        </div>
      </section>

      <div class="cols">
        <section class="card group">
          <div class="groupHead doing">
            <span class="cnt warnText">{{ people.doing.length }}</span
            >做到一半
          </div>
          <div class="pr head"><span>名字</span><span>做到哪</span><span class="r">一次就对</span><span class="r">错了</span></div>
          <div v-for="r in people.doing" :key="r.student.id" class="pr">
            <UserName :username="r.student.username" class="ell" />
            <span class="cellBar"
              ><span class="track"><span class="fill doingFill" :style="{ width: percent(r.passed, itemCount) }"></span></span
              ><span class="sec at">第 {{ r.passed + 1 }} 条</span></span
            >
            <span class="r num">{{ r.firstCorrect }}</span>
            <span class="r num" :class="{ warnText: r.wrongCount >= people.manyWrong }">{{ r.wrongCount }} 次</span>
          </div>
          <n-text v-if="!people.doing.length" depth="3" class="none">没有</n-text>
        </section>

        <div class="stack">
          <section class="card group">
            <div class="groupHead">
              <span class="cnt okText">{{ people.done.length }}</span
              >做完了
            </div>
            <div class="pr head two"><span>名字</span><span>一次就对</span><span class="r">错了</span></div>
            <div v-for="r in shownDone" :key="r.student.id" class="pr two">
              <UserName :username="r.student.username" class="ell" />
              <span class="cellBar"
                ><span class="track"><span class="fill" :style="{ width: percent(r.firstCorrect, itemCount) }"></span></span
                ><span class="at num">{{ r.firstCorrect }} / {{ itemCount }}</span></span
              >
              <span class="r num" :class="{ warnText: r.wrongCount >= people.manyWrong }">{{ r.wrongCount }} 次</span>
            </div>
            <n-button v-if="people.done.length > shownDone.length" text type="primary" class="more" @click="showAllDone = true">
              还有 {{ people.done.length - shownDone.length }} 人
            </n-button>
            <n-text v-if="!people.done.length" depth="3" class="none">没有</n-text>
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
    <section v-else-if="progress && view === 'items'" class="card items">
      <div class="ir head" :class="progress.kind">
        <span>第几条</span>
        <span>{{ progress.kind === 'image' ? '图片' : progress.kind === 'span' ? '答案' : '文字' }}</span>
        <span v-if="progress.kind !== 'span'">答案</span>
        <span>第一次就{{ progress.kind === 'span' ? '全对' : '标对' }}</span>
        <span>{{ progress.kind === 'span' ? '最常见的错' : '标错的多半选了' }}</span>
      </div>
      <div v-for="row in itemRows" :key="row.item.id" class="ir" :class="[progress.kind, { flagged: row.flagged }]">
        <span class="sec num">{{ row.index + 1 }}</span>
        <span v-if="progress.kind === 'image'" class="thumb"><LabelingImage :labeling-id="labelingId" :item-id="row.item.id" /></span>
        <SpanText v-else-if="progress.kind === 'span'" :text="row.item.text" :spans="row.item.spans" :labels="progress.labels" class="rowText" />
        <span v-else class="rowText ell2">{{ row.item.text }}</span>
        <span v-if="progress.kind !== 'span'"
          ><n-tag size="small" :bordered="false" type="success">{{ row.item.answer ?? '没定' }}</n-tag></span
        >
        <span class="cellBar">
          <span class="track"><span class="fill" :class="{ flagFill: row.flagged }" :style="{ width: percent(row.firstCorrect, row.answered) }"></span></span
          ><span class="at num">{{ row.firstCorrect }} / {{ row.answered }}</span>
        </span>
        <span v-if="row.topMistake" :class="{ warnText: row.flagged }"
          >{{ row.topMistake.text }} <span class="sec">{{ row.topMistake.count }} 人</span></span
        >
        <span v-else class="sec">—</span>
      </div>
    </section>

    <n-spin v-else-if="!progress" size="small" />
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

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group {
  overflow: hidden;
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
  min-width: 28px;
  text-align: right;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pr {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) 64px 64px;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.pr.two {
  grid-template-columns: 110px minmax(0, 1fr) 64px;
}

.pr.head {
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
}

.cellBar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.track {
  flex: 1 1 auto;
  height: 8px;
  border-radius: 4px;
  background: v-bind('theme.dividerColor');
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: v-bind('theme.primaryColor');
}

.doingFill,
.flagFill {
  background: #f0a020;
}

.at {
  width: 64px;
  flex-shrink: 0;
  font-size: 13px;
  white-space: nowrap;
}

.more {
  margin: 10px 16px;
}

.none {
  display: block;
  padding: 12px 16px;
}

.names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
}

.items {
  overflow: hidden;
}

.ir {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 110px 260px 260px;
  align-items: center;
  gap: 14px;
  min-height: 60px;
  padding: 8px 18px;
  box-sizing: border-box;
  font-size: 14px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.ir.span {
  grid-template-columns: 52px minmax(0, 1fr) 240px 280px;
}

.ir.head {
  min-height: 38px;
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.ir.flagged {
  background: rgba(240, 160, 32, 0.08);
}

.thumb {
  width: 80px;
  height: 56px;
  border-radius: 4px;
  overflow: hidden;
  background: v-bind('theme.actionColor');
}

.rowText {
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.ell2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 1000px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
  .ir,
  .ir.span {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .ir.head {
    display: none;
  }
}
</style>
