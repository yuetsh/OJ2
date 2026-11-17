<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import {
  LABELING_MAX_ITEMS,
  LABELING_MAX_LABEL_LENGTH,
  LABELING_MAX_LABELS,
  LABELING_SUGGESTED_ITEMS,
  type AdminLabeling,
  type LabelingItemInput,
  type LabelingKind,
  type SaveLabelingRequest,
} from '@oj2/contract'
import MarkdownEditor from 'shared/components/MarkdownEditor.vue'
import { errorMessage } from 'utils/api'
import LabelingImage from 'oj/labeling/components/LabelingImage.vue'
import SpanPicker from 'oj/labeling/components/SpanPicker.vue'
import SpanText from 'oj/labeling/components/SpanText.vue'
import PageHeader from '../components/PageHeader.vue'
import PreviewStrip from '../problem/components/PreviewStrip.vue'
import { usePreviewCollapsed } from '../problem/components/previewCollapse'
import { getAdminLabeling, saveAdminLabeling, uploadLabelingImage } from '../api'
import { parsePaste } from './paste'
import { shrinkImage } from './shrink'

/**
 * 后台「数据标注」出题页（画布 LabelEditText / LabelEditImage / LabelEditSpan）：左边写，右边是点中那一条
 * 学生看到的样子。规则见 docs/specs/2026-11-17-data-labeling-lab-design.md 第 5 节、3.5 节。
 *
 * - 整节一个「保存」；图片上传是即时的（传一张 = 在最后加一条，标签还没选）。
 * - 文字分类、实体标注能批量粘贴；列表里逐条改、拖动排序，顺序就是学生做的顺序。
 * - 还有没选标签的条目时，「学生可见」打不开。
 */
const props = defineProps<{ labelingID: string }>()

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const theme = useThemeVars()

type ItemForm = LabelingItemInput & { key: number; hasImage: boolean }

const labeling = ref<AdminLabeling | null>(null)
const form = reactive<{ title: string; description: string; isPublic: boolean; labels: string[]; items: ItemForm[] }>({
  title: '',
  description: '',
  isPublic: false,
  labels: [],
  items: [],
})
const selectedKey = ref<number | null>(null)
const saving = ref(false)
let nextKey = 1
let baseline = ''

const previewCollapsed = usePreviewCollapsed()
const labelingId = computed(() => Number(props.labelingID))
const kind = computed<LabelingKind>(() => labeling.value?.kind ?? 'text')
const labelWord = computed(() => (kind.value === 'span' ? '类别' : '标签'))
const KIND_TEXT: Record<LabelingKind, string> = { text: '文字分类', image: '图片分类', span: '实体标注' }

// ---------------------------------------------------------------- 读、存

function toForm(data: AdminLabeling) {
  labeling.value = data
  form.title = data.title
  form.description = data.description
  form.isPublic = data.isPublic
  form.labels = [...data.labels]
  form.items = data.items.map(({ id, text, hasImage, answer, spans, reason }) => ({ id, text, hasImage, answer, spans, reason, key: nextKey++ }))
  baseline = snapshot()
}

function toBody(): SaveLabelingRequest {
  return {
    title: form.title,
    description: form.description,
    isPublic: form.isPublic,
    labels: form.labels,
    items: form.items.map(({ id, text, answer, spans, reason }) => ({ id, text, answer, spans, reason })),
  }
}

function snapshot() {
  return JSON.stringify(toBody())
}

const dirty = computed(() => labeling.value !== null && snapshot() !== baseline)
const unlabeled = computed(() => (kind.value === 'span' ? 0 : form.items.filter((item) => item.answer === null).length))

watch(unlabeled, (n) => {
  if (n && form.isPublic) form.isPublic = false
})

async function load() {
  toForm(await getAdminLabeling(labelingId.value))
  selectedKey.value = form.items[0]?.key ?? null
}

