<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { LabAsset, LabDetail, LabStep, LabStepRunResponse, LabTableOutput } from '@oj2/contract'
import CodeEditor from 'shared/components/CodeEditor.vue'
import Markdown from 'shared/components/Markdown.vue'
import { useAuthModalStore } from 'shared/store/authModal'
import { useUserStore } from 'shared/store/user'
import { errorMessage } from 'utils/api'
import { getLab, getLabAssetPreviewForStudent, runLabStep, saveLabCode, studentLabAssetUrl, submitLabOpen } from 'oj/api'
import LabOutputs from './components/LabOutputs.vue'
import LabTable from './components/LabTable.vue'
import LabVerdict from './components/LabVerdict.vue'
import { downloadFile } from './utils/download'
import { labLineMarkExtensions, markLine } from './utils/lineMark'

/**
 * 学生做一节「数据分析」，照画布 LabStudent：一页从头排到底（拍板：不做一次一步、不自动折叠）。
 * 规则见 docs/specs/2026-11-12-data-analysis-lab-design.md。
 *
 * - 运行第 k 步时带上第 1…k 步编辑器里的代码，服务器从第 1 步重跑（运行器不留状态）。
 * - 代码停手 1.5 秒自动存一次，点运行时也一起存；换电脑接着做。
 * - 运行结果（表、图）不存，刷新就没了，再点一次运行就有。
 */
const props = defineProps<{ labID: string }>()

const theme = useThemeVars()
const message = useMessage()
const userStore = useUserStore()
const authModal = useAuthModalStore()

const lab = ref<LabDetail | null>(null)
const notFound = ref(false)
const codes = ref<string[]>([])
const results = ref<(LabStepRunResponse | null)[]>([])
const running = ref<number | null>(null)
const showReference = ref(new Set<number>())
const openTexts = ref<string[]>([])
const submitting = ref<number | null>(null)

const labId = computed(() => Number(props.labID))
const steps = computed(() => lab.value?.steps ?? [])
const doneCount = computed(() => steps.value.filter((s) => s.passed).length)
/** 第一个还没做对的步骤，高亮它 */
const currentIndex = computed(() => steps.value.findIndex((s) => !s.passed))

async function load() {
  try {
    const data = await getLab(labId.value)
    lab.value = data
    codes.value = data.steps.map((s) => s.code ?? s.starterCode)
    results.value = data.steps.map(() => null)
    openTexts.value = data.steps.map((s) => s.openText ?? '')
    data.assets.forEach(loadPreview)
  } catch {
    notFound.value = true
  }
}

// ---------------------------------------------------------------- 自动保存

const saveTimers = new Map<number, ReturnType<typeof setTimeout>>()

function onCodeChange(index: number, value: string) {
  codes.value[index] = value
  if (!userStore.isAuthed) return
  clearTimeout(saveTimers.get(index))
  saveTimers.set(
    index,
    setTimeout(() => {
      saveTimers.delete(index)
      saveLabCode(labId.value, steps.value[index]!.id, value).catch(() => {})
    }, 1500),
  )
}

onBeforeUnmount(() => {
  // 离开页面前把还没来得及存的存掉
  for (const [index, timer] of saveTimers) {
    clearTimeout(timer)
    saveLabCode(labId.value, steps.value[index]!.id, codes.value[index]!).catch(() => {})
  }
})

// ---------------------------------------------------------------- 运行、交

function needLogin() {
  if (userStore.isAuthed) return false
  authModal.openLoginModal()
  return true
}

async function run(index: number) {
  if (needLogin()) return
  const step = steps.value[index]!
  // 服务器会把第 1…k 步一起存，排着的自动保存不用再发
  for (let i = 0; i <= index; i++) {
    clearTimeout(saveTimers.get(i))
    saveTimers.delete(i)
  }
  running.value = index
  const stepEls = document.querySelectorAll('.labPage .step')
  for (let i = 0; i <= index; i++) markLine(stepEls[i], null)
  try {
    const res = await runLabStep(labId.value, step.id, codes.value.slice(0, index + 1))
    results.value[index] = res
    if (res.error?.line) markLine(stepEls[res.error.step - 1], res.error.line)
    step.runs += 1
    if (res.passed) {
      step.passed = true
      if (res.referenceCode) step.referenceCode = res.referenceCode
    }
  } catch (err) {
    message.error(errorMessage(err, '没跑起来，再点一次'))
  } finally {
    running.value = null
  }
}

async function submit(index: number) {
  if (needLogin()) return
  const step = steps.value[index]!
  submitting.value = index
  try {
    const res = await submitLabOpen(labId.value, step.id, codes.value.slice(0, index + 1), openTexts.value[index]!.trim())
    step.passed = true
    step.submittedAt = res.submittedAt
    step.openText = openTexts.value[index]!.trim()
    message.success('交上去了')
  } catch (err) {
    message.error(errorMessage(err, '没交上'))
  } finally {
    submitting.value = null
  }
}

