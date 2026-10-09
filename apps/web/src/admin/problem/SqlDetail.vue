<script setup lang="ts">
import { EditorView } from "@codemirror/view"
import { PROBLEM_TAG_MAX_LENGTH } from "@oj2/contract"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { StorageSerializers } from "@vueuse/core"
import { useThemeVars } from "naive-ui"
import PageHeader from "admin/components/PageHeader.vue"
import ProblemTypeTag from "oj/problem/components/ProblemTypeTag.vue"
import SqlProblemData from "oj/problem/components/SqlProblemData.vue"
import { getProblemTagList } from "shared/api"
import TextEditor from "shared/components/TextEditor.vue"
import { errorCode, errorMessage, isApiError } from "utils/api"
import { DIFFICULTY, STORAGE_KEY } from "utils/constants"
import { createZipBlob, getTagColor, unique } from "utils/functions"
import type { AdminProblem, BlankProblem, SqlConfig, Tag, Testcase } from "utils/types"
import {
  createContestProblem,
  createProblem,
  editProblem,
  generateSQLTestcase,
  getSQLTestcaseScripts,
  previewSQLTestcase,
  uploadTestcases,
} from "../api"
import {
  explainSqlError,
  groupSummary,
  type GroupStatus,
  type ScriptGroup,
} from "./components/sqlScript"

const CodeEditor = defineAsyncComponent(() => import("shared/components/CodeEditor.vue"))
/** 标准答案常是一长行，出题页左栏才 560 宽：折行，别横着滚。给稳定的数组，见 CodeEditor 的注释 */
const wrapLines = [EditorView.lineWrapping]

/**
 * SQL 题的出题页（设计稿「SQL 出题页」方案 B）：左边写，右边就是学生打开这道题看到的样子。
 *
 * 和编程题分成两页，是因为两种题要填的东西几乎不重合 —— 没有输入输出说明和样例，
 * 测试数据是建表脚本而不是输入 / 输出对，标准答案是判题依据而不是给 AI 看的参考。
 * 题型在新建时选定（后台题目列表的「新建题目」），之后不能改。
 *
 * 测试数据改了不用手动「预览」「上传」：改完自动重跑，保存时再打包上传。
 */
const props = defineProps<{
  problemID?: string
  contestID?: string
  /** 编辑时外层已经拉过一次题目（要靠它判断题型），直接给进来 */
  initial?: AdminProblem | null
}>()

const message = useMessage()
const router = useRouter()
const theme = useThemeVars()
const isDark = useDark()

const isCreate = computed(() => !props.problemID)

// ---------------------------------------------------------------- 表单

interface SqlForm {
  _id: string
  title: string
  difficulty: BlankProblem["difficulty"]
  visible: boolean
  tags: string[]
  description: string
  hint: string
  source: string
  prompt: string
  memoryLimit: number
  timeLimit: number
  sqlConfig: SqlConfig
  answer: string
}

const blankForm = (): SqlForm => ({
  _id: "",
  title: "",
  difficulty: "Low",
  visible: false,
  tags: ["SQL"],
  description: "",
  hint: "",
  source: "",
  prompt: "",
  memoryLimit: 64,
  timeLimit: 1000,
  sqlConfig: { mode: "query", order_sensitive: false },
  answer: "",
})

const form = reactive<SqlForm>(blankForm())

/** 富文本编辑器清空之后留下的是一个空段落，不是空串 */
const isBlankHtml = (html: string) => !html.trim() || html === "<p><br></p>"

const difficultyOptions = (["Low", "Mid", "High"] as const).map((value) => ({
  label: DIFFICULTY[value],
  value,
}))
const testCase = reactive({ id: "", score: [] as Testcase[] })

let nextKey = 0
function newGroup(sql = ""): ScriptGroup {
  return { key: nextKey++, sql, ranFor: "", display: null, error: "", errorRaw: "", running: "" }
}
const groups = ref<ScriptGroup[]>([])
const selected = ref(0)
/** 打开时库里那几份脚本：没改过就不用重新上传 */
let savedScripts: string[] = []
/** 已有的测试数据没读出来。空白编辑器和「本来就没有」长得一样，必须说出来 */
const loadError = ref("")

