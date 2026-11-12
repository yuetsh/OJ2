<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { AdminLab, LabAsset, LabCheckKind, LabRunResult, LabStepInput, LabTableOutput, SaveLabRequest } from '@oj2/contract'
import CodeEditor from 'shared/components/CodeEditor.vue'
import Markdown from 'shared/components/Markdown.vue'
import MarkdownEditor from 'shared/components/MarkdownEditor.vue'
import { errorMessage } from 'utils/api'
import LabOutputs from 'oj/lab/components/LabOutputs.vue'
import LabTable from 'oj/lab/components/LabTable.vue'
import LabVerdict from 'oj/lab/components/LabVerdict.vue'
import { downloadFile } from 'oj/lab/utils/download'
import PageHeader from '../components/PageHeader.vue'
import PreviewStrip from '../problem/components/PreviewStrip.vue'
import { usePreviewCollapsed } from '../problem/components/previewCollapse'
import { deleteLabAsset, getAdminLab, getLabAssetPreview, labAssetFileUrl, saveAdminLab, trialLabStep, uploadLabAsset } from '../api'

/**
 * 后台「数据分析」出题页，照画布 LabEdit：左边写，右边是学生看到的样子（和编程题出题页同一个结构）。
 * 规则见 docs/specs/2026-11-12-data-analysis-lab-design.md 第 3、6 节。
 *
 * - 整节一个「保存」；素材上传、删除是即时的（素材要先在库里，试跑才读得到）。
 * - 「试跑这一步」用编辑器里还没存的答案，从第 1 步跑到这一步；改了这一步或前面的步骤，结果就作废。
 */
const props = defineProps<{ labID: string }>()

const message = useMessage()
const dialog = useDialog()
const theme = useThemeVars()

type StepForm = LabStepInput & { key: number }

const lab = ref<AdminLab | null>(null)
const form = reactive<{ title: string; description: string; isPublic: boolean; steps: StepForm[] }>({
  title: '',
  description: '',
  isPublic: false,
  steps: [],
})
const assets = ref<LabAsset[]>([])
const openKey = ref<number | null>(null)
const saving = ref(false)
let nextKey = 1
let baseline = ''

const previewCollapsed = usePreviewCollapsed()
const labId = computed(() => Number(props.labID))

// ---------------------------------------------------------------- 读、存

function toForm(data: AdminLab) {
  lab.value = data
  form.title = data.title
  form.description = data.description
  form.isPublic = data.isPublic
  form.steps = data.steps.map((s) => ({ ...s, key: nextKey++ }))
  assets.value = data.assets
  baseline = snapshot()
}

function toBody(): SaveLabRequest {
  return {
    title: form.title,
    description: form.description,
    isPublic: form.isPublic,
    steps: form.steps.map(({ key: _key, ...step }) => step),
  }
}

function snapshot() {
  return JSON.stringify(toBody())
}

const dirty = computed(() => lab.value !== null && snapshot() !== baseline)

async function load() {
  toForm(await getAdminLab(labId.value))
  openKey.value = form.steps[0]?.key ?? null
}

async function save() {
  saving.value = true
  try {
    const saved = await saveAdminLab(labId.value, toBody())
    // 新建的步骤拿回 id；顺序和发出去的一样
    saved.steps.forEach((s, i) => {
      if (form.steps[i]) form.steps[i].id = s.id
    })
    lab.value = saved
    baseline = snapshot()
    message.success('存好了')
  } catch (err) {
    message.error(errorMessage(err, '没存上'))
  } finally {
    saving.value = false
  }
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

// ---------------------------------------------------------------- 步骤

function newStep(kind: 'normal' | 'open'): StepForm {
  return {
    key: nextKey++,
    kind,
    title: kind === 'open' ? '你来分析' : `第 ${form.steps.length + 1} 步`,
    description: '',
    starterCode: kind === 'open' ? '# 在这里写\n' : '',
    referenceCode: '',
    checkKind: kind === 'open' ? 'none' : 'compare',
    compareVars: [],
    compareFigure: null,
    checkScript: '',
  }
}

function addStep(kind: 'normal' | 'open') {
  const step = newStep(kind)
  form.steps.push(step)
  openKey.value = step.key
}

function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= form.steps.length) return
  const [step] = form.steps.splice(index, 1)
  form.steps.splice(target, 0, step!)
}

