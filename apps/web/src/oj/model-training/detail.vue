<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import {
  EMPTY_MODEL_TRAINING_EDITS,
  MODEL_TRAINING_MAX_ADDED,
  MODEL_TRAINING_MAX_ADDED_TEXT,
  editsDiff,
  type ModelTrainingDetail,
  type ModelTrainingEdits,
} from '@oj2/contract'
import Markdown from 'shared/components/Markdown.vue'
import { useAuthModalStore } from 'shared/store/authModal'
import { useUserStore } from 'shared/store/user'
import { errorMessage } from 'utils/api'
import { getModelTraining, resetModelTraining, saveModelTrainingWork, trainModelTraining } from 'oj/api'
import LabelPick from './components/LabelPick.vue'
import { labelSwatch } from './utils/colors'

/**
 * 学生做一节「训练模型」（画布 TrainStudent / TrainPassed），电脑为先：
 * 左边是练习测试里判错的，点开一条标出让它判错的字；右边是训练数据里含这个字的，当场改标签、删掉、补一条。
 * 改一处存一次（不训练）；点「训练」才在服务器上训练、判两份测试。达标后顶上换成复盘，下面照样能接着改。
 * 规则见 docs/specs/2026-11-17-model-training-lab-design.md。
 */
const props = defineProps<{ modelTrainingID: string }>()

const theme = useThemeVars()
const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const userStore = useUserStore()
const authModal = useAuthModalStore()

const lessonId = computed(() => Number(props.modelTrainingID))
const detail = ref<ModelTrainingDetail | null>(null)
const notFound = ref(false)
const edits = ref<ModelTrainingEdits>({ ...EMPTY_MODEL_TRAINING_EDITS })
const training = ref(false)
const showAllMissed = ref(false)

/** 左边点中的那一条（练习测试判错的第几条）和按哪个词找 */
const selectedWrong = ref(0)
const keyword = ref<string | null>(null)
const tab = ref<'keyword' | 'all'>('keyword')
const search = ref('')
const labelFilter = ref<string | null>(null)
const pageSize = 50
const shownCount = ref(pageSize)

async function load() {
  try {
    apply(await getModelTraining(lessonId.value))
  } catch {
    notFound.value = true
  }
}

function apply(data: ModelTrainingDetail) {
  detail.value = data
  edits.value = structuredClone(data.edits)
  selectWrong(0)
}

function needLogin() {
  if (userStore.isAuthed) return false
  authModal.openLoginModal()
  return true
}

// ---------------------------------------------------------------- 训练

const runs = computed(() => detail.value?.runs ?? [])
/** 改了几处还没训练 */
const pending = computed(() => (detail.value ? editsDiff(edits.value, detail.value.trainedEdits ?? EMPTY_MODEL_TRAINING_EDITS) : 0))

async function train() {
  // 上次训练后一处都没改：结果一模一样，不用再训练（按钮是灰的）
  if (!detail.value || training.value || (runs.value.length > 0 && !pending.value) || needLogin()) return
  saveLater.cancel()
  training.value = true
  try {
    apply(await trainModelTraining(lessonId.value, edits.value))
    const run = runs.value.at(-1)
    if (run?.passed && runs.value.filter((r) => r.passed).length === 1) message.success('达标了！')
  } catch (err) {
    message.error(errorMessage(err, '没训练成'))
  } finally {
    training.value = false
  }
}

// ---------------------------------------------------------------- 改数据（改一处存一次）

const saveLater = useDebounceFn(async () => {
  if (!userStore.isAuthed) return
  try {
    await saveModelTrainingWork(lessonId.value, edits.value)
  } catch (err) {
    message.error(errorMessage(err, '改动没存上'))
  }
}, 600)

function changed() {
  if (needLogin()) return false
  saveLater()
  return true
}

interface Row {
  /** 原来的条目是 id，补的是 'a' + key */
  key: string
  id: number | null
  addedKey: number | null
  text: string
  label: string
  relabeled: boolean
  removed: boolean
}