const showMore = ref(false)
const ready = ref(false)

// 新建时存草稿：出一道 SQL 题要写好几段脚本，误关页面全没了太亏
// 初值是 null 时 VueUse 推不出类型，会拿 String() 存成 "[object Object]"，得显式指定
const draft = useLocalStorage<{ form: SqlForm; scripts: string[] } | null>(
  STORAGE_KEY.ADMIN_SQL_PROBLEM,
  null,
  { serializer: StorageSerializers.object },
)

watchDebounced(
  () => [form, groups.value.map((g) => g.sql)] as const,
  () => {
    if (!ready.value || !isCreate.value) return
    const scripts = groups.value.map((g) => g.sql)
    const empty =
      !form._id &&
      !form.title &&
      isBlankHtml(form.description) &&
      !form.answer &&
      !scripts.some(Boolean)
    draft.value = empty ? null : { form: { ...form }, scripts }
  },
  { debounce: 800, deep: true },
)

function clearDraft() {
  draft.value = null
  Object.assign(form, blankForm())
  groups.value = [newGroup(), newGroup()]
  selected.value = 0
}

async function load() {
  if (isCreate.value) {
    // 草稿是本机存的，形状不对（旧版本、被别的页面写坏）就当没有，别让整页起不来
    const saved = draft.value
    if (saved && typeof saved.form === "object" && Array.isArray(saved.scripts)) {
      Object.assign(form, blankForm(), saved.form)
      groups.value = saved.scripts.map((sql) => newGroup(String(sql)))
    } else {
      draft.value = null
    }
    if (groups.value.length < 2) groups.value = [newGroup(), newGroup()]
    ready.value = true
    return
  }
  const data = props.initial
  if (!data) return
  Object.assign(form, {
    _id: data._id,
    title: data.title,
    difficulty: data.difficulty,
    visible: data.visible,
    tags: data.tags,
    description: data.description,
    hint: data.hint ?? "",
    source: data.source ?? "",
    prompt: data.prompt ?? "",
    memoryLimit: data.memoryLimit,
    timeLimit: data.timeLimit,
    sqlConfig: data.sqlConfig ?? { mode: "query", order_sensitive: false },
    answer: data.answers.find((a) => a.language === "SQL")?.code ?? "",
  } satisfies SqlForm)
  testCase.id = data.testCaseId
  testCase.score = data.testCaseScore
  try {
    const scripts = await getSQLTestcaseScripts(data.id)
    savedScripts = scripts.map((s) => s.content)
    groups.value = savedScripts.map((sql) => newGroup(sql))
  } catch (err) {
    const code = errorCode(err)
    // 测试点是旧格式（不是 SQL 脚本）时后端回 not-sql-test-case，当作「还没有」就对了
    if (code !== "problem-not-found" && code !== "not-sql-test-case") {
      const detail = isApiError(err) && typeof err.data === "string" ? `（${err.data}）` : ""
      loadError.value =
        `已有的测试数据没读出来${detail}。下面是空白的，不是这道题真实的测试数据 —— ` +
        `直接保存会把它换掉，先排查测试点文件再改。`
    }
  }
  if (groups.value.length < 2) {
    while (groups.value.length < 2) groups.value.push(newGroup())
  }
  ready.value = true
}

// ---------------------------------------------------------------- 标签

const tagList = shallowRef<Tag[]>([])
const tagOptions = computed(() =>
  unique([...tagList.value.map((t) => t.name), ...form.tags]).map((name) => ({
    label: name,
    value: name,
  })),
)

function onTagsChange(tags: string[]) {
  const tooLong = tags.find((t) => t.length > PROBLEM_TAG_MAX_LENGTH)
  if (tooLong) {
    message.error(`标签最多 ${PROBLEM_TAG_MAX_LENGTH} 个字：${tooLong}`)
    return
  }
  form.tags = unique(tags.map((t) => t.trim()).filter(Boolean))
}

