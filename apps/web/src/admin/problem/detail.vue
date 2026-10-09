<script setup lang="ts">
import { PROBLEM_TAG_MAX_LENGTH, type RunnableLanguage } from "@oj2/contract"
import { StorageSerializers } from "@vueuse/core"
import { useThemeVars } from "naive-ui"
import PageHeader from "admin/components/PageHeader.vue"
import { getProblemTagList } from "shared/api"
import TextEditor from "shared/components/TextEditor.vue"
import { errorCode, errorMessage } from "utils/api"
import { DIFFICULTY, STORAGE_KEY } from "utils/constants"
import download from "utils/download"
import { createZipBlob, parseTime, unique } from "utils/functions"
import type { AdminProblem, AstRules, BlankProblem, LANGUAGE, Tag, Testcase } from "utils/types"
import {
  createContestProblem,
  createProblem,
  editProblem,
  generateFlowchartFromPythonCode,
  generateTestInputs,
  getTestCaseFiles,
  uploadTestcases,
} from "../api"
import AstRulesEditor from "./components/AstRulesEditor.vue"
import CaseTable from "./components/CaseTable.vue"
import CodePreview from "./components/CodePreview.vue"
import {
  caseFiles,
  caseStatus,
  newRow,
  readCaseZip,
  sameOutput,
  useCaseRunner,
  type AnswerSource,
  type CaseRow,
} from "./components/caseRows"
import {
  buildTemplate,
  parseTemplate,
  wrapWithTemplate,
  type TemplateParts,
} from "./components/codeTemplate"
import type { AstCheckState, FlowchartMode, PreviewTab } from "./components/editorTypes"

const CodeEditor = defineAsyncComponent(() => import("shared/components/CodeEditor.vue"))

/**
 * 编程题（C / C++ / Python）的出题页，设计稿「编程题出题页」方案 B：左边写，右边是学生
 * 打开这道题看到的样子 —— 和 SQL 出题页（SqlDetail.vue）同一个结构。两种题由 editor.vue 分流。
 *
 * 和原来那页最大的不同：
 * - 标准答案是中心。例子和测试数据的输出都由它在判题机上跑出来，不再手抄；
 * - 例子就是测试数据里勾了「当例子」的那几组，不再单独一份；
 * - 改老题时测试数据从文件读回来就地改，保存时整包重传（太大的除外，见契约 TEST_CASE_EDIT_*）；
 * - 预制代码只写学生看得到的那段，PREPEND / APPEND 的标记在 codeTemplate.ts 里拼。
 */
const props = defineProps<{
  problemID?: string
  contestID?: string
  /** 编辑时外层已经拉过一次题目（要靠它判断题型），直接给进来 */
  initial?: AdminProblem | null
}>()

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const theme = useThemeVars()

const isCreate = computed(() => !props.problemID)

const RUNNABLE: RunnableLanguage[] = ["Python", "C", "C++"]

// ---------------------------------------------------------------- 表单

interface CodeForm {
  _id: string
  title: string
  difficulty: BlankProblem["difficulty"]
  visible: boolean
  tags: string[]
  description: string
  inputDescription: string
  outputDescription: string
  hint: string
  source: string
  prompt: string
  timeLimit: number
  memoryLimit: number
  languages: RunnableLanguage[]
  answers: Record<RunnableLanguage, string>
  templates: Record<RunnableLanguage, TemplateParts>
  astRules: AstRules | null
  flowchartMode: FlowchartMode
  mermaidCode: string
  flowchartHint: string
}

const blankParts = (): TemplateParts => ({ prepend: "", template: "", append: "" })

const blankForm = (): CodeForm => ({
  _id: "",
  title: "",
  difficulty: "Low",
  visible: false,
  tags: [],
  description: "",
  inputDescription: "",
  outputDescription: "",
  hint: "",
  source: "",
  prompt: "",
  timeLimit: 1000,
  memoryLimit: 64,
  languages: ["Python", "C"],
  answers: { Python: "", C: "", "C++": "" },
  templates: { Python: blankParts(), C: blankParts(), "C++": blankParts() },
  astRules: null,
  flowchartMode: "none",
  mermaidCode: "",
  flowchartHint: "",
})

const form = reactive<CodeForm>(blankForm())

/** 富文本编辑器清空之后留下的是一个空段落，不是空串 */
const isBlankHtml = (html: string) => !html.trim() || html === "<p><br></p>"

const difficultyOptions = (["Low", "Mid", "High"] as const).map((value) => ({
  label: DIFFICULTY[value],
  value,
}))

const NO_INPUT = "<p>没有输入</p>"

// ---------------------------------------------------------------- 标签

const tagList = shallowRef<Tag[]>([])
const knowledgeTags = computed(() =>
  tagList.value
    .filter((t) => t.category === "knowledge")
    .sort((a, b) => b.problemCount - a.problemCount)
    .map((t) => t.name),
)
const knowledgeSet = computed(() => new Set(knowledgeTags.value))
const showAllKnowledge = ref(false)
/** 知识点先露最常用的 10 个，选中的始终露着 */
const visibleKnowledge = computed(() => {
  if (showAllKnowledge.value) return knowledgeTags.value
  const top = knowledgeTags.value.slice(0, 10)
  return unique([...top, ...knowledgeTags.value.filter((t) => form.tags.includes(t))])
})
/** 主题和新建的标签走下拉（主题 25 个、还会越来越多，铺不开） */
const otherTags = computed(() => form.tags.filter((t) => !knowledgeSet.value.has(t)))
const themeOptions = computed(() =>
  unique([
    ...tagList.value.filter((t) => t.category === "theme").map((t) => t.name),
    ...otherTags.value,
  ]).map((name) => ({ label: name, value: name })),
)

function toggleKnowledge(name: string) {
  form.tags = form.tags.includes(name) ? form.tags.filter((t) => t !== name) : [...form.tags, name]
}

function onOtherTagsChange(tags: string[]) {
  const tooLong = tags.find((t) => t.length > PROBLEM_TAG_MAX_LENGTH)
  if (tooLong) {
    message.error(`标签最多 ${PROBLEM_TAG_MAX_LENGTH} 个字：${tooLong}`)
    return
  }
  const others = unique(tags.map((t) => t.trim()).filter(Boolean))
  form.tags = unique([...form.tags.filter((t) => knowledgeSet.value.has(t)), ...others])
}