const rows = computed<Row[]>(() => {
  const d = detail.value
  if (!d) return []
  const relabel = new Map(edits.value.relabels.map((r) => [r.id, r.label]))
  const removed = new Set(edits.value.removed)
  return [
    ...d.train.map((row) => {
      const now = relabel.get(row.id)
      return {
        key: String(row.id),
        id: row.id,
        addedKey: null,
        text: row.text,
        label: now ?? row.label,
        relabeled: now !== undefined && now !== row.label,
        removed: removed.has(row.id),
      }
    }),
    ...edits.value.added.map((row) => ({
      key: `a${row.key}`,
      id: null,
      addedKey: row.key,
      text: row.text,
      label: row.label,
      relabeled: false,
      removed: false,
    })),
  ]
})

const liveRows = computed(() => rows.value.filter((row) => !row.removed))
const labelCounts = computed(() => detail.value?.labels.map((label) => ({ label, n: liveRows.value.filter((row) => row.label === label).length })) ?? [])
const relabelCount = computed(() => rows.value.filter((row) => row.relabeled && !row.removed).length)

function setLabel(row: Row, label: string) {
  if (row.label === label || !changed()) return
  if (row.addedKey !== null) {
    const added = edits.value.added.find((a) => a.key === row.addedKey)
    if (added) added.label = label
  } else {
    const original = detail.value!.train.find((t) => t.id === row.id)!
    edits.value.relabels = edits.value.relabels.filter((r) => r.id !== row.id)
    if (label !== original.label) edits.value.relabels.push({ id: row.id!, label })
  }
}

function remove(row: Row) {
  if (!changed()) return
  if (row.addedKey !== null) edits.value.added = edits.value.added.filter((a) => a.key !== row.addedKey)
  else edits.value.removed.push(row.id!)
}

function restore(row: Row) {
  if (!changed()) return
  edits.value.removed = edits.value.removed.filter((id) => id !== row.id)
}

const newText = ref('')
const newLabel = ref<string | null>(null)
const addLeft = computed(() => MODEL_TRAINING_MAX_ADDED - edits.value.added.length)

function addRow() {
  const text = newText.value.trim()
  if (!text || !newLabel.value || addLeft.value <= 0 || !changed()) return
  const key = Math.max(0, ...edits.value.added.map((a) => a.key + 1))
  edits.value.added.push({ key, text, label: newLabel.value })
  newText.value = ''
}

function resetAll() {
  dialog.warning({
    title: '恢复原样？',
    content: '改的标签、删掉的、补的都清掉，回到老师给的数据。以前训练的记录还在。',
    positiveText: '恢复原样',
    negativeText: '算了',
    onPositiveClick: () => {
      if (!changed()) return
      edits.value = { relabels: [], removed: [], added: [] }
    },
  })
}

// ---------------------------------------------------------------- 左：判错的；右：按关键字找

const wrongs = computed(() => detail.value?.practiceWrong ?? null)
const wrong = computed(() => wrongs.value?.[selectedWrong.value] ?? null)

function selectWrong(index: number) {
  selectedWrong.value = index
  keyword.value = detail.value?.practiceWrong?.[index]?.keywords[0] ?? null
  tab.value = keyword.value ? 'keyword' : 'all'
  shownCount.value = pageSize
}

function pickKeyword(word: string) {
  keyword.value = word
  tab.value = 'keyword'
  shownCount.value = pageSize
}

/** 每个字的颜色深浅：只看把它往「判成的那类」推的（正的），按这一句里最大的那个分三档 */
const chars = computed(() => {
  const w = wrong.value
  if (!w) return []
  const max = Math.max(0, ...w.weights)
  return Array.from(w.text).map((ch, i) => {
    const v = max > 0 ? (w.weights[i] ?? 0) / max : 0
    return { ch, level: v > 0.66 ? 1 : v > 0.33 ? 2 : v > 0.12 ? 3 : 0 }
  })
})