// ---------------------------------------------------------------- 测试数据：自动重跑

/**
 * 一组数据跑出来的结果取决于这几样，任何一样变了，原来的结果就作废。
 * 排在第一也算：删掉第 1 组之后，原来的第 2 组成了题面展示的那组，增删改题得重查它改没改到行
 */
const signatureOf = (g: ScriptGroup) =>
  JSON.stringify([form.answer, form.sqlConfig.mode, g.sql, groups.value[0] === g])

function statusOf(g: ScriptGroup): GroupStatus {
  if (!g.sql.trim()) return "empty"
  if (!form.answer.trim()) return "no-answer"
  if (g.ranFor !== signatureOf(g)) return "running"
  return g.error ? "error" : "ok"
}

async function run(g: ScriptGroup) {
  const signature = signatureOf(g)
  if (!g.sql.trim() || !form.answer.trim()) return
  if (g.ranFor === signature || g.running === signature) return
  g.running = signature
  let display: ScriptGroup["display"] = null
  let errorRaw = ""
  try {
    display = await previewSQLTestcase({
      initSql: g.sql,
      refSql: form.answer,
      mode: form.sqlConfig.mode,
      shown: groups.value[0] === g,
    })
  } catch (err) {
    errorRaw =
      isApiError(err) && typeof err.data === "string" ? err.data : errorMessage(err, "跑不起来")
  }
  // 跑的过程中又改了：这次的结果照样记下（ranFor 说明它对应哪一版），新的那版另有一次在跑
  if (g.running === signature) g.running = ""
  g.ranFor = signature
  g.display = display
  g.error = errorRaw && explainSqlError(errorRaw)
  g.errorRaw = errorRaw
}

function runAll() {
  groups.value.forEach((g) => void run(g))
}

watchDebounced(
  // 带上 key：删组、挪了谁排第一也要重跑（见 signatureOf）
  () => [form.answer, form.sqlConfig.mode, groups.value.map((g) => `${g.key}:${g.sql}`)] as const,
  runAll,
  { debounce: 600, deep: true },
)

function addGroup() {
  groups.value.push(newGroup())
  selected.value = groups.value.length - 1
}

function removeGroup(index: number) {
  groups.value.splice(index, 1)
  if (selected.value >= groups.value.length) selected.value = groups.value.length - 1
}

const generating = ref(false)

async function generateGroup() {
  generating.value = true
  try {
    const res = await generateSQLTestcase({ refSql: form.answer, mode: form.sqlConfig.mode })
    // 有空着的组就填进去，没有再加一组
    const blank = groups.value.findIndex((g) => !g.sql.trim())
    if (blank >= 0) {
      groups.value[blank]!.sql = res.sql
      selected.value = blank
    } else {
      groups.value.push(newGroup(res.sql))
      selected.value = groups.value.length - 1
    }
  } catch (err) {
    message.error(errorMessage(err, "AI 没写出来，稍后再试"))
  } finally {
    generating.value = false
  }
}

const current = computed(() => groups.value[selected.value])

// ---------------------------------------------------------------- 保存

/** 为什么还不能保存。按出题的顺序查，只说第一条 */
const blocker = computed(() => {
  if (!form._id.trim() || !form.title.trim()) return "编号和题目还没填"
  if (isBlankHtml(form.description)) return "题目描述还没写"
  if (!form.tags.length) return "至少要有一个标签"
  if (!form.answer.trim()) return "标准答案还没写"
  if (groups.value.length < 2) return "测试数据至少要 2 组"
  for (const [i, g] of groups.value.entries()) {
    if (!g.sql.trim()) return `第 ${i + 1} 组还是空的，写上或删掉`
  }
  const seen = new Map<string, number>()
  for (const [i, g] of groups.value.entries()) {
    const same = seen.get(g.sql.trim())
    if (same !== undefined) return `第 ${same + 1} 组和第 ${i + 1} 组一模一样，数据要不一样`
    seen.set(g.sql.trim(), i)
  }
  for (const [i, g] of groups.value.entries()) {
    const status = statusOf(g)
    if (status === "running") return "测试数据还在跑……"
    if (status === "error") return `第 ${i + 1} 组还没跑通，改好或删掉才能保存`
  }
  return ""
})