function removeStep(index: number) {
  const step = form.steps[index]!
  const drop = () => {
    form.steps.splice(index, 1)
    if (openKey.value === step.key) openKey.value = form.steps[Math.min(index, form.steps.length - 1)]?.key ?? null
  }
  if (step.id === undefined) return drop()
  dialog.warning({
    title: `删掉「${step.title}」？`,
    content: '保存之后，学生在这一步的代码和进度会一起删掉。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: drop,
  })
}

function checkSummary(step: StepForm) {
  if (step.kind === 'open') return '开放'
  if (step.checkKind === 'none') return '不检查'
  if (step.checkKind === 'script') return '检查脚本'
  const what = [...step.compareVars, ...(step.compareFigure ? ['图'] : [])]
  return what.length ? `比 ${what.join('、')}` : '对照答案（还没选比什么）'
}

/** 答案里赋过值的名字，「比什么」里直接点 */
function assignedNames(code: string) {
  const names = new Set<string>()
  for (const m of code.matchAll(/^([A-Za-z_]\w*)\s*=(?!=)/gm)) names.add(m[1]!)
  return [...names]
}

function toggleVar(step: StepForm, name: string) {
  step.compareVars = step.compareVars.includes(name) ? step.compareVars.filter((v) => v !== name) : [...step.compareVars, name]
}

function toggleFigure(step: StepForm) {
  step.compareFigure = step.compareFigure ? null : { values: true, title: true, labels: false }
}

const extraVar = ref('')
function addVar(step: StepForm) {
  const name = extraVar.value.trim()
  if (/^[A-Za-z_]\w*$/.test(name) && !step.compareVars.includes(name)) step.compareVars = [...step.compareVars, name]
  extraVar.value = ''
}

function setCheckKind(step: StepForm, kind: LabCheckKind) {
  step.checkKind = kind
}

function codeHeight(code: string, minLines: number, maxLines: number) {
  const lines = Math.min(Math.max(code.split('\n').length + 1, minLines), maxLines)
  return `${lines * 21 + 12}px`
}

// ---------------------------------------------------------------- 试跑

interface Trial {
  result: LabRunResult
  /** 跑的那一刻第 1…这一步的内容；内容变了结果就作废 */
  signature: string
}
const trials = ref(new Map<number, Trial>())
const trialing = ref<number | null>(null)

function signatureOf(index: number) {
  return JSON.stringify(form.steps.slice(0, index + 1).map(({ key: _key, id: _id, title: _t, description: _d, ...rest }) => rest))
}

function trialOf(index: number) {
  const step = form.steps[index]
  const trial = step ? trials.value.get(step.key) : undefined
  return trial && trial.signature === signatureOf(index) ? trial.result : null
}

function trialPassed(index: number) {
  const r = trialOf(index)
  return r ? r.ok && !r.referenceError && r.check?.passed === true : null
}

async function trial(index: number) {
  const step = form.steps[index]!
  trialing.value = step.key
  try {
    const result = await trialLabStep(labId.value, { steps: toBody().steps, index })
    const next = new Map(trials.value)
    next.set(step.key, { result, signature: signatureOf(index) })
    trials.value = next
  } catch (err) {
    message.error(errorMessage(err, '试跑失败'))
  } finally {
    trialing.value = null
  }
}

function referenceOf(step: StepForm) {
  return step.referenceCode.trim() ? step.referenceCode : step.starterCode
}

// ---------------------------------------------------------------- 素材

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const uploading = ref(false)
const previewAsset = ref<LabAsset | null>(null)
const previewTable = ref<LabTableOutput | null>(null)
const previewError = ref<string | null>(null)

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const asset = await uploadLabAsset(labId.value, file)
    assets.value = [...assets.value.filter((a) => a.name !== asset.name), asset].sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    message.error(errorMessage(err, '没传上'))
  } finally {
    uploading.value = false
  }
}