const keywordRows = computed(() => {
  const k = keyword.value?.toLowerCase()
  if (!k) return []
  return liveRows.value.filter((row) => row.text.toLowerCase().includes(k))
})

const allRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((row) => (!q || row.text.toLowerCase().includes(q)) && (!labelFilter.value || row.label === labelFilter.value))
})

const listRows = computed(() => (tab.value === 'keyword' ? keywordRows.value : allRows.value))
const visibleRows = computed(() => listRows.value.slice(0, shownCount.value))

watch([search, labelFilter], () => (shownCount.value = pageSize))

/** 句子里把关键字标出来 */
function pieces(text: string) {
  const k = tab.value === 'keyword' ? keyword.value : search.value.trim()
  if (!k) return [{ text, mark: false }]
  const out: { text: string; mark: boolean }[] = []
  const lower = text.toLowerCase()
  const key = k.toLowerCase()
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(key, i)
    if (at < 0) break
    if (at > i) out.push({ text: text.slice(i, at), mark: false })
    out.push({ text: text.slice(at, at + key.length), mark: true })
    i = at + key.length
  }
  if (i < text.length) out.push({ text: text.slice(i), mark: false })
  return out
}

const labelOptions = computed(() => detail.value?.labels.map((l) => ({ label: l, value: l })) ?? [])