const saving = ref(false)

async function uploadScripts(scripts: string[]) {
  const blob = createZipBlob(scripts.map((content, i) => ({ name: `${i + 1}.sql`, content })))
  const res = await uploadTestcases(new File([blob], "testcase.zip", { type: "application/zip" }), {
    sql: true,
  })
  // 分值平分，余数给最后一组；只留落库的三个键（见契约 problemTestCaseScoreSchema）
  const base = Math.floor(100 / res.info.length)
  const rest = 100 - base * res.info.length
  testCase.id = res.id
  testCase.score = res.info.map((entry, i) => ({
    input_name: entry.input_name,
    output_name: entry.output_name,
    score: i === res.info.length - 1 ? base + rest : base,
  }))
}

async function save() {
  if (blocker.value) {
    message.warning(blocker.value)
    return
  }
  saving.value = true
  try {
    const scripts = groups.value.map((g) => g.sql)
    const changed =
      !testCase.id ||
      scripts.length !== savedScripts.length ||
      scripts.some((sql, i) => sql !== savedScripts[i])
    if (changed) await uploadScripts(scripts)

    const body: BlankProblem = {
      _id: form._id.trim(),
      title: form.title.trim(),
      description: form.description,
      inputDescription: "",
      outputDescription: "",
      samples: [],
      testCaseId: testCase.id,
      testCaseScore: testCase.score,
      timeLimit: form.timeLimit,
      memoryLimit: form.memoryLimit,
      difficulty: form.difficulty,
      visible: form.visible,
      tags: form.tags,
      languages: ["SQL"],
      template: {},
      hint: isBlankHtml(form.hint) ? "" : form.hint,
      source: form.source,
      prompt: form.prompt,
      answers: [{ language: "SQL", code: form.answer }],
      allowFlowchart: false,
      showFlowchart: false,
      mermaidCode: "",
      flowchartHint: "",
      astRules: null,
      sqlConfig: form.sqlConfig,
      sqlDisplay: null,
      contestId: props.contestID ? Number(props.contestID) : null,
    }
    if (!isCreate.value) {
      await editProblem({ ...body, id: props.initial!.id })
    } else if (props.contestID) {
      await createContestProblem(body)
    } else {
      await createProblem(body)
    }
    savedScripts = scripts
    if (isCreate.value) {
      draft.value = null
      message.success("SQL 题建好了")
    } else {
      message.success("保存好了")
    }
    router.push(
      props.contestID
        ? { name: "admin contest problem list", params: { contestID: props.contestID } }
        : { name: "admin problem list" },
    )
  } catch (err) {
    message.error(
      errorCode(err) === "display-id-exists" ? "显示编号重复了，换一个" : errorMessage(err),
    )
  } finally {
    saving.value = false
  }
}

const backTo = computed(() =>
  props.contestID
    ? { name: "admin contest problem list", params: { contestID: props.contestID } }
    : { name: "admin problem list" },
)

onMounted(async () => {
  getProblemTagList().then((res) => (tagList.value = res))
  await load()
  runAll()
})
</script>