// ---------------------------------------------------------------- 标准答案

const answerTab = ref<RunnableLanguage>("Python")
watch(
  () => form.languages,
  (langs) => {
    if (langs.length && !langs.includes(answerTab.value)) answerTab.value = langs[0]!
  },
)

/**
 * 拿来跑测试数据的那份答案：开着的那个页签有答案就用它，否则按 Python → C → C++ 找第一份。
 * 套上题目模板的前后两段，和学生提交时拼出来的是同一份代码。
 */
const source = computed<AnswerSource | null>(() => {
  const candidates = [answerTab.value, ...RUNNABLE].filter((lang) => form.languages.includes(lang))
  const lang = candidates.find((l) => form.answers[l].trim())
  if (!lang) return null
  return { language: lang, code: wrapWithTemplate(form.answers[lang], form.templates[lang]) }
})

/** 代码框跟着行数长：5 行的答案别占 260 高，长答案也别撑出一屏 */
function codeHeight(code: string, minLines: number, maxLines: number) {
  const lines = Math.min(Math.max(code.split("\n").length + 1, minLines), maxLines)
  return `${lines * 21 + 12}px`
}

const answerSummary = computed(() => {
  const written = form.languages.filter((l) => form.answers[l].trim())
  if (!written.length) return "还没写"
  const lines = form.answers[written[0]!].trim().split("\n").length
  return `${written.join("、")} · ${lines} 行`
})

// ---------------------------------------------------------------- 测试数据

const rows = ref<CaseRow[]>([])
/** 太大不展开的测试数据：只有数量和大小，例子单独写在 exampleRows */
const big = ref<{ count: number; totalBytes: number } | null>(null)
const exampleRows = ref<CaseRow[]>([])
/** 现在挂在题目上的测试点 */
const testCase = reactive({ id: "", score: [] as Testcase[] })
/** 打开时读回来的那份（没改过就不用重传） */
let loadedCases: { input: string; output: string }[] | null = null
/** 页面顶上的说明：测试点读不出来、原来的例子补进了测试数据…… */
const caseNotice = ref("")

const { running, runAll, rerunFailed } = useCaseRunner(rows, source)
const examplesRunner = useCaseRunner(exampleRows, source)

watchDebounced(
  () => [source.value, rows.value.map((r) => `${r.key}:${r.input}`)] as const,
  () => void runAll(),
  { debounce: 600, deep: true },
)
watchDebounced(
  () => [source.value, exampleRows.value.map((r) => `${r.key}:${r.input}`)] as const,
  () => void examplesRunner.runAll(),
  { debounce: 600, deep: true },
)

const examples = computed(() =>
  (big.value ? exampleRows.value : rows.value.filter((r) => r.example)).map((r) => ({
    input: r.input,
    output: r.output,
  })),
)

/** 「测试数据第 1–4 组」 */
const examplesNote = computed(() => {
  if (big.value) return ""
  const picked = rows.value.flatMap((r, i) => (r.example ? [i + 1] : []))
  if (!picked.length) return ""
  const contiguous = picked.every((n, i) => i === 0 || n === picked[i - 1]! + 1)
  if (picked.length === 1) return `测试数据第 ${picked[0]} 组`
  return contiguous
    ? `测试数据第 ${picked[0]}–${picked.at(-1)} 组`
    : `测试数据第 ${picked.join("、")} 组`
})

const caseSummary = computed(() => {
  if (big.value) return `${big.value.count} 组 · ${formatBytes(big.value.totalBytes)}`
  const statuses = rows.value.map((r) => caseStatus(r, source.value))
  const examplesCount = rows.value.filter((r) => r.example).length
  const failed = statuses.filter((s) => s === "error").length
  const changed = statuses.filter((s) => s === "changed").length
  const parts = [`${rows.value.length} 组`]
  if (failed) parts.push(`${failed} 组没跑通`)
  if (changed) parts.push(`${changed} 组输出变了`)
  parts.push(examplesCount ? `${examplesCount} 组当例子` : "还没勾例子")
  return parts.join(" · ")
})

const changedCount = computed(
  () => rows.value.filter((r) => caseStatus(r, source.value) === "changed").length,
)

const saveNote = computed(() => {
  if (big.value) return "例子都跑通了"
  const picked = rows.value.filter((r) => r.example).length
  const base = source.value
    ? `${rows.value.length} 组都跑通了，${picked} 组当例子`
    : `${rows.value.length} 组，${picked} 组当例子`
  return changedCount.value
    ? `${base} · ${changedCount.value} 组的输出和原来不一样（保存后按新的判，交过的不会自动重判）`
    : base
})

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function addRow() {
  // 空着的第一组（新建页）直接用掉；例子一组都还没勾时，新加的这组先勾上
  const noExample = !rows.value.some((r) => r.example)
  rows.value.push(newRow("", "", noExample))
}

const generatingInputs = ref(false)

async function aiInputs() {
  const answer = source.value
  if (!answer) return
  generatingInputs.value = true
  try {
    const res = await generateTestInputs({
      description: form.description,
      inputDescription: form.inputDescription,
      language: answer.language,
      answer: form.answers[answer.language],
      existing: rows.value.map((r) => r.input).slice(0, 100),
    })
    if (!res.inputs.length) {
      message.info("AI 没想出新的输入")
      return
    }
    // 空着的行先填掉
    const blanks = rows.value.filter((r) => !r.input.trim() && !r.output.trim())
    for (const input of res.inputs) {
      const blank = blanks.shift()
      if (blank) blank.input = input
      else rows.value.push(newRow(input))
    }
    message.success(`加了 ${res.inputs.length} 组，输出马上跑出来`)
  } catch (err) {
    message.error(errorMessage(err, "AI 没想出来，稍后再试"))
  } finally {
    generatingInputs.value = false
  }
}

