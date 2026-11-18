<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import {
  MODEL_TRAINING_MAX_ITEMS,
  MODEL_TRAINING_MAX_LABEL_LENGTH,
  MODEL_TRAINING_MAX_LABELS,
  MODEL_TRAINING_MAX_TEXT,
  accuracyPercent,
  countCorrect,
  trainModel,
  type AdminModelTraining,
  type ModelTrainingItemInput,
  type ModelTrainingSplit,
  type SaveModelTrainingRequest,
} from '@oj2/contract'
import MarkdownEditor from 'shared/components/MarkdownEditor.vue'
import { errorMessage } from 'utils/api'
import PageHeader from '../components/PageHeader.vue'
import { getAdminModelTraining, saveAdminModelTraining } from '../api'
import { parsePaste } from './paste'

/**
 * 后台「训练模型」出题页（画布 TrainEdit）：左边写，右边是试跑。规则见 docs/specs/2026-11-17-model-training-lab-design.md 第 5 节。
 *
 * - 三份数据分页签：训练 / 练习测试 / 最后考。训练数据「给学生的标签」和「正确标签」不一样的就是故意标错的（标橙）。
 * - 试跑在浏览器里算（朴素贝叶斯在契约里，和服务器同一份）：用给学生的标签训练 = 学生的起点；全改对 = 上限。
 *   达标线定在两者之间，高于上限的话服务器不让公开。
 */
const props = defineProps<{ modelTrainingID: string }>()

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const theme = useThemeVars()

type ItemForm = ModelTrainingItemInput & { key: number }

const lesson = ref<AdminModelTraining | null>(null)
const form = reactive<{
  title: string
  description: string
  review: string
  isPublic: boolean
  labels: string[]
  threshold: number
  items: ItemForm[]
}>({ title: '', description: '', review: '', isPublic: false, labels: [], threshold: 80, items: [] })
const saving = ref(false)
let nextKey = 1
let baseline = ''

const lessonId = computed(() => Number(props.modelTrainingID))
const SPLIT_TEXT: Record<ModelTrainingSplit, string> = { train: '训练', practice: '练习测试', final: '最后考' }
const SPLITS: ModelTrainingSplit[] = ['train', 'practice', 'final']

// ---------------------------------------------------------------- 读、存

function toForm(data: AdminModelTraining) {
  lesson.value = data
  form.title = data.title
  form.description = data.description
  form.review = data.review
  form.isPublic = data.isPublic
  form.labels = [...data.labels]
  form.threshold = data.threshold
  form.items = data.items.map((item) => ({ ...item, key: nextKey++ }))
  baseline = snapshot()
}

function toBody(): SaveModelTrainingRequest {
  return {
    title: form.title,
    description: form.description,
    review: form.review,
    isPublic: form.isPublic,
    labels: form.labels,
    threshold: form.threshold,
    items: form.items.map(({ id, split, text, shown, answer }) => ({ id, split, text, shown: split === 'train' ? shown : null, answer })),
  }
}

function snapshot() {
  return JSON.stringify(toBody())
}

const dirty = computed(() => lesson.value !== null && snapshot() !== baseline)

async function load() {
  toForm(await getAdminModelTraining(lessonId.value))
}

async function save() {
  saving.value = true
  try {
    toForm(await saveAdminModelTraining(lessonId.value, toBody()))
    message.success('存好了')
    return true
  } catch (err) {
    message.error(errorMessage(err, '没存上'))
    return false
  } finally {
    saving.value = false
  }
}