<template>
  <PageHeader :title="isCreate ? '新建题目' : '编辑题目'" :back="backTo">
    <template #extra>
      <ProblemTypeTag kind="sql" />
      <n-text depth="3" class="kindNote">题型在新建时定下，之后不能改</n-text>
    </template>
    <template #actions>
      <n-button v-if="isCreate && draft" quaternary @click="clearDraft">清空草稿</n-button>
    </template>
  </PageHeader>

  <div v-if="ready" class="sqlEditor">
    <!-- 左：写 -->
    <div class="write">
      <section class="card">
        <div class="headRow">
          <n-input v-model:value="form._id" placeholder="编号" aria-label="显示编号" class="pid" />
          <n-input
            v-model:value="form.title"
            placeholder="题目，比如：统计平均工资超过6000元的部门"
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
        <TextEditor v-model:value="form.description" title="" simple :min-height="140" />
        <n-text depth="3" class="note">
          数据表和期望结果会自动接在描述后面给学生看（用第 1
          组测试数据），描述里不用再抄一遍表结构。
        </n-text>
        <div class="tagRow">
          <span class="label">标签</span>
          <n-select
            :value="form.tags"
            :options="tagOptions"
            multiple
            filterable
            tag
            placeholder="选一个，或者打字建新的"
            @update:value="onTagsChange"
          />
        </div>
        <n-button text type="primary" class="moreToggle" @click="showMore = !showMore">
          提示 · 来源 · 内存限制 {{ showMore ? "▴" : "▾" }}
        </n-button>
        <div v-if="showMore" class="more">
          <div class="label">提示（学生卡住时点开看）</div>
          <TextEditor v-model:value="form.hint" title="" simple :min-height="60" />
          <div class="moreRow">
            <label class="field grow">
              <span class="label">来源</span>
              <n-input v-model:value="form.source" placeholder="比如：教学示例" />
            </label>
            <label class="field">
              <span class="label">内存限制</span>
              <n-input-number
                v-model:value="form.memoryLimit"
                :min="1"
                :max="1024"
                :show-button="false"
                style="width: 110px"
              >
                <template #suffix>MB</template>
              </n-input-number>
            </label>
          </div>
          <label class="field">
            <span class="label">考察的知识点（给 AI 分析用）</span>
            <n-input v-model:value="form.prompt" placeholder="比如：多表连接、分组聚合" />
          </label>
        </div>
      </section>

      <section class="card">
        <div class="cardHead">
          <h3>判题</h3>
          <n-radio-group v-model:value="form.sqlConfig.mode" size="small">
            <n-radio-button value="query">查询 · 比结果</n-radio-button>
            <n-radio-button value="modify">增删改 · 比执行完的表</n-radio-button>
          </n-radio-group>
          <n-checkbox
            v-if="form.sqlConfig.mode === 'query'"
            v-model:checked="form.sqlConfig.order_sensitive"
            size="small"
          >
            按顺序比
          </n-checkbox>
        </div>
        <div class="subHead">
          <span class="label">标准答案</span>
          <n-text depth="3" class="note">
            {{
              form.sqlConfig.mode === "query"
                ? "每组数据都拿它跑出期望结果，学生看不到"
                : "执行完之后，被改过的表就是期望结果，学生看不到"
            }}
          </n-text>
        </div>
        <CodeEditor
          v-model:value="form.answer"
          language="SQL"
          :extra-extensions="wrapLines"
          :font-size="14"
          height="120px"
          placeholder="SELECT ... FROM ..."
        />
      </section>

      <section class="card">
        <div class="cardHead">
          <h3>测试数据</h3>
          <n-text depth="3" class="note">至少 2 组，数据要不一样</n-text>
          <div class="grow"></div>
          <n-button
            size="tiny"
            :loading="generating"
            :disabled="!form.answer.trim()"
            :title="form.answer.trim() ? '按标准答案用到的表，让 AI 编一组数据' : '先写标准答案'"
            @click="generateGroup"
          >
            AI 再写一组
          </n-button>
          <n-button size="tiny" @click="addGroup">+ 加一组</n-button>
        </div>
        <n-alert v-if="loadError" type="error" :show-icon="false">{{ loadError }}</n-alert>
        <div class="groups" role="listbox" aria-label="测试数据">
          <div
            v-for="(g, i) in groups"
            :key="g.key"
            role="option"
            tabindex="0"
            :aria-selected="i === selected"
            class="group"
            :class="{ on: i === selected, bad: statusOf(g) === 'error' }"
            @click="selected = i"
            @keydown.enter="selected = i"
          >
            <b class="groupNo">第 {{ i + 1 }} 组</b>
            <span v-if="i === 0" class="shown">题目里显示这组</span>
            <span class="summary" :class="{ error: statusOf(g) === 'error' }">
              <template v-if="statusOf(g) === 'empty'">还没写</template>
              <template v-else-if="statusOf(g) === 'no-answer'">等标准答案</template>
              <template v-else-if="statusOf(g) === 'running'">在跑……</template>
              <template v-else-if="statusOf(g) === 'error'">{{ g.error }}</template>
              <template v-else-if="g.display">{{ groupSummary(g.display) }}</template>
            </span>
            <span v-if="statusOf(g) === 'ok'" class="mark ok" aria-label="跑通了">✓</span>
            <span v-else-if="statusOf(g) === 'error'" class="mark error" aria-label="没跑通"
              >✗</span
            >
            <n-button
              v-if="groups.length > 1"
              size="tiny"
              quaternary
              class="remove"
              :aria-label="`删掉第 ${i + 1} 组`"
              @click.stop="removeGroup(i)"
            >
              删掉
            </n-button>
          </div>
        </div>
        <template v-if="current">
          <div class="subHead">
            <span class="label">第 {{ selected + 1 }} 组的脚本</span>
            <n-text depth="3" class="note">建表 + 插数据，改完右边马上重跑</n-text>
          </div>
          <CodeEditor
            :key="current.key"
            v-model:value="current.sql"
            language="SQL"
            :extra-extensions="wrapLines"
            :font-size="14"
            height="260px"
            placeholder="CREATE TABLE ...;&#10;INSERT INTO ... VALUES ...;"
          />
        </template>
      </section>

      <div class="saveBar">
        <n-button type="primary" :loading="saving" :disabled="!!blocker" @click="save">
          保存
        </n-button>
        <n-text v-if="blocker" :type="blocker.includes('没跑通') ? 'error' : 'default'" depth="2">
          {{ blocker }}
        </n-text>
        <n-text v-else type="success">{{ groups.length }} 组都跑通了</n-text>
      </div>
    </div>

    <!-- 右：学生看到的 -->
    <aside class="preview" aria-label="学生看到的样子">
      <div class="previewHead">
        <b>学生看到的样子</b>
        <div class="grow"></div>
        <n-radio-group v-model:value="selected" size="small">
          <n-radio-button v-for="(g, i) in groups" :key="g.key" :value="i">
            第 {{ i + 1 }} 组<span v-if="statusOf(g) === 'error'" class="error"> ✗</span>
          </n-radio-button>
        </n-radio-group>
      </div>
      <div class="page">
        <div class="titleRow">
          <h2>
            <span v-if="form._id">{{ form._id }}</span> {{ form.title || "（题目还没起名）" }}
          </h2>
          <ProblemTypeTag kind="sql" />
          <n-tag size="small" :bordered="false" :type="getTagColor(form.difficulty)">
            {{ DIFFICULTY[form.difficulty] }}
          </n-tag>
        </div>
        <h3 class="title">描述</h3>
        <MdPreview
          preview-theme="vuepress"
          :model-value="form.description"
          :theme="isDark ? 'dark' : 'light'"
        />
        <p v-if="selected > 0" class="otherGroup">
          学生看到的是第 1 组，下面是第 {{ selected + 1 }} 组跑出来的样子
        </p>
        <template v-if="current">
          <p v-if="statusOf(current) === 'no-answer'" class="placeholder">
            写好标准答案，这里就跑出期望结果
          </p>
          <p v-else-if="statusOf(current) === 'empty'" class="placeholder">
            第 {{ selected + 1 }} 组还没写脚本
          </p>
          <p v-else-if="statusOf(current) === 'running' && !current.display" class="placeholder">
            在跑……
          </p>
          <div v-else-if="statusOf(current) === 'error'" class="errorBox">
            {{ current.error }}
            <div v-if="current.error.startsWith('标准答案在这组数据上')" class="raw">
              每组数据都要建齐标准答案用到的表和列。
            </div>
            <div v-if="current.error !== current.errorRaw" class="raw small">
              原话：{{ current.errorRaw }}
            </div>
          </div>
          <div v-else-if="current.display" :class="{ stale: statusOf(current) === 'running' }">
            <SqlProblemData
              :display="current.display"
              :order-sensitive="form.sqlConfig.order_sensitive"
            >
              <template #title="{ text }">
                <h3 class="title sqlTitle">{{ text }}</h3>
              </template>
            </SqlProblemData>
          </div>
        </template>
        <template v-if="!isBlankHtml(form.hint)">
          <h3 class="title sqlTitle">提示</h3>
          <MdPreview
            preview-theme="vuepress"
            :model-value="form.hint"
            :theme="isDark ? 'dark' : 'light'"
          />
        </template>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.kindNote {
  font-size: 12px;
}