/** 导入 zip：拆得开就换成一组组；太大就直接上传，换成「不展开」 */
async function importZip({ file }: UploadCustomRequestOptions) {
  const raw = file.file
  if (!raw) return
  const parsed = readCaseZip(new Uint8Array(await raw.arrayBuffer()))
  if (parsed.ok) {
    const exampleInputs = new Set(examples.value.map((e) => e.input.trimEnd()))
    rows.value = parsed.cases.map((c) =>
      newRow(c.input, c.output, exampleInputs.has(c.input.trimEnd())),
    )
    if (!rows.value.some((r) => r.example) && rows.value[0]) rows.value[0].example = true
    big.value = null
    message.success(`导入了 ${parsed.cases.length} 组`)
    return
  }
  if (parsed.reason !== "too-large") {
    message.error(parsed.reason)
    return
  }
  try {
    const res = await uploadTestcases(raw)
    setTestCase(res.id, res.info)
    big.value = {
      count: res.info.length,
      totalBytes: res.info.reduce((sum, e) => sum + e.input_size + e.output_size, 0),
    }
    if (!exampleRows.value.length) {
      exampleRows.value = examples.value.map((e) => newRow(e.input, e.output, true))
    }
    rows.value = []
    loadedCases = null
    message.success(`导入了 ${res.info.length} 组（太大，页面上不展开）`)
  } catch (err) {
    message.error(errorMessage(err, "上传失败"))
  }
}