function removeAsset(asset: LabAsset) {
  dialog.warning({
    title: `删掉「${asset.name}」？`,
    content: '代码里读这个文件的步骤会跑不通。',
    positiveText: '删掉',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await deleteLabAsset(labId.value, asset.id)
        assets.value = assets.value.filter((a) => a.id !== asset.id)
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

async function openPreview(asset: LabAsset) {
  previewAsset.value = asset
  previewTable.value = null
  previewError.value = null
  try {
    const p = await getLabAssetPreview(labId.value, asset.id)
    previewTable.value = p.table
    previewError.value = p.error ?? (p.table ? null : '这种文件看不了表格，下载下来看')
  } catch (err) {
    previewError.value = errorMessage(err, '打不开')
  }
}

async function download(asset: LabAsset) {
  if (!(await downloadFile(labAssetFileUrl(labId.value, asset.id), asset.name))) message.error('下载失败')
}

function sizeText(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------- 右边：学生看到的样子

const previewIndex = computed(() => {
  const i = form.steps.findIndex((s) => s.key === openKey.value)
  return i >= 0 ? i : 0
})
const previewStep = computed(() => form.steps[previewIndex.value] ?? null)
const previewResult = computed(() => trialOf(previewIndex.value))

onMounted(load)
</script>

<template>
  <PageHeader :title="lab ? '编辑数据分析' : '数据分析'" :back="{ name: 'admin lab list' }">
    <template #extra>
      <n-text v-if="lab" depth="3" class="note">{{ lab.createdBy.username }} 出的</n-text>
    </template>
  </PageHeader>

  <div v-if="lab" class="labEditor" :class="{ collapsed: previewCollapsed }">
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
        <MarkdownEditor v-model:value="form.description" height="150px" />
      </section>

      <section class="card">
        <div class="row">
          <h3>素材</h3>
          <span class="grow"></span>
          <n-button size="small" :loading="uploading" @click="fileInput?.click()">+ 上传文件</n-button>
          <input ref="fileInput" type="file" hidden @change="onPickFile" />
        </div>
        <div v-for="asset in assets" :key="asset.id" class="asset">
          <b>{{ asset.name }}</b>
          <n-text depth="3" class="small">{{ sizeText(asset.size) }}</n-text>
          <span class="grow"></span>
          <n-button size="tiny" @click="openPreview(asset)">预览</n-button>
          <n-button size="tiny" @click="download(asset)">下载</n-button>
          <n-button size="tiny" type="error" ghost @click="removeAsset(asset)">删除</n-button>
        </div>
        <n-text v-if="!assets.length" depth="3" class="small">还没有素材</n-text>
      </section>

      <template v-for="(step, index) in form.steps" :key="step.key">
        <!-- 收起的一步 -->
        <button v-if="openKey !== step.key" type="button" class="fold" @click="openKey = step.key">
          <span class="sn">{{ index + 1 }}</span>
          <b class="ell">{{ step.title }}</b>
          <n-text depth="3" class="small ell">{{ checkSummary(step) }}</n-text>
          <span class="grow"></span>
          <span v-if="trialPassed(index) === true" class="ok small">✓ 跑通</span>
          <span v-else-if="trialPassed(index) === false" class="bad small">没跑通</span>
          <n-text depth="3">›</n-text>
        </button>

        <!-- 展开的一步 -->
        <section v-else class="card current">
          <div class="row">
            <span class="sn on">{{ index + 1 }}</span>
            <n-input v-model:value="step.title" placeholder="这一步的标题" aria-label="这一步的标题" maxlength="128" class="grow" />
            <n-tag v-if="step.kind === 'open'" size="small" :bordered="false">开放</n-tag>
            <n-button size="small" :disabled="index === 0" aria-label="上移" @click="move(index, -1)">↑</n-button>
            <n-button size="small" :disabled="index === form.steps.length - 1" aria-label="下移" @click="move(index, 1)">↓</n-button>
            <n-button size="small" type="error" ghost @click="removeStep(index)">删除</n-button>
          </div>
          <MarkdownEditor v-model:value="step.description" height="150px" />

          <div class="field">
            <span class="label">学生拿到的初始代码</span>
            <CodeEditor v-model:value="step.starterCode" language="Python" :font-size="14" :height="codeHeight(step.starterCode, 2, 10)" />
          </div>

          <template v-if="step.kind === 'normal'">
            <div class="row">
              <span class="label">怎么算做对</span>
              <n-radio-group :value="step.checkKind" size="small" @update:value="(v: LabCheckKind) => setCheckKind(step, v)">
                <n-radio-button value="none">不检查</n-radio-button>
                <n-radio-button value="compare">对照答案</n-radio-button>
                <n-radio-button value="script">检查脚本</n-radio-button>
              </n-radio-group>
            </div>

            <div class="field">
              <div class="row">
                <span class="label">答案</span>
                <span class="grow"></span>
                <n-text depth="3" class="small">学生做对后能看到</n-text>
              </div>
              <CodeEditor v-model:value="step.referenceCode" language="Python" :font-size="14" :height="codeHeight(step.referenceCode, 3, 16)" />
            </div>

            <template v-if="step.checkKind === 'compare'">
              <div class="row top">
                <span class="label">比什么</span>
                <div class="chips">
                  <n-tag checkable :checked="!!step.compareFigure" @update:checked="toggleFigure(step)">画出来的图</n-tag>
                  <n-tag
                    v-for="name in [...new Set([...assignedNames(step.referenceCode), ...step.compareVars])]"
                    :key="name"
                    checkable
                    :checked="step.compareVars.includes(name)"
                    @update:checked="toggleVar(step, name)"
                  >
                    {{ name }}
                  </n-tag>
                  <n-input v-model:value="extraVar" size="tiny" placeholder="+ 写变量名" class="varInput" @keyup.enter="addVar(step)" @blur="addVar(step)" />
                </div>
              </div>
              <div v-if="step.compareFigure" class="row figureOpts">
                <n-text depth="3" class="small">图里比：</n-text>
                <n-checkbox v-model:checked="step.compareFigure.values">柱子 / 线的数值</n-checkbox>
                <n-checkbox v-model:checked="step.compareFigure.title">标题</n-checkbox>
                <n-checkbox v-model:checked="step.compareFigure.labels">坐标轴文字</n-checkbox>
              </div>
            </template>

            <div v-if="step.checkKind === 'script'" class="field">
              <span class="label">检查脚本</span>
              <CodeEditor
                v-model:value="step.checkScript"
                language="Python"
                :font-size="14"
                :height="codeHeight(step.checkScript, 3, 12)"
                placeholder="assert df['总分'].max() <= 400, '总分算错了，检查是不是把姓名列也加进去了'"
              />
            </div>
          </template>

          <div class="row trialRow">
            <n-button :loading="trialing === step.key" @click="trial(index)">试跑这一步</n-button>
            <template v-if="trialOf(index)">
              <span v-if="trialPassed(index)" class="ok small"
                >跑通了{{ trialOf(index)?.referenceSummary ? `：${trialOf(index)?.referenceSummary}` : '' }}</span
              >
              <span v-else class="bad small">没跑通，看右边</span>
            </template>
          </div>
        </section>
      </template>

      <div class="row">
        <n-button @click="addStep('normal')">+ 加一步</n-button>
        <n-button @click="addStep('open')">+ 加开放步骤</n-button>
      </div>

      <div class="saveBar">
        <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存</n-button>
        <n-text depth="3" class="small">{{ dirty ? '有改动还没保存' : '都存好了' }}</n-text>
        <span class="grow"></span>
        <n-button @click="$router.push({ name: 'lab progress', params: { labID } })">看全班进度</n-button>
      </div>
    </div>

    <!-- 右：学生看到的样子 -->
    <aside v-show="!previewCollapsed" class="preview">
      <div class="row">
        <b>学生看到的样子</b>
        <span class="grow"></span>
        <n-button size="small" quaternary title="收起，专心写左边" @click="previewCollapsed = true">收起 ›</n-button>
      </div>
      <div v-if="previewStep" class="studentStep">
        <div class="row">
          <span class="sn on big">{{ previewIndex + 1 }}</span>
          <b class="stepTitle">{{ previewStep.title }}</b>
          <n-tag v-if="previewStep.kind === 'open'" size="small" :bordered="false">开放</n-tag>
        </div>
        <Markdown v-if="previewStep.description.trim()" :content="previewStep.description" />
        <div class="codeBox">
          <CodeEditor :value="previewResult ? referenceOf(previewStep) : previewStep.starterCode" language="Python" :font-size="15" height="auto" readonly />
          <div class="outputs">
            <template v-if="previewResult">
              <n-text depth="3" class="small">结果 · 用答案跑的</n-text>
              <LabOutputs :outputs="previewResult.outputs" :truncated="previewResult.truncated" />
            </template>
            <n-text v-else depth="3" class="small">试跑后这里显示运行结果</n-text>
          </div>
        </div>
        <LabVerdict
          v-if="previewResult"
          :result="previewResult"
          :step="previewIndex + 1"
          :codes="form.steps.slice(0, previewIndex + 1).map(referenceOf)"
          :check-kind="previewStep.kind === 'open' ? 'none' : previewStep.checkKind"
          teacher
        />
      </div>
      <n-text v-else depth="3">还没有步骤</n-text>
    </aside>
    <PreviewStrip v-if="previewCollapsed" @expand="previewCollapsed = false" />
  </div>

  <n-modal
    :show="!!previewAsset"
    preset="card"
    :title="previewAsset?.name"
    style="width: min(960px, 92vw)"
    :bordered="false"
    @update:show="previewAsset = null"
  >
    <div v-if="previewTable" class="previewBox"><LabTable :table="previewTable" /></div>
    <n-text v-else-if="previewError" depth="3">{{ previewError }}</n-text>
    <n-spin v-else size="small" />
    <n-text v-if="previewTable" depth="3" class="small shape">{{ previewTable.shape[0] }} 行 × {{ previewTable.shape[1] }} 列</n-text>
  </n-modal>
</template>

<style scoped>
.note,
.small {
  font-size: 12px;
}

/* 和编程题出题页一样：写的一边大，看的一边小，右栏能收起 */
.labEditor {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 20px;
  align-items: start;
}

.labEditor.collapsed {
  grid-template-columns: minmax(0, 1fr) 36px;
}

@media (max-width: 1180px) {
  .labEditor,
  .labEditor.collapsed {
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

.card.current {
  border-color: v-bind('theme.primaryColor');
}

.card h3 {
  margin: 0;
  font-size: 15px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row.top {
  align-items: flex-start;
}

.grow {
  flex: 1 1 auto;
  min-width: 0;
}

.ell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  line-height: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* MarkdownEditor 自带 300px 的最小高度，是给教程正文那种长文的；这里只写几句说明 */
.card :deep(.editor-box) {
  min-height: 0;
}

.field :deep(.cm-editor) {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 4px;
}

.asset {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 4px;
  font-size: 13px;
}

.fold {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 13px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.sn {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: rgba(128, 128, 128, 0.14);
}

.sn.on {
  background: v-bind('theme.primaryColor');
  color: #ffffff;
}

.sn.big {
  width: 26px;
  height: 26px;
  border-radius: 13px;
  font-size: 13px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.varInput {
  width: 110px;
}

.figureOpts {
  padding-left: 52px;
  flex-wrap: wrap;
}

.trialRow {
  padding-top: 8px;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.ok {
  color: v-bind('theme.primaryColorPressed');
}

.bad {
  color: #b86e00;
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

.studentStep {
  border: 1px solid v-bind('theme.primaryColor');
  border-radius: 8px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: v-bind('theme.cardColor');
}

.stepTitle {
  font-size: 17px;
}

.codeBox {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
}

.outputs {
  border-top: 1px solid v-bind('theme.borderColor');
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.previewBox {
  max-height: 70vh;
  overflow: auto;
}

.shape {
  display: block;
  margin-top: 8px;
}
</style>