async function save() {
  saving.value = true
  try {
    const saved = await saveAdminLabeling(labelingId.value, toBody())
    // 新建的条目拿回 id；顺序和发出去的一样
    saved.items.forEach((item, i) => {
      if (form.items[i]) form.items[i].id = item.id
    })
    labeling.value = saved
    baseline = snapshot()
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
async function go(name: 'labeling' | 'labeling progress') {
  if (dirty.value && !(await save())) return
  router.push({ name, params: { labelingID: props.labelingID } })
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

function usesLabel(item: ItemForm, label: string) {
  return item.answer === label || item.spans.some((s) => s.label === label)
}

function removeLabel(label: string) {
  const used = form.items.findIndex((item) => usesLabel(item, label))
  if (used >= 0) return message.warning(`第 ${used + 1} 条在用「${label}」，先改掉再删`)
  form.labels = form.labels.filter((l) => l !== label)
}

// ---------------------------------------------------------------- 条目

const selected = computed(() => form.items.find((item) => item.key === selectedKey.value) ?? null)
const selectedIndex = computed(() => form.items.findIndex((item) => item.key === selectedKey.value))
const labelOptions = computed(() => form.labels.map((l) => ({ label: l, value: l })))

function addItem() {
  if (form.items.length >= LABELING_MAX_ITEMS) return message.warning(`一节最多 ${LABELING_MAX_ITEMS} 条`)
  const item: ItemForm = { key: nextKey++, text: '', hasImage: false, answer: null, spans: [], reason: '' }
  form.items.push(item)
  selectedKey.value = item.key
}

function removeItem(item: ItemForm) {
  form.items = form.items.filter((i) => i !== item)
  if (selectedKey.value === item.key) selectedKey.value = form.items[0]?.key ?? null
}

function select(item: ItemForm) {
  selectedKey.value = selectedKey.value === item.key ? null : item.key
}

/** 改了句子的字，原来标的段就对不上了，清掉重标 */
function changeSpanText(item: ItemForm, text: string) {
  if (text !== item.text) item.spans = []
  item.text = text
}

// 拖动排序
const dragKey = ref<number | null>(null)

function drop(target: ItemForm) {
  const from = form.items.findIndex((item) => item.key === dragKey.value)
  dragKey.value = null
  const to = form.items.indexOf(target)
  if (from < 0 || to < 0 || from === to) return
  const next = [...form.items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  form.items = next
}

function dragProps(item: ItemForm) {
  return {
    draggable: true,
    onDragstart: () => (dragKey.value = item.key),
    onDragend: () => (dragKey.value = null),
    onDragover: (e: DragEvent) => e.preventDefault(),
    onDrop: () => drop(item),
  }
}

// ---------------------------------------------------------------- 批量粘贴

const pasteText = ref('')
const pasteAdded = ref<number | null>(null)
const pasteErrors = ref<string[]>([])

function applyPaste() {
  const { items, errors } = parsePaste(kind.value, pasteText.value, form.labels)
  const room = LABELING_MAX_ITEMS - form.items.length
  const taken = items.slice(0, Math.max(0, room))
  if (items.length > taken.length) errors.push(`一节最多 ${LABELING_MAX_ITEMS} 条，后面 ${items.length - taken.length} 条没加`)
  const added = taken.map((item) => ({ ...item, key: nextKey++, hasImage: false }))
  form.items.push(...added)
  newKeys.value = new Set(added.map((item) => item.key))
  pasteAdded.value = added.length
  pasteErrors.value = errors
  // 全加上了就清空，有没加的留着改
  if (!errors.length) pasteText.value = ''
}

const newKeys = ref(new Set<number>())

// ---------------------------------------------------------------- 图片

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref<{ done: number; total: number } | null>(null)

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  uploading.value = { done: 0, total: files.length }
  const added: number[] = []
  for (const file of files) {
    try {
      const item = await uploadLabelingImage(labelingId.value, await shrinkImage(file))
      const formItem: ItemForm = { ...item, key: nextKey++ }
      form.items.push(formItem)
      added.push(formItem.key)
      // 传上去就已经在库里了：保存基线跟着加上，免得只传了图也算「有改动没保存」
      // 服务器同时把这一节收回成不公开（新图还没选标签），基线也跟着改
      const base = JSON.parse(baseline) as SaveLabelingRequest
      base.isPublic = false
      base.items.push({ id: item.id, text: item.text, answer: item.answer, spans: item.spans, reason: item.reason })
      baseline = JSON.stringify(base)
    } catch (err) {
      message.error(`${file.name}：${errorMessage(err, '没传上')}`)
    }
    uploading.value = { done: uploading.value.done + 1, total: files.length }
  }
  newKeys.value = new Set(added)
  uploading.value = null
}

onMounted(() => {
  load().catch((err) => message.error(errorMessage(err, '打不开')))
})
</script>

<template>
  <PageHeader :title="labeling ? '编辑数据标注' : '数据标注'" :back="{ name: 'admin labeling list' }">
    <template #extra>
      <n-text v-if="labeling" depth="3" class="small">{{ labeling.createdBy.username }} 出的</n-text>
    </template>
  </PageHeader>

  <div v-if="labeling" class="editor" :class="{ collapsed: previewCollapsed }">
    <!-- 左：写 -->
    <div class="write">
      <section class="card">
        <div class="row">
          <n-input v-model:value="form.title" placeholder="标题" aria-label="标题" maxlength="128" class="grow" />
          <label class="switch">
            <n-switch v-model:value="form.isPublic" size="small" :disabled="unlabeled > 0" />
            <span>学生可见</span>
          </label>
        </div>
        <n-text v-if="unlabeled" class="warn small right">还有 {{ unlabeled }} {{ kind === 'image' ? '张' : '条' }}没选标签</n-text>
        <MarkdownEditor v-model:value="form.description" height="110px" />
        <div class="row">
          <span class="label">类型</span>
          <b class="small">{{ KIND_TEXT[kind] }}</b>
        </div>
        <div class="row wrap">
          <span class="label">{{ labelWord }}</span>
          <n-tag v-for="label in form.labels" :key="label" closable :bordered="true" @close="removeLabel(label)">{{ label }}</n-tag>
          <n-input
            v-if="form.labels.length < LABELING_MAX_LABELS"
            v-model:value="newLabel"
            size="small"
            :maxlength="LABELING_MAX_LABEL_LENGTH"
            :placeholder="`+ 加${labelWord}`"
            class="labelInput"
            @keyup.enter="addLabel"
            @blur="addLabel"
          />
        </div>
      </section>

      <section v-if="kind !== 'image'" class="card">
        <div class="row">
          <h3>批量粘贴</h3>
          <n-text depth="3" class="small">{{
            kind === 'span' ? '每行一句，要标的写成 [李白](人名)，理由放在后面（可以不写）' : '每行一条：文字、标签、理由（理由可以不写）'
          }}</n-text>
        </div>
        <n-input v-model:value="pasteText" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" class="mono" aria-label="批量粘贴" />
        <div class="row wrap">
          <n-button :disabled="!pasteText.trim() || form.labels.length < 2" @click="applyPaste">加进列表</n-button>
          <n-text v-if="pasteAdded !== null" class="ok small">加了 {{ pasteAdded }} {{ kind === 'span' ? '句' : '条' }}</n-text>
          <n-text v-for="e in pasteErrors" :key="e" class="warn small">{{ e }}</n-text>
        </div>
      </section>

      <section class="card list">
        <div class="row pad">
          <h3>{{ kind === 'image' ? '图片' : kind === 'span' ? '句子' : '数据' }}</h3>
          <n-text depth="3" class="small">{{ form.items.length }} {{ kind === 'image' ? '张' : kind === 'span' ? '句' : '条' }}</n-text>
          <n-text v-if="form.items.length > LABELING_SUGGESTED_ITEMS" class="warn small">超过 {{ LABELING_SUGGESTED_ITEMS }} 条，一节课可能做不完</n-text>
          <span class="grow"></span>
          <template v-if="kind === 'image'">
            <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="uploadImages" />
            <n-button size="small" :loading="!!uploading" @click="fileInput?.click()">
              {{ uploading ? `传了 ${uploading.done} / ${uploading.total}` : '+ 选图片（可以多选）' }}
            </n-button>
          </template>
          <n-button v-else size="small" @click="addItem">+ 加{{ kind === 'span' ? '一句' : '一条' }}</n-button>
        </div>

        <!-- 图片：四列缩略图 -->
        <div v-if="kind === 'image'" class="imageGrid">
          <div
            v-for="(item, i) in form.items"
            :key="item.key"
            class="imageCard"
            :class="{ need: item.answer === null, on: item.key === selectedKey, fresh: newKeys.has(item.key) }"
            v-bind="dragProps(item)"
          >
            <button type="button" class="thumb" :aria-label="`第 ${i + 1} 张`" @click="select(item)">
              <span class="no">{{ i + 1 }}</span>
              <LabelingImage v-if="item.id" :labeling-id="labelingId" :item-id="item.id" />
            </button>
            <div class="cardFoot">
              <n-select
                v-model:value="item.answer"
                size="small"
                :options="labelOptions"
                placeholder="选标签"
                :status="item.answer === null ? 'warning' : undefined"
              />
              <n-button size="small" type="error" ghost :aria-label="`删除第 ${i + 1} 张`" @click="removeItem(item)">×</n-button>
            </div>
            <button type="button" class="reasonLine" @click="select(item)">{{ item.reason || '+ 写理由' }}</button>
          </div>
        </div>

        <!-- 文字 / 实体标注：一行一条，点开改 -->
        <template v-else>
          <template v-for="(item, i) in form.items" :key="item.key">
            <div class="it" :class="{ on: item.key === selectedKey, fresh: newKeys.has(item.key) }" v-bind="dragProps(item)">
              <span class="drag" aria-hidden="true"><Icon icon="ph:dots-six-vertical-bold" width="16" /></span>
              <span class="no">{{ i + 1 }}</span>
              <button type="button" class="txt" @click="select(item)">
                <SpanText v-if="kind === 'span'" :text="item.text || '（空的）'" :spans="item.spans" :labels="form.labels" />
                <span v-else class="ell">{{ item.text || '（空的）' }}</span>
                <span class="reason">{{ item.reason || '+ 写理由' }}</span>
              </button>
              <n-select
                v-if="kind === 'text'"
                v-model:value="item.answer"
                size="small"
                :options="labelOptions"
                placeholder="选标签"
                class="answerSelect"
                :status="item.answer === null ? 'warning' : undefined"
              />
              <n-button size="small" type="error" ghost @click="removeItem(item)">删除</n-button>
            </div>
            <div v-if="item.key === selectedKey" class="editBox">
              <template v-if="kind === 'span'">
                <SpanPicker v-model="item.spans" :text="item.text" :labels="form.labels" compact />
                <n-input
                  :value="item.text"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  placeholder="这一句的文字（改了字，标的段要重标）"
                  @update:value="(v: string) => changeSpanText(item, v)"
                />
              </template>
              <n-input v-else v-model:value="item.text" type="textarea" :autosize="{ minRows: 1, maxRows: 5 }" placeholder="文字" />
              <div class="row">
                <span class="label">理由</span>
                <n-input v-model:value="item.reason" size="small" placeholder="标对后给学生看的一句话（可以不写）" />
              </div>
            </div>
          </template>
        </template>

        <!-- 图片的理由：点中那张在下面改 -->
        <div v-if="kind === 'image' && selected" class="editBox">
          <div class="row">
            <span class="label">第 {{ selectedIndex + 1 }} 张的理由</span>
            <n-input v-model:value="selected.reason" size="small" placeholder="标对后给学生看的一句话（可以不写）" />
          </div>
        </div>

        <n-empty v-if="!form.items.length" :description="kind === 'image' ? '还没有图片' : '还没有数据'" class="empty" />
      </section>

      <div class="saveBar">
        <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存</n-button>
        <n-text depth="3" class="small">{{ dirty ? '有改动还没保存' : '都存好了' }}</n-text>
        <span class="grow"></span>
        <n-button @click="go('labeling')">试做</n-button>
        <n-button @click="go('labeling progress')">看全班</n-button>
      </div>
    </div>

    <!-- 右：点中那一条，学生看到的样子 -->
    <aside v-show="!previewCollapsed" class="preview">
      <div class="row">
        <b>学生看到的样子</b>
        <n-text v-if="selected" depth="3" class="small">第 {{ selectedIndex + 1 }} 条</n-text>
        <span class="grow"></span>
        <n-button size="small" quaternary title="收起，专心写左边" @click="previewCollapsed = true">收起 ›</n-button>
      </div>
      <div v-if="selected" class="phone">
        <b class="phoneTitle">{{ form.title }}</b>
        <template v-if="kind === 'span'">
          <div class="phoneText"><SpanText :text="selected.text" :spans="selected.spans" :labels="form.labels" /></div>
        </template>
        <template v-else>
          <div v-if="selected.hasImage && selected.id" class="phoneImage"><LabelingImage :labeling-id="labelingId" :item-id="selected.id" /></div>
          <div v-else class="phoneText">{{ selected.text }}</div>
          <div class="phoneOpts" :class="{ grid: form.labels.length > 2 }">
            <span
              v-for="label in form.labels"
              :key="label"
              class="phoneOpt"
              :class="{ ok: label === selected.answer, dim: selected.answer !== null && label !== selected.answer }"
            >
              <Icon v-if="label === selected.answer" icon="ph:check-bold" />{{ label }}
            </span>
          </div>
        </template>
        <div v-if="selected.reason" class="phoneReason">{{ selected.reason }}</div>
      </div>
      <n-text v-else depth="3">点左边一条看看</n-text>
    </aside>
    <PreviewStrip v-if="previewCollapsed" @expand="previewCollapsed = false" />
  </div>
</template>

<style scoped>
.small {
  font-size: 12px;
}

.right {
  align-self: flex-end;
  margin-top: -4px;
}

.warn {
  color: #b86e00;
}

.ok {
  color: v-bind('theme.primaryColor');
}

/* 和「数据分析」出题页一样：写的一边大，看的一边小，右栏能收起 */
.editor {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: start;
}

.editor.collapsed {
  grid-template-columns: minmax(0, 1fr) 36px;
}

@media (max-width: 1180px) {
  .editor,
  .editor.collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
}

.write {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
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
  padding: 10px 6px 6px;
  gap: 6px;
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
  padding: 0 10px;
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

/* MarkdownEditor 自带 300px 的最小高度，是给教程正文那种长文的；这里只写一两句说明 */
.card :deep(.editor-box) {
  min-height: 0;
}

.mono :deep(textarea) {
  font-family: ui-monospace, Consolas, 'Microsoft YaHei', monospace;
  font-size: 13px;
  tab-size: 6;
}

.it {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  font-size: 14px;
}

.it.on {
  background: v-bind('theme.hoverColor');
  box-shadow: inset 3px 0 0 #2f6fd6;
}

.it.fresh,
.imageCard.fresh {
  background: rgba(24, 160, 88, 0.07);
}

.drag {
  display: flex;
  padding-top: 5px;
  opacity: 0.4;
  cursor: grab;
}

.no {
  width: 22px;
  flex-shrink: 0;
  text-align: right;
  line-height: 26px;
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.txt {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  line-height: 26px;
}

.ell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reason {
  font-size: 12px;
  line-height: 18px;
  color: v-bind('theme.textColor3');
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.answerSelect {
  width: 100px;
  flex-shrink: 0;
}

.editBox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 12px 56px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  background: v-bind('theme.actionColor');
}

.imageGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 4px 10px 10px;
}

@media (max-width: 760px) {
  .imageGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.imageCard {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: grab;
}

.imageCard.need {
  border-color: #e08a00;
  box-shadow: 0 0 0 1px #e08a00;
}

.imageCard.on {
  border-color: #2f6fd6;
  box-shadow: 0 0 0 1px #2f6fd6;
}

.thumb {
  position: relative;
  height: 108px;
  padding: 0;
  border: 0;
  background: v-bind('theme.actionColor');
  cursor: pointer;
}

.thumb .no {
  position: absolute;
  left: 6px;
  top: 6px;
  z-index: 1;
  width: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 10px;
  background: rgba(31, 34, 37, 0.72);
  color: #ffffff;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.cardFoot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
}

.reasonLine {
  padding: 0 6px 6px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: v-bind('theme.textColor3');
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.empty {
  padding: 24px 0;
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

.preview {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.phone {
  width: 100%;
  max-width: 390px;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 18px;
  background: v-bind('theme.bodyColor');
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.phoneTitle {
  font-size: 18px;
  line-height: 1.4;
}

.phoneText {
  padding: 20px 16px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 10px;
  background: v-bind('theme.cardColor');
  font-size: 18px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.phoneImage {
  height: 260px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 10px;
  overflow: hidden;
  background: v-bind('theme.cardColor');
}

.phoneOpts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phoneOpts.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.phoneOpt {
  height: 50px;
  box-sizing: border-box;
  border: 1.5px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
  font-size: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.phoneOpt.ok {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.12);
  color: v-bind('theme.primaryColor');
  font-weight: 700;
}

.phoneOpt.dim {
  opacity: 0.45;
}

.phoneReason {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 15px;
  line-height: 1.7;
  background: rgba(24, 160, 88, 0.12);
}
</style>