function downloadZip() {
  if (big.value) {
    if (props.initial) download(`problems/${props.initial.id}/test-cases`)
    return
  }
  const blob = createZipBlob(caseFiles(rows.value))
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${form._id || "problem"}_test_cases.zip`
  link.click()
  URL.revokeObjectURL(url)
}

function setTestCase(id: string, info: { input_name: string; output_name: string }[]) {
  // 分值平分，余数给最后一组；只留落库的三个键（见契约 problemTestCaseScoreSchema）
  const base = Math.floor(100 / info.length)
  const rest = 100 - base * info.length
  testCase.id = id
  testCase.score = info.map((entry, i) => ({
    input_name: entry.input_name,
    output_name: entry.output_name,
    score: i === info.length - 1 ? base + rest : base,
  }))
}

// ---------------------------------------------------------------- 学生怎么写 · 流程图

const templateTab = ref<RunnableLanguage>("Python")
watch(
  () => form.languages,
  (langs) => {
    if (langs.length && !langs.includes(templateTab.value)) templateTab.value = langs[0]!
  },
  { immediate: true },
)
const showHidden = ref(false)
const astChecks = ref<AstCheckState>({})

const answersForAst = computed(() => ({ ...form.answers }) as Partial<Record<LANGUAGE, string>>)
const templatesForPreview = computed(
  () => ({ ...form.templates }) as Partial<Record<LANGUAGE, TemplateParts>>,
)

const writeSummary = computed(() => {
  const langs = form.languages.length ? `${form.languages.join("、")} 可交` : "还没选语言"
  const withTemplate = form.languages.filter((l) => form.templates[l].template.trim())
  const tpl = withTemplate.length ? `预制代码 ${withTemplate.join("、")}` : "没有预制代码"
  const ruleCount = form.languages.reduce((n, l) => n + (form.astRules?.[l]?.length ?? 0), 0)
  return `${langs} · ${tpl} · ${ruleCount ? `${ruleCount} 条语法要求` : "没有语法要求"}`
})

const FLOWCHART_LABEL: Record<FlowchartMode, string> = {
  none: "不用",
  show: "给学生看参考流程图",
  draw: "让学生自己画",
}

const mermaidOk = ref(false)
const aiDrawing = ref(false)

async function aiFlowchart() {
  aiDrawing.value = true
  try {
    const res = await generateFlowchartFromPythonCode(form.answers.Python)
    form.mermaidCode = res.flowchart
    preview.value = "flowchart"
  } catch (err) {
    message.error(errorMessage(err, "生成失败，请稍后再试"))
  } finally {
    aiDrawing.value = false
  }
}

const moreSummary = computed(() => {
  const parts: string[] = []
  if (!isBlankHtml(form.hint)) parts.push("有提示")
  if (form.source.trim()) parts.push(`来源：${form.source.trim()}`)
  if (form.timeLimit !== 1000 || form.memoryLimit !== 64)
    parts.push(`${form.timeLimit} 毫秒 / ${form.memoryLimit}MB`)
  if (form.prompt.trim()) parts.push("给 AI 的知识点")
  return parts.length ? parts.join(" · ") : "提示、来源、时间 / 内存限制、给 AI 看的知识点"
})

// ---------------------------------------------------------------- 折叠 · 右栏跟着走

const open = reactive({
  statement: true,
  answer: true,
  cases: true,
  write: false,
  flowchart: false,
  more: false,
})
const preview = ref<PreviewTab>("statement")

watch(
  () => open.write,
  (v) => v && (preview.value = "editor"),
)
watch(
  () => open.flowchart,
  (v) => v && (preview.value = "flowchart"),
)
watch(
  () => [form.templates, form.astRules],
  () => open.write && (preview.value = "editor"),
  { deep: true },
)
watch(
  () => [form.mermaidCode, form.flowchartMode],
  () => open.flowchart && (preview.value = "flowchart"),
)

// ---------------------------------------------------------------- 加载 · 草稿

interface Draft {
  form: CodeForm
  rows: { input: string; output: string; example: boolean }[]
}

// 新建时存草稿（编辑页不存：原来编辑页也往同一个 key 里写，没保存就离开的话，
// 那道题的 id 会跟着草稿漂到新建页）。初值 null 时 VueUse 推不出类型，得显式指定
const draft = useLocalStorage<Draft | null>(STORAGE_KEY.ADMIN_CODE_PROBLEM, null, {
  serializer: StorageSerializers.object,
})
const ready = ref(false)
const draftRestored = ref(false)

function snapshot() {
  return JSON.stringify([
    form,
    rows.value.map((r) => [r.input, r.output, r.example]),
    exampleRows.value.map((r) => [r.input, r.output]),
    testCase.id,
  ])
}
let baseline = ""

watchDebounced(
  () => [form, rows.value.map((r) => [r.input, r.output, r.example])] as const,
  () => {
    if (!ready.value || !isCreate.value) return
    const empty =
      !form._id &&
      !form.title &&
      isBlankHtml(form.description) &&
      !RUNNABLE.some((l) => form.answers[l].trim()) &&
      !rows.value.some((r) => r.input.trim() || r.output.trim())
    draft.value = empty
      ? null
      : {
          form: JSON.parse(JSON.stringify(form)),
          rows: rows.value.map((r) => ({ input: r.input, output: r.output, example: r.example })),
        }
  },
  { debounce: 800, deep: true },
)

function clearDraft() {
  draft.value = null
  Object.assign(form, blankForm())
  rows.value = [newRow("", "", true)]
  draftRestored.value = false
}

function loadDraft() {
  // 旧版出题页的草稿（另一个 key、另一种形状）不认了
  localStorage.removeItem(STORAGE_KEY.ADMIN_PROBLEM)
  const saved = draft.value
  // 草稿是本机存的，形状不对（旧版本、被别的页面写坏）就当没有，别让整页起不来
  if (saved && typeof saved.form === "object" && Array.isArray(saved.rows)) {
    const merged = { ...blankForm(), ...saved.form }
    merged.answers = { ...blankForm().answers, ...saved.form.answers }
    merged.templates = { ...blankForm().templates, ...saved.form.templates }
    Object.assign(form, merged)
    rows.value = saved.rows.map((r) =>
      newRow(String(r.input ?? ""), String(r.output ?? ""), !!r.example),
    )
    draftRestored.value = true
  } else {
    draft.value = null
  }
  if (!rows.value.length) rows.value = [newRow("", "", true)]
}

function sameInput(a: string, b: string) {
  return sameOutput(a, b)
}

async function loadProblem(data: AdminProblem) {
  const languages = RUNNABLE.filter((l) => data.languages.includes(l))
  const answers = blankForm().answers
  for (const a of data.answers) {
    if (RUNNABLE.includes(a.language as RunnableLanguage)) {
      answers[a.language as RunnableLanguage] = a.code
    }
  }
  const templates = blankForm().templates
  for (const lang of RUNNABLE) templates[lang] = parseTemplate(data.template[lang])
  Object.assign(form, {
    _id: data._id,
    title: data.title,
    difficulty: data.difficulty,
    visible: data.visible,
    tags: data.tags,
    description: data.description,
    inputDescription: data.inputDescription,
    outputDescription: data.outputDescription,
    hint: data.hint ?? "",
    source: data.source ?? "",
    prompt: data.prompt ?? "",
    timeLimit: data.timeLimit,
    memoryLimit: data.memoryLimit,
    languages: languages.length ? languages : ["Python"],
    answers,
    templates,
    astRules: data.astRules ?? null,
    flowchartMode: data.allowFlowchart ? "draw" : data.showFlowchart ? "show" : "none",
    mermaidCode: data.mermaidCode ?? "",
    flowchartHint: data.flowchartHint ?? "",
  } satisfies CodeForm)
  answerTab.value = RUNNABLE.find((l) => languages.includes(l) && answers[l].trim()) ?? "Python"
  testCase.id = data.testCaseId
  testCase.score = data.testCaseScore

  let files: Awaited<ReturnType<typeof getTestCaseFiles>> | null = null
  try {
    files = await getTestCaseFiles(data.id)
  } catch {
    files = null
  }
  if (!files) {
    caseNotice.value =
      "这道题的测试点文件读不出来（可能被清理掉了）。下面是题面上的例子，补几组测试数据再保存，会换成新的一份。"
    rows.value = data.samples.map((s) => newRow(s.input, s.output, true))
    testCase.id = ""
    return
  }
  if (!files.editable) {
    big.value = { count: files.count, totalBytes: files.totalBytes }
    exampleRows.value = data.samples.map((s) => newRow(s.input, s.output, true, s.output))
    return
  }
  loadedCases = files.cases
  rows.value = files.cases.map((c) => newRow(c.input, c.output, false, c.output))
  // 例子对回测试数据：输入一样的那组勾上；对不上的（老题的例子多半不在测试数据里）补到最后
  let appended = 0
  for (const sample of data.samples) {
    const match = rows.value.find((r) => !r.example && sameInput(r.input, sample.input))
    if (match) match.example = true
    else {
      rows.value.push(newRow(sample.input, sample.output, true, sample.output))
      appended += 1
    }
  }
  if (appended) {
    caseNotice.value = `原来的例子有 ${appended} 组不在测试数据里，已经加在最后、勾成例子 —— 保存后它们也会拿来判。`
  }
}

// ---------------------------------------------------------------- 保存

interface Blocker {
  text: string
  /** 点了展开哪一块 */
  section: keyof typeof open
  severe?: boolean
}

const blockers = computed<Blocker[]>(() => {
  const list: Blocker[] = []
  if (!form._id.trim() || !form.title.trim())
    list.push({ text: "填编号和题目", section: "statement" })
  if (isBlankHtml(form.description)) list.push({ text: "写描述", section: "statement" })
  if (isBlankHtml(form.inputDescription))
    list.push({ text: "写输入说明（没有输入就点「没有输入」）", section: "statement" })
  if (isBlankHtml(form.outputDescription)) list.push({ text: "写输出说明", section: "statement" })
  if (!form.tags.length) list.push({ text: "选一个知识点标签", section: "statement" })
  if (!form.languages.length) list.push({ text: "选能交的语言", section: "write" })
  if (!source.value && (isCreate.value || !rows.value.length))
    list.push({ text: "写标准答案", section: "answer" })

  const caseRows = big.value ? exampleRows.value : rows.value
  if (!big.value && !rows.value.length) list.push({ text: "加一组测试数据", section: "cases" })
  if (caseRows.some((r) => caseStatus(r, source.value) === "running"))
    list.push({ text: "等测试数据跑完", section: "cases" })
  caseRows.forEach((r, i) => {
    if (caseStatus(r, source.value) === "error")
      list.push({
        text: `改好${big.value ? `例子 ${i + 1}` : `第 ${i + 1} 组`}（答案在这组上出错了）`,
        section: "cases",
        severe: true,
      })
  })
  if (!source.value && caseRows.some((r) => !r.output.trim()))
    list.push({ text: "补上没写的输出", section: "cases" })
  if (!examples.value.length)
    list.push({ text: "勾一组当例子（题面上至少给学生一个）", section: "cases" })

  for (const [lang, state] of Object.entries(astChecks.value)) {
    if (!form.languages.includes(lang as RunnableLanguage)) continue
    if ("error" in state) list.push({ text: state.error, section: "write", severe: true })
    else
      state.rules.forEach((rule) => {
        if (rule.passed === false)
          list.push({
            text: `改好语法要求「${rule.description}」（标准答案自己没过）`,
            section: "write",
            severe: true,
          })
      })
  }
  if (form.flowchartMode !== "none") {
    if (!form.mermaidCode.trim()) list.push({ text: "写流程图的代码", section: "flowchart" })
    else if (!mermaidOk.value)
      list.push({ text: "改好流程图的代码（画不出来）", section: "flowchart", severe: true })
  }
  return list
})

function jump(blocker: Blocker) {
  open[blocker.section] = true
  nextTick(() =>
    document
      .getElementById(`section-${blocker.section}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
  )
}