function reset() {
  dialog.warning({
    title: '重来？',
    content: '清掉你自己在这一节的改动和训练记录，从头再来。学生的不受影响。',
    positiveText: '重来',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await resetModelTraining(lessonId.value)
        await load()
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

onMounted(load)
</script>

<template>
  <div class="oj-page trainPage">
    <n-empty v-if="notFound" description="这一节不存在" />
    <n-spin v-else-if="!detail" size="small" />
    <template v-else>
      <div class="head">
        <router-link :to="{ name: 'model trainings' }" class="back"><Icon icon="ph:caret-left-bold" />训练模型</router-link>
        <h1 class="title">
          {{ detail.title }}
          <n-tag v-if="!detail.isPublic" size="small" :bordered="false" type="warning">没公开</n-tag>
        </h1>
        <Markdown v-if="detail.description.trim()" :content="detail.description" class="desc" />
      </div>

      <div v-if="userStore.isTeacherOrAbove" class="teacherBar">
        <n-button v-if="detail.canReset && runs.length" @click="reset">重来</n-button>
        <n-button @click="router.push({ name: 'model training progress', params: { modelTrainingID } })">看全班</n-button>
        <n-button @click="router.push({ name: 'admin model training edit', params: { modelTrainingID } })">编辑</n-button>
      </div>

      <!-- 顶上：准确率一串、训练按钮；各类条数、恢复原样 -->
      <section class="card topCard">
        <div class="runRow">
          <span v-if="detail.passed" class="passTag"><Icon icon="ph:check-bold" />达标了</span>
          <template v-if="runs.length">
            <template v-for="(r, i) in runs.slice(-6)" :key="i">
              <span v-if="i > 0" class="arr">→</span>
              <b v-if="i === runs.slice(-6).length - 1" class="now" :class="{ ok: r.passed }">{{ r.final }}%</b>
              <span v-else class="old">{{ r.final }}%</span>
            </template>
          </template>
          <span v-else class="old">还没训练</span>
          <span class="lineText">达标线 {{ detail.threshold }}%</span>
          <span class="grow"></span>
          <span v-if="runs.length && pending" class="pending">改了 {{ pending }} 处，还没训练</span>
          <n-button type="primary" size="large" :loading="training" :disabled="runs.length > 0 && !pending" @click="train">训练</n-button>
        </div>
        <div class="countRow">
          <span class="lab">训练数据</span>
          <span>{{ liveRows.length }} 条</span>
          <span v-for="c in labelCounts" :key="c.label" class="count"
            ><span class="swatch" :style="{ background: labelSwatch(detail.labels, c.label) }"></span>{{ c.label }} {{ c.n }}</span
          >
          <span class="grow"></span>
          <span v-if="relabelCount || edits.removed.length || edits.added.length" class="sec"
            >改了标签 {{ relabelCount }} · 删了 {{ edits.removed.length }} · 新加 {{ edits.added.length }}</span
          >
          <n-button size="small" :disabled="!relabelCount && !edits.removed.length && !edits.added.length" @click="resetAll">恢复原样</n-button>
        </div>
      </section>

      <!-- 达标后：复盘 -->
      <section v-if="detail.review" class="card review">
        <div class="reviewCol">
          <h2 class="h2">标错的 {{ detail.review.mislabeled }} 条，你改对了 {{ detail.review.fixed }} 条</h2>
          <span class="track"><span class="fill" :style="{ width: `${(detail.review.fixed / Math.max(1, detail.review.mislabeled)) * 100}%` }"></span></span>
          <div v-if="detail.review.missed.length" class="box">
            <div class="boxHead">没找到的 {{ detail.review.missed.length }} 条</div>
            <div v-for="m in showAllMissed ? detail.review.missed : detail.review.missed.slice(0, 8)" :key="m.id" class="boxRow">
              <span class="ell">{{ m.text }}</span>
              <span class="boxMeta"
                >标的是 {{ m.shown }}，应该是 <b>{{ m.answer }}</b></span
              >
            </div>
            <div v-if="!showAllMissed && detail.review.missed.length > 8" class="boxMore">
              <n-button size="small" @click="showAllMissed = true">还有 {{ detail.review.missed.length - 8 }} 条</n-button>
            </div>
          </div>
        </div>
        <div class="reviewCol">
          <template v-if="detail.review.broken.length">
            <h2 class="h2">你改坏了 {{ detail.review.broken.length }} 条</h2>
            <div class="box">
              <div v-for="b in detail.review.broken" :key="b.id" class="boxRow">
                <span class="ell">{{ b.text }}</span>
                <span class="boxMeta"
                  >本来就是 <b>{{ b.answer }}</b
                  >，你改成了 {{ b.now }}</span
                >
              </div>
            </div>
          </template>
          <template v-if="detail.review.note.trim()">
            <h2 class="h2">老师说</h2>
            <div class="note">{{ detail.review.note }}</div>
          </template>
        </div>
      </section>

      <div class="work">
        <!-- 左：练习测试判错的 -->
        <section class="card wrongCard">
          <div class="cardHead">
            <b>练习测试判错的</b>
            <span v-if="wrongs" class="sec">{{ wrongs.length }} / {{ detail.practiceTotal }}</span>
          </div>
          <n-empty v-if="!wrongs" description="先点「训练」，看看模型判错了哪些" class="empty" />
          <n-empty v-else-if="!wrongs.length" description="练习测试全判对了" class="empty" />
          <template v-for="(w, i) in wrongs ?? []" :key="i">
            <div v-if="i === selectedWrong" class="er cur">
              <div class="big">
                <span v-for="(c, j) in chars" :key="j" :class="c.level ? `lv${c.level}` : undefined">{{ c.ch }}</span>
              </div>
              <div class="verdict">
                <span
                  >应该是 <b class="okText">{{ w.answer }}</b></span
                ><span
                  >模型判成 <b class="noText">{{ w.predicted }}</b></span
                >
              </div>
              <div v-if="w.keywords.length" class="kwRow">
                <span class="sec">找训练数据里含</span>
                <button v-for="k in w.keywords" :key="k" type="button" class="kw" :class="{ on: tab === 'keyword' && k === keyword }" @click="pickKeyword(k)">
                  {{ k }}
                </button>
                <span class="sec">的</span>
              </div>
            </div>
            <button v-else type="button" class="er" @click="selectWrong(i)">
              <span class="ell">{{ w.text }}</span>
              <span class="erMeta">应该是{{ w.answer }} · 判成{{ w.predicted }}</span>
            </button>
          </template>
        </section>

        <!-- 右：训练数据 -->
        <section class="card dataCard">
          <div class="tabs">
            <button v-if="keyword" type="button" class="tab" :class="{ on: tab === 'keyword' }" @click="tab = 'keyword'">
              含「{{ keyword }}」 {{ keywordRows.length }} 条
            </button>
            <button type="button" class="tab" :class="{ on: tab === 'all' }" @click="tab = 'all'">全部 {{ rows.length }} 条</button>
          </div>
          <div v-if="tab === 'all'" class="filters">
            <n-input v-model:value="search" size="small" clearable placeholder="搜句子里的字" class="grow" />
            <n-select v-model:value="labelFilter" size="small" :options="labelOptions" clearable placeholder="全部标签" class="labelFilter" />
          </div>
          <div v-for="row in visibleRows" :key="row.key" class="tr" :class="{ gone: row.removed }">
            <span class="ell"
              ><template v-for="(p, i) in pieces(row.text)" :key="i"
                ><mark v-if="p.mark">{{ p.text }}</mark
                ><template v-else>{{ p.text }}</template></template
              ></span
            >
            <span v-if="row.removed" class="tag gone">删掉了</span>
            <span v-else-if="row.addedKey !== null" class="tag added">新加的</span>
            <span v-else-if="row.relabeled" class="tag changed">改过</span>
            <span v-else></span>
            <LabelPick v-if="!row.removed" :labels="detail.labels" :value="row.label" @update:value="(l: string) => setLabel(row, l)" />
            <span v-else></span>
            <n-button v-if="row.removed" size="small" @click="restore(row)">找回</n-button>
            <n-button v-else size="small" type="error" ghost @click="remove(row)">删掉</n-button>
          </div>
          <n-empty v-if="!listRows.length" description="没有这样的句子" class="empty" />
          <div v-if="listRows.length > shownCount" class="more">
            <n-button size="small" @click="shownCount += pageSize">再显示 {{ Math.min(pageSize, listRows.length - shownCount) }} 条</n-button>
          </div>
          <div class="addRow">
            <label for="trainAdd" class="sec">补一条</label>
            <n-input
              id="trainAdd"
              v-model:value="newText"
              size="small"
              :maxlength="MODEL_TRAINING_MAX_ADDED_TEXT"
              placeholder="写一句"
              :disabled="addLeft <= 0"
              class="grow"
              @keyup.enter="addRow"
            />
            <LabelPick :labels="detail.labels" :value="newLabel" @update:value="(l: string) => (newLabel = l)" />
            <n-button size="small" :disabled="!newText.trim() || !newLabel || addLeft <= 0" @click="addRow">加进去</n-button>
            <span class="sec">还能加 {{ addLeft }} 条</span>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.trainPage {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  align-self: flex-start;
}

.title {
  margin: 0;
  font-size: 22px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.desc {
  color: v-bind('theme.textColor2');
}

.teacherBar {
  display: flex;
  gap: 8px;
}

.card {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
}

.topCard {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.runRow,
.countRow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
}

.countRow {
  gap: 16px;
  font-size: 13px;
  border-top: 1px solid v-bind('theme.dividerColor');
  padding-top: 10px;
}

.lab {
  color: v-bind('theme.textColor3');
  font-size: 13px;
  min-width: 52px;
}

.old {
  font-size: 15px;
  color: v-bind('theme.textColor3');
}

.arr {
  color: v-bind('theme.textColor3');
  opacity: 0.7;
  font-size: 13px;
}

.now {
  font-size: 26px;
}

.now.ok {
  color: v-bind('theme.primaryColor');
}

.lineText {
  margin-left: 10px;
  color: v-bind('theme.textColor3');
}

.passTag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: rgba(24, 160, 88, 0.14);
  color: v-bind('theme.primaryColor');
  font-weight: 700;
}

.pending {
  font-size: 13px;
  color: #b86e00;
}

.grow {
  flex: 1 1 auto;
  min-width: 0;
}

.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.sec {
  color: v-bind('theme.textColor3');
  font-size: 13px;
  white-space: nowrap;
}

.review {
  padding: 16px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
}

.reviewCol {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.h2 {
  margin: 0;
  font-size: 16px;
}

.track {
  display: block;
  max-width: 420px;
  height: 10px;
  border-radius: 5px;
  background: v-bind('theme.dividerColor');
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: v-bind('theme.primaryColor');
}

.box {
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 6px;
  overflow: hidden;
}

.boxHead {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  background: v-bind('theme.actionColor');
}

.boxRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 42px;
  padding: 8px 14px;
  box-sizing: border-box;
  border-top: 1px solid v-bind('theme.dividerColor');
  font-size: 14px;
}

.boxMore {
  display: flex;
  justify-content: center;
  padding: 8px;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.boxMeta {
  font-size: 13px;
  color: v-bind('theme.textColor2');
  white-space: nowrap;
}

.note {
  border-radius: 6px;
  background: v-bind('theme.actionColor');
  padding: 12px 14px;
  font-size: 15px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.work {
  display: grid;
  grid-template-columns: 460px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.cardHead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  font-size: 15px;
}

.empty {
  padding: 28px 0;
}

.er {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 16px;
  border: 0;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.er:last-child {
  border-bottom: 0;
}

.er:hover:not(.cur) {
  background: v-bind('theme.hoverColor');
}

.er.cur {
  cursor: default;
  padding: 14px 16px 16px;
  gap: 10px;
  background: rgba(47, 111, 214, 0.06);
  box-shadow: inset 3px 0 0 #2f6fd6;
}

.erMeta {
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.big {
  font-size: 19px;
  line-height: 1.9;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}

.lv1 {
  background: rgba(230, 90, 70, 0.55);
}

.lv2 {
  background: rgba(230, 90, 70, 0.32);
}

.lv3 {
  background: rgba(230, 90, 70, 0.16);
}

.verdict {
  display: flex;
  gap: 14px;
  font-size: 13px;
}

.okText {
  color: v-bind('theme.primaryColor');
}

.noText {
  color: #c0392b;
}

.kwRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kw {
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 14px;
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}

.kw.on {
  border-color: #d9776a;
  background: rgba(230, 90, 70, 0.14);
  color: #b0392b;
  font-weight: 600;
}

.tabs {
  display: flex;
  gap: 22px;
  padding: 0 16px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.tab {
  height: 44px;
  padding: 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: v-bind('theme.textColor2');
  cursor: pointer;
}

.tab.on {
  border-bottom-color: v-bind('theme.primaryColor');
  color: v-bind('theme.primaryColor');
  font-weight: 600;
}

.filters {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.labelFilter {
  width: 130px;
}

.tr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px auto 64px;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 8px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  font-size: 14px;
}

.tr.gone .ell {
  color: v-bind('theme.textColor3');
  text-decoration: line-through;
}

.ell {
  /* 句子完整显示、折行：短信一条三四十个字，判断诈骗的「点击链接」「转账」常在后半截 */
  min-width: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

mark {
  background: rgba(230, 90, 70, 0.16);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

.tag {
  justify-self: start;
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.tag.changed {
  background: rgba(240, 160, 32, 0.18);
  color: #8a5200;
}

.tag.added {
  background: rgba(47, 111, 214, 0.14);
  color: #1e4f9c;
}

.tag.gone {
  background: v-bind('theme.actionColor');
  color: v-bind('theme.textColor3');
}

.more {
  display: flex;
  justify-content: center;
  padding: 8px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.addRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: v-bind('theme.actionColor');
  border-radius: 0 0 8px 8px;
}

/* 手机能打开、一栏往下排，不专门优化（设计文档第 2 节第 7 条） */
@media (max-width: 900px) {
  .work,
  .review {
    grid-template-columns: minmax(0, 1fr);
  }
  .tr {
    grid-template-columns: minmax(0, 1fr) auto 64px;
  }
  .tr > .tag,
  .tr > span:nth-child(2) {
    display: none;
  }
  .addRow {
    flex-wrap: wrap;
  }
}
</style>