function toggleReference(index: number) {
  const next = new Set(showReference.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  showReference.value = next
}

function stepTag(step: LabStep, index: number) {
  if (step.kind === 'open') return step.submittedAt ? { text: '交了', type: 'success' as const } : null
  if (step.passed) return { text: '做对了', type: 'success' as const }
  const r = results.value[index]
  if (r || step.runs) return { text: '还没对', type: 'warning' as const }
  return null
}

// ---------------------------------------------------------------- 素材

const previews = ref(new Map<number, LabTableOutput | null>())
const expanded = ref(new Set<number>())

async function loadPreview(asset: LabAsset) {
  if (!/\.(xlsx|csv)$/i.test(asset.name)) return
  try {
    const p = await getLabAssetPreviewForStudent(labId.value, asset.id)
    previews.value = new Map(previews.value).set(asset.id, p.table)
  } catch {
    // 预览不了不影响做题，下载还能用
  }
}

function toggleAsset(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

async function download(asset: LabAsset) {
  if (!(await downloadFile(studentLabAssetUrl(labId.value, asset.id), asset.name))) message.error('下载失败')
}

onMounted(load)
</script>

<template>
  <div class="oj-page labPage">
    <n-result v-if="notFound" status="404" title="这一节不存在" description="可能还没公开，或者已经删掉了">
      <template #footer>
        <n-button tag="a" href="/lab" @click.prevent="$router.push({ name: 'labs' })">回到数据分析</n-button>
      </template>
    </n-result>

    <template v-else-if="lab">
      <header class="head">
        <router-link :to="{ name: 'labs' }" class="back"><Icon icon="ph:caret-left-bold" />数据分析</router-link>
        <div class="titleRow">
          <h1 class="title">{{ lab.title }}</h1>
          <n-tag v-if="!lab.isPublic" size="small" :bordered="false">没公开</n-tag>
          <template v-if="userStore.isTeacherOrAbove">
            <n-button size="small" @click="$router.push({ name: 'lab progress', params: { labID } })">全班进度</n-button>
            <n-button size="small" @click="$router.push({ name: 'admin lab edit', params: { labID } })">编辑</n-button>
          </template>
          <span class="grow"></span>
          <span class="progress">
            <span v-for="(s, i) in steps" :key="s.id" class="pdot" :class="{ done: s.passed, cur: i === currentIndex }" :title="`第 ${i + 1} 步`"></span>
            <span class="pcount">做对 {{ doneCount }} / {{ steps.length }} 步</span>
          </span>
        </div>
        <Markdown v-if="lab.description.trim()" :content="lab.description" class="intro" />
      </header>

      <!-- 素材 -->
      <section v-for="asset in lab.assets" :key="asset.id" class="asset">
        <div class="assetHead">
          <Icon icon="ph:file-xls" class="fileIcon" />
          <b class="assetName">{{ asset.name }}</b>
          <span v-if="previews.get(asset.id)" class="muted"> {{ previews.get(asset.id)!.shape[0] }} 行 × {{ previews.get(asset.id)!.shape[1] }} 列 </span>
          <span class="grow"></span>
          <n-button size="small" @click="download(asset)">下载</n-button>
        </div>
        <div v-if="previews.get(asset.id)" class="assetBody">
          <LabTable :table="previews.get(asset.id)!" :limit="expanded.has(asset.id) ? undefined : 5" />
          <n-button v-if="previews.get(asset.id)!.shape[0] > 5" size="small" class="more" @click="toggleAsset(asset.id)">
            {{ expanded.has(asset.id) ? '收起' : `看全部 ${previews.get(asset.id)!.shape[0]} 行` }}
          </n-button>
        </div>
      </section>

      <!-- 步骤 -->
      <section v-for="(step, index) in steps" :key="step.id" class="step" :class="{ cur: index === currentIndex }">
        <div class="stepHead">
          <span class="sn" :class="step.passed ? 'done' : index === currentIndex ? 'cur' : 'todo'">{{ index + 1 }}</span>
          <h2 class="stepTitle">{{ step.title }}</h2>
          <n-tag v-if="step.kind === 'open'" size="small" :bordered="false">开放</n-tag>
          <span class="grow"></span>
          <n-button v-if="step.referenceCode" size="small" @click="toggleReference(index)">
            {{ showReference.has(index) ? '收起老师的写法' : '看老师的写法' }}
          </n-button>
          <n-tag v-if="stepTag(step, index)" size="small" :bordered="false" :type="stepTag(step, index)!.type">{{ stepTag(step, index)!.text }}</n-tag>
        </div>

        <Markdown v-if="step.description.trim()" :content="step.description" />

        <div v-if="step.referenceCode && showReference.has(index)" class="reference">
          <div class="refLabel">老师的写法</div>
          <CodeEditor :value="step.referenceCode" language="Python" :font-size="15" height="auto" readonly />
        </div>

        <div class="codeBox">
          <div class="codeBar">
            <span>Python</span>
            <span class="grow"></span>
            <n-button type="primary" size="small" :loading="running === index" @click="run(index)">
              <template #icon><Icon icon="ph:play-fill" /></template>
              运行
            </n-button>
          </div>
          <div class="editor">
            <CodeEditor
              :value="codes[index]"
              language="Python"
              :font-size="16"
              height="auto"
              :extra-extensions="labLineMarkExtensions"
              @update:value="(v: string | undefined) => onCodeChange(index, v ?? '')"
            />
          </div>
          <div v-if="results[index] && (results[index]!.outputs.length || !results[index]!.error)" class="outputs">
            <div class="outLabel">结果</div>
            <LabOutputs :outputs="results[index]!.outputs" :truncated="results[index]!.truncated" />
            <n-text v-if="!results[index]!.outputs.length && !results[index]!.error" depth="3" class="empty">没有输出</n-text>
          </div>
        </div>

        <LabVerdict
          v-if="results[index] && (step.kind === 'normal' || results[index]!.error)"
          :result="results[index]!"
          :step="index + 1"
          :codes="codes.slice(0, index + 1)"
          :check-kind="step.checkKind"
        />

        <template v-if="step.kind === 'open'">
          <label class="openField">
            <span class="openLabel">你看出了什么</span>
            <n-input v-model:value="openTexts[index]" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" />
          </label>
          <div class="row">
            <n-button type="primary" :disabled="!openTexts[index]?.trim()" :loading="submitting === index" @click="submit(index)">
              {{ step.submittedAt ? '改了再交' : '交上去' }}
            </n-button>
          </div>
        </template>
      </section>
    </template>

    <n-spin v-else size="small" />
  </div>
</template>

<style scoped>
.labPage {
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 48px;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--oj-link);
  text-decoration: none;
  align-self: flex-start;
}

.titleRow {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.title {
  margin: 0;
  font-size: 28px;
  line-height: 1.3;
}

.grow {
  flex: 1 1 auto;
}

.progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
}

.pdot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  box-sizing: border-box;
  background: v-bind('theme.dividerColor');
}