const saving = ref(false)

async function uploadRows() {
  const blob = createZipBlob(caseFiles(rows.value))
  const res = await uploadTestcases(new File([blob], "testcase.zip", { type: "application/zip" }))
  setTestCase(res.id, res.info)
}

function casesChanged() {
  if (!testCase.id || !loadedCases) return true
  if (loadedCases.length !== rows.value.length) return true
  return rows.value.some(
    (r, i) => r.input !== loadedCases![i]!.input || !sameOutput(r.output, loadedCases![i]!.output),
  )
}

async function save() {
  if (blockers.value.length) {
    jump(blockers.value[0]!)
    return
  }
  saving.value = true
  try {
    if (!big.value && casesChanged()) await uploadRows()

    const template: Record<string, string> = {}
    for (const lang of form.languages) {
      const built = buildTemplate(form.templates[lang])
      if (built) template[lang] = built
    }
    const body: BlankProblem = {
      _id: form._id.trim(),
      title: form.title.trim(),
      description: form.description,
      inputDescription: form.inputDescription,
      outputDescription: form.outputDescription,
      samples: examples.value,
      testCaseId: testCase.id,
      testCaseScore: testCase.score,
      timeLimit: form.timeLimit,
      memoryLimit: form.memoryLimit,
      difficulty: form.difficulty,
      visible: form.visible,
      tags: form.tags,
      languages: form.languages,
      template,
      hint: isBlankHtml(form.hint) ? "" : form.hint,
      source: form.source.trim(),
      prompt: form.prompt.trim(),
      answers: form.languages
        .filter((lang) => form.answers[lang].trim())
        .map((lang) => ({ language: lang, code: form.answers[lang] })),
      allowFlowchart: form.flowchartMode === "draw",
      showFlowchart: form.flowchartMode === "show",
      mermaidCode: form.flowchartMode === "none" ? form.mermaidCode : form.mermaidCode.trim(),
      flowchartHint: form.flowchartHint.trim(),
      astRules: form.astRules,
      sqlConfig: null,
      sqlDisplay: null,
      contestId: props.contestID ? Number(props.contestID) : null,
    }
    if (!isCreate.value) {
      await editProblem({ ...body, id: props.initial!.id })
      // 存好了：现在这份就是基准
      loadedCases = rows.value.map((r) => ({ input: r.input, output: r.output }))
      rows.value.forEach((r) => (r.saved = r.output))
      caseNotice.value = ""
      baseline = snapshot()
      message.success("保存好了")
      return
    }
    const created = props.contestID ? await createContestProblem(body) : await createProblem(body)
    draft.value = null
    baseline = snapshot()
    message.success("题目建好了")
    router.replace(
      props.contestID
        ? {
            name: "admin contest problem edit",
            params: { contestID: props.contestID, problemID: created.id },
          }
        : { name: "admin problem edit", params: { problemID: created.id } },
    )
  } catch (err) {
    message.error(
      errorCode(err) === "display-id-exists" ? "显示编号重复了，换一个" : errorMessage(err),
    )
  } finally {
    saving.value = false
  }
}

// 改了没保存就离开：新建页有草稿兜着，编辑页没有
onBeforeRouteLeave(() => {
  if (isCreate.value || !ready.value || snapshot() === baseline) return true
  return new Promise<boolean>((resolve) => {
    dialog.warning({
      title: "还没保存",
      content: "改的东西还没保存，离开就没了。",
      positiveText: "不要了，离开",
      negativeText: "留下来",
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
    })
  })
})

const backTo = computed(() =>
  props.contestID
    ? { name: "admin contest problem list", params: { contestID: props.contestID } }
    : { name: "admin problem list" },
)

const authorLine = computed(() =>
  props.initial
    ? `${props.initial.createdBy.username} 出的 · ${parseTime(props.initial.createTime, "YYYY-MM-DD")}`
    : "",
)

onMounted(async () => {
  getProblemTagList().then((res) => (tagList.value = res))
  if (isCreate.value) loadDraft()
  else if (props.initial) await loadProblem(props.initial)
  ready.value = true
  await nextTick()
  baseline = snapshot()
  void runAll()
  void examplesRunner.runAll()
})
</script>