/** 试做 / 看全班要的是存好的内容：有改动先存 */
async function go(name: 'model training' | 'model training progress') {
  if (dirty.value && !(await save())) return
  router.push({ name, params: { modelTrainingID: props.modelTrainingID } })
}

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return new Promise<boolean>((resolve) => {
    dialog.warning({
      title: '还没保存',
      content: '改的东西还没保存，离开就没了。',
      positiveText: '不要了，离开',
      negativeText: '留下来',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
})

// ---------------------------------------------------------------- 标签

const newLabel = ref('')

function addLabel() {
  const label = newLabel.value.trim()
  if (!label) return
  if (form.labels.includes(label)) return message.warning(`已经有「${label}」了`)
  form.labels.push(label)
  newLabel.value = ''
}

function removeLabel(label: string) {
  const used = form.items.findIndex((item) => item.answer === label || (item.split === 'train' && item.shown === label))
  if (used >= 0) return message.warning(`有数据在用「${label}」，先改掉再删`)
  form.labels = form.labels.filter((l) => l !== label)
}

// ---------------------------------------------------------------- 数据

const tab = ref<ModelTrainingSplit>('train')
const onlyWrong = ref(false)
const pageSize = 100
const shownCount = ref(pageSize)
const editingKey = ref<number | null>(null)

const counts = computed(() => Object.fromEntries(SPLITS.map((s) => [s, form.items.filter((i) => i.split === s).length])) as Record<ModelTrainingSplit, number>)
const mislabeled = computed(() => form.items.filter((i) => i.split === 'train' && i.shown !== i.answer))
const tabItems = computed(() => form.items.filter((i) => i.split === tab.value && (!onlyWrong.value || tab.value !== 'train' || i.shown !== i.answer)))
const visibleItems = computed(() => tabItems.value.slice(0, shownCount.value))
const shownCounts = computed(() =>
  form.labels.map((label) => ({ label, n: form.items.filter((i) => i.split === tab.value && (tab.value === 'train' ? i.shown : i.answer) === label).length })),
)

watch([tab, onlyWrong], () => {
  shownCount.value = pageSize
  editingKey.value = null
})

function addItem() {
  if (form.items.length >= MODEL_TRAINING_MAX_ITEMS) return message.warning(`一节最多 ${MODEL_TRAINING_MAX_ITEMS} 条`)
  const label = form.labels[0] ?? ''
  const item: ItemForm = { key: nextKey++, split: tab.value, text: '', shown: tab.value === 'train' ? label : null, answer: label }
  onlyWrong.value = false
  form.items.push(item)
  editingKey.value = item.key
  shownCount.value = Math.max(shownCount.value, tabItems.value.length)
}

function removeItem(item: ItemForm) {
  form.items = form.items.filter((i) => i !== item)
}

function moveTo(item: ItemForm, split: ModelTrainingSplit) {
  item.split = split
  item.shown = split === 'train' ? item.answer : null
}

const pasteText = ref('')
const pasteAdded = ref<string | null>(null)
const pasteErrors = ref<string[]>([])

function applyPaste() {
  const { items, errors } = parsePaste(pasteText.value, form.labels)
  const room = MODEL_TRAINING_MAX_ITEMS - form.items.length
  const taken = items.slice(0, Math.max(0, room))
  if (items.length > taken.length) errors.push(`一节最多 ${MODEL_TRAINING_MAX_ITEMS} 条，后面 ${items.length - taken.length} 条没加`)
  form.items.push(...taken.map((item) => ({ ...item, key: nextKey++ })))
  const by = SPLITS.map((s) => [SPLIT_TEXT[s], taken.filter((i) => i.split === s).length] as const).filter(([, n]) => n)
  pasteAdded.value = taken.length ? `加了 ${taken.length} 条（${by.map(([t, n]) => `${t} ${n}`).join(' · ')}）` : null
  pasteErrors.value = errors
  if (!errors.length) pasteText.value = ''
}

// ---------------------------------------------------------------- 试跑（浏览器里算）

const trial = computed(() => {
  const labels = form.labels
  const train = form.items.filter((i) => i.split === 'train' && i.text.trim())
  const final = form.items.filter((i) => i.split === 'final' && i.text.trim())
  if (labels.length < 2 || !train.length || !final.length) return null
  const start = trainModel(
    labels,
    train.map((i) => ({ text: i.text, label: i.shown ?? i.answer })),
  )
  const fixed = trainModel(
    labels,
    train.map((i) => ({ text: i.text, label: i.answer })),
  )
  const startPct = accuracyPercent(countCorrect(start, final), final.length)
  const ceiling = accuracyPercent(countCorrect(fixed, final), final.length)
  // 建议：从起点往上走四分之三，学生得找出大半的毛病才够得着
  const suggest = Math.max(startPct + 1, Math.min(ceiling, Math.round(startPct + (ceiling - startPct) * 0.75)))
  return { start: startPct, ceiling, suggest }
})
const trialDebounced = refDebounced(trial, 400)
const tooHigh = computed(() => !!trialDebounced.value && form.threshold > trialDebounced.value.ceiling)

const scaleFrom = computed(() => (trialDebounced.value && trialDebounced.value.start < 50 ? 0 : 50))
function at(value: number) {
  return `${Math.max(0, Math.min(100, ((value - scaleFrom.value) / (100 - scaleFrom.value)) * 100))}%`
}

const testCounts = computed(() =>
  (['practice', 'final'] as const).map((split) => ({
    split,
    total: counts.value[split],
    by: form.labels.map((label) => ({ label, n: form.items.filter((i) => i.split === split && i.answer === label).length })),
  })),
)

onMounted(() => {
  load().catch((err) => message.error(errorMessage(err, '打不开')))
})
</script>

<template>
  <PageHeader :title="lesson ? '编辑训练模型' : '训练模型'" :back="{ name: 'admin model training list' }">
    <template #extra>
      <n-text v-if="lesson" depth="3" class="small">{{ lesson.createdBy.username }} 出的</n-text>
    </template>
  </PageHeader>

  <div v-if="lesson" class="editor">
    <!-- 左：写 -->
    <div class="write">
      <section class="card">
        <div class="row">
          <n-input v-model:value="form.title" placeholder="标题" aria-label="标题" maxlength="128" class="grow" />
          <label class="switch">
            <n-switch v-model:value="form.isPublic" size="small" />
            <span>学生可见</span>
          </label>
        </div>
        <MarkdownEditor v-model:value="form.description" height="110px" />
        <div class="row wrap">
          <span class="label">标签</span>
          <n-tag v-for="label in form.labels" :key="label" closable :bordered="true" @close="removeLabel(label)">{{ label }}</n-tag>
          <n-input
            v-if="form.labels.length < MODEL_TRAINING_MAX_LABELS"
            v-model:value="newLabel"
            size="small"
            :maxlength="MODEL_TRAINING_MAX_LABEL_LENGTH"
            placeholder="+ 加标签"
            class="labelInput"
            @keyup.enter="addLabel"
            @blur="addLabel"
          />
        </div>
      </section>

      <section class="card">
        <div class="row">
          <h3>批量粘贴</h3>
          <n-text depth="3" class="small">每行一条：句子、给学生的标签、正确标签、用在哪（训练 / 练习 / 考试）</n-text>
        </div>
        <n-input v-model:value="pasteText" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" class="mono" aria-label="批量粘贴" />
        <div class="row wrap">
          <n-button :disabled="!pasteText.trim() || form.labels.length < 2" @click="applyPaste">加进列表</n-button>
          <n-text v-if="pasteAdded" class="ok small">{{ pasteAdded }}</n-text>
          <n-text v-for="e in pasteErrors.slice(0, 8)" :key="e" class="warn small">{{ e }}</n-text>
          <n-text v-if="pasteErrors.length > 8" class="warn small">还有 {{ pasteErrors.length - 8 }} 行没加</n-text>
        </div>
      </section>

      <section class="card list">
        <div class="tabs">
          <button v-for="s in SPLITS" :key="s" type="button" class="tab" :class="{ on: tab === s }" @click="tab = s">
            {{ SPLIT_TEXT[s] }} {{ counts[s] }}
          </button>
          <span class="grow"></span>
          <n-button size="small" @click="addItem">+ 加一条</n-button>
        </div>
        <div class="row pad small">
          <n-text depth="3">{{ tab === 'train' ? '给学生看的' : '正确标签' }}</n-text>
          <span>{{ shownCounts.map((c) => `${c.label} ${c.n}`).join(' · ') }}</span>
          <span class="grow"></span>
          <button v-if="tab === 'train'" type="button" class="toggle" :class="{ on: onlyWrong }" @click="onlyWrong = !onlyWrong">
            只看故意标错的 {{ mislabeled.length }}
          </button>
        </div>
        <div class="dh" :class="{ test: tab !== 'train' }">
          <span>句子</span>
          <span v-if="tab === 'train'">给学生</span>
          <span>正确</span>
          <span></span>
        </div>
        <template v-for="item in visibleItems" :key="item.key">
          <div class="dr" :class="{ bad: item.split === 'train' && item.shown !== item.answer, test: tab !== 'train' }">
            <button type="button" class="txt" @click="editingKey = editingKey === item.key ? null : item.key">{{ item.text || '（空的）' }}</button>
            <select v-if="tab === 'train'" v-model="item.shown" class="sel" :class="{ x: item.shown !== item.answer }" aria-label="给学生的标签">
              <option v-for="l in form.labels" :key="l" :value="l">{{ l }}</option>
            </select>
            <select v-model="item.answer" class="sel" aria-label="正确标签">
              <option v-for="l in form.labels" :key="l" :value="l">{{ l }}</option>
            </select>
            <n-button size="tiny" type="error" ghost @click="removeItem(item)">删除</n-button>
          </div>
          <div v-if="editingKey === item.key" class="editBox">
            <n-input v-model:value="item.text" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" :maxlength="MODEL_TRAINING_MAX_TEXT" placeholder="句子" />
            <div class="row small">
              <n-text depth="3">挪到</n-text>
              <n-button v-for="s in SPLITS.filter((x) => x !== item.split)" :key="s" size="tiny" @click="moveTo(item, s)">{{ SPLIT_TEXT[s] }}</n-button>
            </div>
          </div>
        </template>
        <n-empty v-if="!tabItems.length" description="还没有数据" class="empty" />
        <div v-if="tabItems.length > shownCount" class="more">
          <n-button size="small" @click="shownCount += pageSize">再显示 {{ Math.min(pageSize, tabItems.length - shownCount) }} 条</n-button>
        </div>
      </section>

      <section class="card">
        <h3>达标后给学生看的说明</h3>
        <n-input
          v-model:value="form.review"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          maxlength="2000"
          placeholder="说说这批数据还有哪些毛病，比如反话太少、好评比差评多太多"
        />
      </section>

      <div class="saveBar">
        <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存</n-button>
        <n-text depth="3" class="small">{{ dirty ? '有改动还没保存' : '都存好了' }}</n-text>
        <span class="grow"></span>
        <n-button @click="go('model training')">试做</n-button>
        <n-button @click="go('model training progress')">看全班</n-button>
      </div>
    </div>

    <!-- 右：试跑 -->
    <aside class="side">
      <section class="card">
        <h3>试跑</h3>
        <template v-if="trialDebounced">
          <div class="cards2">
            <div class="stat">
              <span class="small sub">用给学生的数据训练</span><b class="bigNum">{{ trialDebounced.start }}%</b><span class="small sub">学生的起点</span>
            </div>
            <div class="stat">
              <span class="small sub">全改对再训练</span><b class="bigNum">{{ trialDebounced.ceiling }}%</b
              ><span class="small sub">只改标错的、不补数据能到</span>
            </div>
          </div>
          <div class="scale">
            <div class="scaleBar">
              <span class="band" :style="{ left: at(trialDebounced.start), width: `calc(${at(trialDebounced.ceiling)} - ${at(trialDebounced.start)})` }"></span>
              <span class="tick" :style="{ left: at(trialDebounced.start) }"></span>
              <span class="tick" :style="{ left: at(trialDebounced.ceiling) }"></span>
              <span class="mark" :class="{ bad: tooHigh }" :style="{ left: at(form.threshold) }"></span>
            </div>
            <div class="scaleText small">
              <span>{{ scaleFrom }}%</span><span class="grow"></span><span>100%</span>
            </div>
          </div>
        </template>
        <n-text v-else depth="3" class="small">至少两个标签、训练和最后考都有数据，才算得出来</n-text>
        <div class="row">
          <label for="threshold" class="label">达标线</label>
          <n-input-number id="threshold" v-model:value="form.threshold" :min="1" :max="100" :show-button="false" size="small" class="threshold">
            <template #suffix>%</template>
          </n-input-number>
          <n-button v-if="trialDebounced && form.threshold !== trialDebounced.suggest" size="small" @click="form.threshold = trialDebounced.suggest">
            用建议的 {{ trialDebounced.suggest }}%
          </n-button>
        </div>
        <n-text v-if="tooHigh" class="warn small">高过上限了，全改对也到不了，学生看不到这一节</n-text>
      </section>

      <section class="card small">
        <h3>两份测试</h3>
        <div v-for="t in testCounts" :key="t.split" class="row">
          <n-text depth="3" class="testName">{{ SPLIT_TEXT[t.split] }}</n-text>
          <span
            >{{ t.total }} 条<template v-if="t.total">：{{ t.by.map((b) => `${b.label} ${b.n}`).join(' · ') }}</template></span
          >
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.small {
  font-size: 12px;
}

.warn {
  color: #b86e00;
}

.ok {
  color: v-bind('theme.primaryColor');
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: start;
}

@media (max-width: 1180px) {
  .editor {
    grid-template-columns: minmax(0, 1fr);
  }
}

.write,
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.side {
  position: sticky;
  top: 12px;
}

.card {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: v-bind('theme.cardColor');
}

.card h3 {
  margin: 0;
  font-size: 15px;
}

.card.list {
  padding: 4px 6px 6px;
  gap: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row.wrap {
  flex-wrap: wrap;
}

.row.pad {
  padding: 8px 10px;
}

.grow {
  flex: 1 1 auto;
  min-width: 0;
}

.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}

.label {
  font-size: 13px;
  color: v-bind('theme.textColor2');
  flex: none;
  min-width: 36px;
}

.labelInput {
  width: 110px;
}

.card :deep(.editor-box) {
  min-height: 0;
}

.mono :deep(textarea) {
  font-family: ui-monospace, Consolas, 'Microsoft YaHei', monospace;
  font-size: 13px;
  tab-size: 4;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 10px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.tab {
  height: 40px;
  padding: 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: v-bind('theme.textColor2');
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.tab.on {
  border-bottom-color: v-bind('theme.primaryColor');
  color: v-bind('theme.primaryColor');
  font-weight: 600;
}

.toggle {
  height: 26px;
  padding: 0 10px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 13px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind('theme.textColor2');
  cursor: pointer;
}

.toggle.on {
  border-color: #e9b46a;
  background: rgba(240, 160, 32, 0.16);
  color: #8a5200;
  font-weight: 600;
}

.dh,
.dr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 84px 52px;
  gap: 10px;
  align-items: center;
  padding: 0 10px;
}

.dh.test,
.dr.test {
  grid-template-columns: minmax(0, 1fr) 84px 52px;
}

.dh {
  height: 30px;
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.dr {
  min-height: 40px;
  border-top: 1px solid v-bind('theme.dividerColor');
  font-size: 13px;
}

.dr.bad {
  background: rgba(240, 160, 32, 0.1);
}

.txt {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sel {
  height: 26px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 4px;
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 13px;
  color: inherit;
}

.sel.x {
  border-color: #e9b46a;
  color: #8a5200;
  font-weight: 600;
}

.editBox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid v-bind('theme.dividerColor');
  background: v-bind('theme.actionColor');
}

.empty {
  padding: 24px 0;
}

.more {
  display: flex;
  justify-content: center;
  padding: 8px;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.saveBar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 -10px;
  padding: 10px;
  background: v-bind('theme.cardColor');
  border-top: 1px solid v-bind('theme.borderColor');
}

.cards2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.stat {
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 6px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sub {
  color: v-bind('theme.textColor3');
}

.bigNum {
  font-size: 30px;
  font-variant-numeric: tabular-nums;
}

.scale {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scaleBar {
  position: relative;
  height: 14px;
  border-radius: 7px;
  background: v-bind('theme.dividerColor');
}

.band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(24, 160, 88, 0.22);
}

.tick {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 20px;
  background: v-bind('theme.textColor3');
}

.mark {
  position: absolute;
  top: -5px;
  width: 4px;
  height: 24px;
  margin-left: -1px;
  border-radius: 2px;
  background: v-bind('theme.primaryColor');
}

.mark.bad {
  background: #d03050;
}

.scaleText {
  display: flex;
  color: v-bind('theme.textColor3');
}

.threshold {
  width: 90px;
}

.testName {
  width: 64px;
  flex-shrink: 0;
}
</style>