.pdot.done {
  background: v-bind('theme.primaryColor');
}

.pdot.cur {
  background: transparent;
  border: 2px solid v-bind('theme.primaryColor');
}

.pcount {
  margin-left: 4px;
  font-size: 13px;
  color: v-bind('theme.textColor2');
  font-variant-numeric: tabular-nums;
}

.intro {
  font-size: 16px;
}

.asset {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
  overflow: hidden;
}

.assetHead {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 16px 0 18px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
}

.fileIcon {
  width: 20px;
  height: 20px;
  color: v-bind('theme.primaryColor');
  flex: none;
}

.assetName {
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  font-size: 13px;
  color: v-bind('theme.textColor3');
  white-space: nowrap;
}

.assetBody {
  padding: 10px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 560px;
  overflow: auto;
}

.more {
  align-self: flex-start;
}

.step {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.step.cur {
  border-color: v-bind('theme.primaryColor');
  box-shadow: 0 0 0 3px rgba(24, 160, 88, 0.12);
}

.stepHead {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sn {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 14px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
}

.sn.done {
  background: v-bind('theme.primaryColor');
  color: #ffffff;
}

.sn.cur {
  border: 2px solid v-bind('theme.primaryColor');
  color: v-bind('theme.primaryColorPressed');
}

.sn.todo {
  border: 1.5px solid v-bind('theme.borderColor');
  color: v-bind('theme.textColor3');
}

.stepTitle {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
}

.reference {
  border: 1px dashed v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
}

.refLabel {
  padding: 6px 14px;
  font-size: 12px;
  color: v-bind('theme.textColor3');
  border-bottom: 1px dashed v-bind('theme.borderColor');
}

.codeBox {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 6px;
  overflow: hidden;
  min-width: 0;
}

.codeBar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid v-bind('theme.dividerColor');
  font-size: 12px;
  color: v-bind('theme.textColor3');
  background: v-bind('theme.actionColor');
}

.editor :deep(.cm-content) {
  min-height: 96px;
}

.outputs {
  border-top: 1px solid v-bind('theme.borderColor');
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.outLabel,
.empty {
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.openField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.openLabel {
  font-size: 14px;
  font-weight: 600;
}

.row {
  display: flex;
  gap: 8px;
}

@media (max-width: 600px) {
  .step {
    padding: 16px;
  }
  .title {
    font-size: 22px;
  }
}
</style>