<template>
  <PageHeader :title="isCreate ? '新建题目' : '编辑题目'" :back="backTo">
    <template #extra>
      <span class="kindTag">编程题</span>
      <n-text v-if="authorLine" depth="3" class="note">{{ authorLine }}</n-text>
    </template>
    <template #actions>
      <n-button v-if="isCreate && draft" quaternary @click="clearDraft">清空草稿</n-button>
    </template>
  </PageHeader>

  <div v-if="ready" class="codeEditor">
    <!-- 左：写 -->
    <div class="write">
      <div v-if="draftRestored" class="notice">上次没保存的草稿已经恢复</div>
      <div v-if="caseNotice" class="notice warn">{{ caseNotice }}</div>

      <!-- 题面 -->
      <section id="section-statement" class="card">
        <button type="button" class="cardHead" @click="open.statement = !open.statement">
          <h3>题面</h3>
          <span v-if="!open.statement" class="summary">
            {{ form._id }} {{ form.title }} · {{ DIFFICULTY[form.difficulty] }} ·
            {{ form.tags.join("、") || "没有标签" }}
          </span>
          <span class="grow"></span>
          <span class="caret">{{ open.statement ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.statement">
          <div class="headRow">
            <n-input
              v-model:value="form._id"
              placeholder="编号"
              aria-label="显示编号"
              class="pid"
            />
            <n-input
              v-model:value="form.title"
              placeholder="题目，比如：星之卡比的复制能力"
              aria-label="题目"
              class="grow"
            />
            <n-select
              v-model:value="form.difficulty"
              :options="difficultyOptions"
              aria-label="难度"
              class="difficulty"
            />
            <label class="switch">
              <n-switch v-model:value="form.visible" size="small" />
              <span>可见</span>
            </label>
          </div>
          <TextEditor v-model:value="form.description" title="" compact :min-height="160" />
          <div class="io">
            <div class="field">
              <div class="fieldHead">
                <span class="label">输入</span>
                <span class="grow"></span>
                <n-button
                  v-if="form.inputDescription !== NO_INPUT"
                  size="tiny"
                  @click="form.inputDescription = NO_INPUT"
                >
                  没有输入
                </n-button>
              </div>
              <TextEditor v-model:value="form.inputDescription" title="" mini :min-height="60" />
            </div>
            <div class="field">
              <div class="fieldHead"><span class="label">输出</span></div>
              <TextEditor v-model:value="form.outputDescription" title="" mini :min-height="60" />
            </div>
          </div>
          <div class="tagRow">
            <span class="label tagLabel">知识点</span>
            <div class="chips">
              <button
                v-for="name in visibleKnowledge"
                :key="name"
                type="button"
                class="chip"
                :class="{ on: form.tags.includes(name) }"
                :aria-pressed="form.tags.includes(name)"
                @click="toggleKnowledge(name)"
              >
                {{ name }}
              </button>
              <button
                v-if="knowledgeTags.length > 10"
                type="button"
                class="chip more"
                @click="showAllKnowledge = !showAllKnowledge"
              >
                {{ showAllKnowledge ? "收起" : `更多 ${knowledgeTags.length - 10} 个 ▾` }}
              </button>
            </div>
          </div>
          <div class="tagRow">
            <span class="label tagLabel">主题</span>
            <n-select
              :value="otherTags"
              :options="themeOptions"
              multiple
              filterable
              tag
              size="small"
              placeholder="选填：选一个主题，或者打字建新的"
              @update:value="onOtherTagsChange"
            />
          </div>
        </template>
      </section>

      <!-- 标准答案 -->
      <section id="section-answer" class="card">
        <button type="button" class="cardHead" @click="open.answer = !open.answer">
          <h3>标准答案</h3>
          <span v-if="!open.answer" class="summary">{{ answerSummary }}</span>
          <span class="grow"></span>
          <n-text v-if="open.answer" depth="3" class="note">学生看不到</n-text>
          <span class="caret">{{ open.answer ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.answer">
          <div class="subHead">
            <n-radio-group v-model:value="answerTab" size="small">
              <n-radio-button v-for="lang in form.languages" :key="lang" :value="lang">
                {{ lang }}{{ form.answers[lang].trim() ? "" : " 没写" }}
              </n-radio-button>
            </n-radio-group>
          </div>
          <n-text depth="3" class="note">
            例子和测试数据的输出都由它跑出来；流程图、AI 分析也看它。写一种语言就够<template
              v-if="source && source.language !== answerTab"
              >，现在按 {{ source.language }} 的跑</template
            >。
          </n-text>
          <CodeEditor
            v-for="lang in form.languages"
            v-show="answerTab === lang"
            :key="lang"
            v-model:value="form.answers[lang]"
            :language="lang"
            :font-size="14"
            :height="codeHeight(form.answers[lang], 8, 24)"
          />
        </template>
      </section>

      <!-- 测试数据 -->
      <section id="section-cases" class="card">
        <button type="button" class="cardHead" @click="open.cases = !open.cases">
          <h3>测试数据</h3>
          <span class="summary">{{ caseSummary }}</span>
          <span class="grow"></span>
          <span class="caret">{{ open.cases ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.cases">
          <div class="toolRow">
            <template v-if="!big">
              <n-button
                size="tiny"
                :loading="generatingInputs"
                :disabled="!source"
                :title="source ? '按题面和标准答案，让 AI 想几组边界情况' : '先写标准答案'"
                @click="aiInputs"
              >
                AI 想几组输入
              </n-button>
              <n-button size="tiny" @click="addRow">+ 加一组</n-button>
            </template>
            <span class="grow"></span>
            <n-button
              v-if="rows.some((r) => r.error)"
              size="tiny"
              :disabled="running"
              @click="rerunFailed"
            >
              重跑没跑通的
            </n-button>
            <n-upload :show-file-list="false" accept=".zip" :custom-request="importZip">
              <n-button size="tiny" quaternary>导入 zip</n-button>
            </n-upload>
            <n-button
              v-if="!big ? rows.length : !!initial"
              size="tiny"
              quaternary
              @click="downloadZip"
            >
              下载 zip
            </n-button>
          </div>

          <template v-if="big">
            <div class="notice">
              有 {{ big.count }} 组、共 {{ formatBytes(big.totalBytes) }}，太大了，页面上不展开 ——
              下载下来改、再导入。导入的 zip 里是 1.in 1.out 2.in 2.out ……
            </div>
            <div class="subHead">
              <b class="small">例子</b>
              <n-text depth="3" class="note">单独写，输出照样由答案跑</n-text>
              <span class="grow"></span>
              <n-button size="tiny" @click="exampleRows.push(newRow('', '', true))"
                >+ 加一个</n-button
              >
            </div>
            <CaseTable v-model:rows="exampleRows" :source="source" examples-only />
          </template>
          <template v-else>
            <div v-if="!source && !isCreate" class="notice">
              这道题没存标准答案，下面的输出是当初上传的文件，可以直接改。在上面写上答案，输出就改成跟着答案跑。
            </div>
            <div
              v-if="
                !rows.length ||
                (rows.length === 1 && !rows[0]!.input && !rows[0]!.output && isCreate)
              "
              class="empty"
            >
              {{
                source
                  ? "加几组输入，输出会自己跑出来。"
                  : "先在上面写好标准答案，再加几组输入 —— 输出会自己跑出来。"
              }}
              例子之外最好再有几组边界情况（0、负数、最大值……）。
            </div>
            <CaseTable v-if="rows.length" v-model:rows="rows" :source="source" />
            <n-text depth="3" class="note">
              勾上「当例子」的几组按顺序写进题面的例子{{
                source ? "；改了输入，输出马上重跑" : ""
              }}。
            </n-text>
          </template>
        </template>
      </section>

      <!-- 学生怎么写 -->
      <section id="section-write" class="card">
        <button type="button" class="cardHead" @click="open.write = !open.write">
          <h3>学生怎么写</h3>
          <span v-if="!open.write" class="summary">{{ writeSummary }}</span>
          <span class="grow"></span>
          <span class="caret">{{ open.write ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.write">
          <div class="inlineRow">
            <span class="label rowLabel">能交的语言</span>
            <n-checkbox-group v-model:value="form.languages">
              <n-space>
                <n-checkbox v-for="lang in RUNNABLE" :key="lang" :value="lang" :label="lang" />
              </n-space>
            </n-checkbox-group>
          </div>
          <n-divider class="thin" />
          <div class="inlineRow">
            <span class="label rowLabel">预制代码</span>
            <n-radio-group v-model:value="templateTab" size="small">
              <n-radio-button v-for="lang in form.languages" :key="lang" :value="lang">
                {{ lang }}{{ form.templates[lang].template.trim() ? "" : " 用默认的" }}
              </n-radio-button>
            </n-radio-group>
          </div>
          <n-text depth="3" class="note">
            学生打开编辑器时里面已经有的代码，比如先把输入写好，让学生专心写判断。
          </n-text>
          <template v-for="lang in form.languages" :key="lang">
            <template v-if="templateTab === lang">
              <CodeEditor
                v-model:value="form.templates[lang].template"
                :language="lang"
                :font-size="14"
                :height="codeHeight(form.templates[lang].template, 4, 16)"
                placeholder="不写就用全站默认的"
              />
              <n-button text size="small" class="hiddenToggle" @click="showHidden = !showHidden">
                {{ showHidden ? "▾" : "›" }} 藏在学生代码前面 / 后面一起运行的代码（学生看不到）
              </n-button>
              <template v-if="showHidden">
                <span class="label">前面</span>
                <CodeEditor
                  v-model:value="form.templates[lang].prepend"
                  :language="lang"
                  :font-size="13"
                  height="80px"
                />
                <span class="label">后面</span>
                <CodeEditor
                  v-model:value="form.templates[lang].append"
                  :language="lang"
                  :font-size="13"
                  height="80px"
                />
              </template>
            </template>
          </template>
          <n-divider class="thin" />
          <AstRulesEditor
            v-model="form.astRules"
            v-model:checks="astChecks"
            :languages="form.languages"
            :answers="answersForAst"
          />
        </template>
      </section>

      <!-- 流程图 -->
      <section id="section-flowchart" class="card">
        <button type="button" class="cardHead" @click="open.flowchart = !open.flowchart">
          <h3>流程图</h3>
          <span v-if="!open.flowchart" class="summary">{{
            FLOWCHART_LABEL[form.flowchartMode]
          }}</span>
          <n-text v-else depth="3" class="note">选填，三选一</n-text>
          <span class="grow"></span>
          <span class="caret">{{ open.flowchart ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.flowchart">
          <n-radio-group v-model:value="form.flowchartMode" class="modes">
            <label class="mode" :class="{ on: form.flowchartMode === 'none' }">
              <n-radio value="none" /><b>不用</b>
            </label>
            <label class="mode" :class="{ on: form.flowchartMode === 'show' }">
              <n-radio value="show" />
              <span>
                <b>给学生看一张参考流程图</b>
                <small>题面里多一条「老师给的参考流程图」，默认收着，学生点开才看</small>
              </span>
            </label>
            <label class="mode" :class="{ on: form.flowchartMode === 'draw' }">
              <n-radio value="draw" />
              <span>
                <b>让学生自己画，按这张图打分</b>
                <small>这张图学生看不到，只拿来给学生画的图打分；画到 A / S 级算做完</small>
              </span>
            </label>
          </n-radio-group>
          <template v-if="form.flowchartMode !== 'none'">
            <div class="inlineRow">
              <span class="label">图的代码（Mermaid）</span>
              <span class="grow"></span>
              <n-button
                size="tiny"
                :loading="aiDrawing"
                :disabled="!form.answers.Python.trim()"
                :title="form.answers.Python.trim() ? '' : '先写 Python 的标准答案'"
                @click="aiFlowchart"
              >
                AI 照 Python 答案画一张
              </n-button>
            </div>
            <n-input
              v-model:value="form.mermaidCode"
              type="textarea"
              class="mono"
              :autosize="{ minRows: 6, maxRows: 18 }"
              placeholder="graph TD&#10;    A[开始] --> B[输入 n]"
            />
            <n-text
              v-if="form.mermaidCode.trim()"
              :type="mermaidOk ? 'success' : 'error'"
              class="note"
            >
              {{ mermaidOk ? "✓ 画得出来（右边就是）" : "✗ 还画不出来，看右边的报错" }}
            </n-text>
            <n-input
              v-if="form.flowchartMode === 'draw'"
              v-model:value="form.flowchartHint"
              placeholder="给学生的提示（选填），比如：先判断门是不是开着"
            />
          </template>
        </template>
      </section>

      <!-- 提示和其他 -->
      <section id="section-more" class="card">
        <button type="button" class="cardHead" @click="open.more = !open.more">
          <h3>提示和其他</h3>
          <span v-if="!open.more" class="summary">{{ moreSummary }}</span>
          <n-text v-else depth="3" class="note">都是选填</n-text>
          <span class="grow"></span>
          <span class="caret">{{ open.more ? "⌃" : "›" }}</span>
        </button>
        <template v-if="open.more">
          <span class="label">提示（学生卡住时点开看）</span>
          <TextEditor v-model:value="form.hint" title="" simple :min-height="60" />
          <div class="inlineRow wrap">
            <label class="inlineRow grow">
              <span class="label">来源</span>
              <n-input v-model:value="form.source" placeholder="比如：改编自某道题" />
            </label>
            <label class="inlineRow">
              <span class="label">时间限制</span>
              <n-input-number
                v-model:value="form.timeLimit"
                :min="1"
                :max="60000"
                :show-button="false"
                style="width: 110px"
              >
                <template #suffix>毫秒</template>
              </n-input-number>
            </label>
            <label class="inlineRow">
              <span class="label">内存限制</span>
              <n-input-number
                v-model:value="form.memoryLimit"
                :min="1"
                :max="1024"
                :show-button="false"
                style="width: 96px"
              >
                <template #suffix>MB</template>
              </n-input-number>
            </label>
          </div>
          <label class="inlineRow">
            <span class="label">给 AI 看的知识点</span>
            <n-input v-model:value="form.prompt" placeholder="比如：列表去重、while 循环" />
          </label>
        </template>
      </section>

      <div class="saveBar">
        <n-button type="primary" :loading="saving" :disabled="!!blockers.length" @click="save">
          保存
        </n-button>
        <div v-if="blockers.length" class="blockers">
          <span class="blockersHead">保存前还要：</span>
          <template v-for="(b, i) in blockers" :key="i">
            <span v-if="i > 0" class="sep">·</span>
            <button type="button" class="blocker" :class="{ severe: b.severe }" @click="jump(b)">
              {{ b.text }}
            </button>
          </template>
        </div>
        <n-text v-else :type="changedCount ? 'warning' : 'success'" class="note">
          {{ saveNote }}
        </n-text>
      </div>
    </div>

    <!-- 右：学生看到的 -->
    <CodePreview
      v-model:tab="preview"
      :display-id="form._id"
      :title="form.title"
      :difficulty="form.difficulty"
      :description="form.description"
      :input-description="form.inputDescription"
      :output-description="form.outputDescription"
      :hint="form.hint"
      :examples="examples"
      :examples-note="examplesNote"
      :languages="form.languages"
      :templates="templatesForPreview"
      :ast-rules="form.astRules"
      :ast-checks="astChecks"
      :flowchart-mode="form.flowchartMode"
      :mermaid-code="form.mermaidCode"
      :flowchart-hint="form.flowchartHint"
      @render-state="mermaidOk = $event"
    />
  </div>
</template>

<style scoped>
.kindTag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 3px;
  background-color: rgba(24, 160, 88, 0.12);
  color: v-bind("theme.primaryColorPressed");
  font-size: 12px;
  font-weight: 600;
}

.note {
  font-size: 12px;
}

.codeEditor {
  display: grid;
  grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

/* 窄屏（老师的小笔记本）放不下两栏：预览挪到下面 */
@media (max-width: 1180px) {
  .codeEditor {
    grid-template-columns: minmax(0, 1fr);
  }
}

.write {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.notice {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.6;
  background-color: rgba(128, 128, 128, 0.08);
}

.notice.warn {
  background-color: rgba(240, 160, 32, 0.12);
}

.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: v-bind("theme.cardColor");
  scroll-margin-top: 12px;
}

.card :deep(.editorWrapper) {
  margin-bottom: 0;
}

.cardHead {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.cardHead h3 {
  margin: 0;
  font-size: 15px;
  flex: none;
  width: 84px;
}

.summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.caret {
  color: v-bind("theme.textColor3");
}

.headRow,
.subHead,
.toolRow,
.tagRow,
.inlineRow,
.fieldHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inlineRow.wrap {
  flex-wrap: wrap;
  gap: 10px 16px;
}

.tagRow {
  align-items: flex-start;
}

.pid {
  width: 84px;
  flex: none;
}

.difficulty {
  width: 84px;
  flex: none;
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
  color: v-bind("theme.textColor2");
  flex: none;
}

.rowLabel {
  width: 72px;
}

.tagLabel {
  width: 44px;
  line-height: 24px;
}

.small {
  font-size: 13px;
}

/*
 * align-items: start 不能省：wangEditor 给内容区写死了 height: 100%，格子把 .field 拉伸成
 * 确定高度之后这个 100% 就按外框算，工具栏的高度被挤出去，编辑框盖到下面的知识点那行上
 */
.io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fieldHead {
  height: 24px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 24px;
  padding: 0 9px;
  border-radius: 3px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.chip.on {
  border-color: rgba(24, 160, 88, 0.5);
  background-color: rgba(24, 160, 88, 0.12);
  color: v-bind("theme.primaryColorPressed");
  font-weight: 600;
}

.chip.more {
  color: v-bind("theme.textColor3");
}

.empty {
  padding: 14px 10px;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
  color: v-bind("theme.textColor3");
}

.thin {
  margin: 2px 0;
}

.hiddenToggle {
  align-self: flex-start;
  font-size: 12px;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mode {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.mode.on {
  border-color: v-bind("theme.primaryColor");
  background-color: rgba(24, 160, 88, 0.06);
}

.mode span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode small {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.mono :deep(textarea) {
  font-family: ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;
  font-size: 13px;
}

.saveBar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 14px;
  background: v-bind("theme.bodyColor");
  border-top: 1px solid v-bind("theme.borderColor");
}

/* 一行放不下就折，最多两行：新建页一开始缺七八样，别把保存栏撑成半屏 */
.blockers {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.6;
  padding-top: 4px;
}

.blockersHead,
.sep {
  color: v-bind("theme.textColor3");
}

.sep {
  margin: 0 4px;
}

.blocker {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: v-bind("theme.textColor1");
  text-align: left;
  cursor: pointer;
}

.blocker.severe {
  color: v-bind("theme.errorColor");
}

.blocker:hover {
  text-decoration: underline;
}
</style>