.sqlEditor {
  display: grid;
  grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

/* 窄屏（老师的小笔记本）放不下两栏：预览挪到下面 */
@media (max-width: 1180px) {
  .sqlEditor {
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
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: v-bind("theme.cardColor");
}

.card :deep(.editorWrapper) {
  margin-bottom: 0;
}

.headRow,
.cardHead,
.subHead,
.tagRow,
.moreRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cardHead {
  flex-wrap: wrap;
}

.cardHead h3 {
  margin: 0;
  font-size: 15px;
}

.subHead {
  align-items: baseline;
  gap: 8px;
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

.note {
  font-size: 12px;
}

.moreToggle {
  align-self: flex-start;
  font-size: 13px;
}

.more {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.moreRow {
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group {
  min-height: 36px;
  box-sizing: border-box;
  padding: 4px 6px 4px 10px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  cursor: pointer;
}

.group:hover {
  background-color: rgba(128, 128, 128, 0.08);
}

.group.on {
  background-color: rgba(24, 160, 88, 0.1);
  box-shadow: inset 3px 0 0 v-bind("theme.primaryColor");
}

.group.on.bad {
  background-color: rgba(208, 48, 80, 0.08);
  box-shadow: inset 3px 0 0 v-bind("theme.errorColor");
}

.groupNo {
  flex: none;
  width: 48px;
}

.shown {
  flex: none;
  font-size: 12px;
  color: v-bind("theme.primaryColorPressed");
}

.summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: v-bind("theme.textColor3");
}

.mark {
  flex: none;
  font-weight: 700;
}

.ok {
  color: v-bind("theme.successColor");
}

.error {
  color: v-bind("theme.errorColor");
}

.summary.error {
  color: v-bind("theme.errorColor");
}

.remove {
  flex: none;
  opacity: 0;
}

.group:hover .remove,
.group.on .remove,
.remove:focus-visible {
  opacity: 1;
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

.preview {
  position: sticky;
  top: 12px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.previewHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 14px;
}

.page {
  max-height: calc(100vh - 170px);
  overflow: auto;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  padding: 18px 22px;
  background: v-bind("theme.cardColor");
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.titleRow h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
}

/* 和题目页的小节标题一个样子（oj/problem/components/ProblemContent.vue） */
.title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px;
  padding-left: 9px;
  border-left: 3px solid v-bind("theme.primaryColor");
}

.sqlTitle {
  margin-top: 14px;
}

.page :deep(.md-editor) {
  background: transparent;
}

.page :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.otherGroup {
  margin: 14px 0 0;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  background-color: rgba(128, 128, 128, 0.08);
  color: v-bind("theme.textColor2");
}

.placeholder {
  margin: 14px 0 0;
  color: v-bind("theme.textColor3");
}

.errorBox {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 4px;
  background-color: rgba(208, 48, 80, 0.08);
  color: v-bind("theme.errorColor");
  font-size: 13px;
  line-height: 1.7;
}

.errorBox .raw {
  color: v-bind("theme.textColor2");
}

.errorBox .small {
  font-size: 12px;
  word-break: break-all;
}

.stale {
  opacity: 0.5;
}
</style>
