<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import PageHeader from "admin/components/PageHeader.vue"
import { errorCode, errorMessage } from "utils/api"
import TextEditor from "shared/components/TextEditor.vue"
import { DIFFICULTY } from "utils/constants"
import { fromPickerValue, parseTime, toPickerValue } from "utils/functions"
import type { AdminProblemRow, BlankContest } from "utils/types"
import {
  addProblemForContest,
  createContest,
  deleteContestProblem,
  editContest,
  getContest,
  getLibraryProblemList,
  getProblemList,
  reorderContestProblems,
} from "../api"

/**
 * 新建 / 编辑比赛，一屏做完（设计稿「比赛重设计」后台那块）：左边名字、类型、时间、密码，
 * 右边题目 —— 搜题号把题库的题加进来，编号自动按 1、2、3 排，拖动换顺序。
 *
 * 开始时间默认 **10 分钟后**（用户定的：建比赛、加题要花时间，不能是「现在」）。
 * 新建时题目先攒在页面上，保存时建好比赛再按顺序一道道复制进去；
 * 编辑时加、删、排顺序都是当场生效的
 */
const props = defineProps<{ contestID?: string }>()

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const theme = useThemeVars()

const editing = computed(() => !!props.contestID)
const ready = ref(false)
const saving = ref(false)

const contest = reactive<BlankContest & { id: number }>({
  id: 0,
  title: "",
  description: "",
  tag: "练习",
  startTime: "",
  endTime: "",
  password: "",
  // 不列出来学生就进不去（隐藏比赛对学生是 404），新建默认就列出来
  visible: true,
})

// ---------------------------------------------------------------- 时间

const WAIT_CHOICES = [10, 20, 30]
const DURATION_CHOICES = [40, 60, 90]

/** 新建时「几分钟后开始」；null = 自己选了具体时刻 */
const waitMins = ref<number | null>(10)
const durationMins = ref(60)
const customDuration = ref(false)
/** 自己选的开始时刻，已平移给 n-date-picker（见 utils/functions.ts 的 toPickerValue） */
const pickedStart = ref(toPickerValue(Date.now() + 10 * 60_000))

// 「10 分钟后」跟着钟走：老师在这页磨蹭几分钟再保存，开始时间也还是保存时的 10 分钟后
const now = useNow({ interval: 15_000 })
function roundedNow() {
  const ms = now.value.getTime()
  return ms - (ms % 60_000)
}

const startMs = computed(() =>
  waitMins.value !== null
    ? roundedNow() + waitMins.value * 60_000
    : fromPickerValue(pickedStart.value),
)
const endMs = computed(() => startMs.value + durationMins.value * 60_000)

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]
const timeHint = computed(() => {
  const start = new Date(startMs.value).toISOString()
  const end = new Date(endMs.value).toISOString()
  // 东八区的星期几：平移 8 小时后读 UTC
  const weekday = WEEKDAYS[new Date(startMs.value + 8 * 3600_000).getUTCDay()]
  const sameDay = parseTime(start, "YYYY-MM-DD") === parseTime(end, "YYYY-MM-DD")
  return `${parseTime(start, "M月D日")} 周${weekday} ${parseTime(start, "HH:mm")} 开始，${parseTime(end, sameDay ? "HH:mm" : "M月D日 HH:mm")} 结束`
})

function pickWait(minutes: number | null) {
  if (minutes === null) pickedStart.value = toPickerValue(startMs.value)
  waitMins.value = minutes
}

function pickDuration(minutes: number | null) {
  customDuration.value = minutes === null
  if (minutes !== null) durationMins.value = minutes
}

// ---------------------------------------------------------------- 题目

type Item = { id: number; displayId: string; title: string; difficulty: string }
/** 新建时是题库里的题（id 是公开题的），编辑时是比赛里的题（id 是比赛题自己的） */
const items = ref<Item[]>([])
/** 新建：题库里已经选进来的公开题 id，用来标「已加入」 */
const pickedPublic = computed(() => new Set(items.value.map((item) => item.id)))

async function loadContestProblems() {
  const res = await getProblemList(0, 250, "", undefined, props.contestID)
  items.value = res.results
    .map((row: AdminProblemRow) => ({
      id: row.id,
      displayId: row._id,
      title: row.title,
      difficulty: row.difficulty,
    }))
    .sort(
      (a, b) => a.displayId.length - b.displayId.length || a.displayId.localeCompare(b.displayId),
    )
}

const keyword = ref("")
const results = ref<AdminProblemRow[]>([])
const searching = ref(false)
watchDebounced(
  keyword,
  async (value) => {
    if (!value.trim()) {
      results.value = []
      return
    }
    searching.value = true
    try {
      results.value = (await getLibraryProblemList(0, 8, value.trim())).results
    } finally {
      searching.value = false
    }
  },
  { debounce: 300 },
)

/** 编辑时比赛题是复制品，没法知道它从哪道公开题来，按题名比一下防重复 */
function added(row: AdminProblemRow) {
  return editing.value
    ? items.value.some((item) => item.title === row.title)
    : pickedPublic.value.has(row.id)
}

async function add(row: AdminProblemRow) {
  if (!editing.value) {
    items.value.push({
      id: row.id,
      displayId: String(items.value.length + 1),
      title: row.title,
      difficulty: row.difficulty,
    })
    return
  }
  const next = Math.max(0, ...items.value.map((item) => Number(item.displayId) || 0)) + 1
  try {
    await addProblemForContest(props.contestID!, row.id, String(next))
    await loadContestProblems()
  } catch (err) {
    const code = errorCode(err)
    message.error(
      code === "contest-ended"
        ? "比赛已经结束，不能再加题"
        : code === "display-id-exists"
          ? "题号重了，刷新一下再加"
          : errorMessage(err),
    )
  }
}

function remove(item: Item) {
  if (!editing.value) {
    items.value = items.value.filter((it) => it !== item)
    renumber()
    return
  }
  dialog.warning({
    title: "从比赛里删掉这道题？",
    content: `第 ${item.displayId} 题「${item.title}」。已经有人交过的题删不掉。`,
    positiveText: "删掉",
    negativeText: "不删",
    onPositiveClick: async () => {
      try {
        await deleteContestProblem(item.id)
        await loadContestProblems()
        if (items.value.length) await saveOrder()
      } catch (err) {
        message.error(
          errorCode(err) === "problem-has-submissions"
            ? "已经有人交过这道题，删不掉；不想让学生看到可以在题目里关掉「可见」"
            : errorMessage(err),
        )
      }
    },
  })
}

function renumber() {
  items.value.forEach((item, index) => (item.displayId = String(index + 1)))
}

async function saveOrder() {
  renumber()
  if (!editing.value) return
  try {
    await reorderContestProblems(
      props.contestID!,
      items.value.map((item) => item.id),
    )
  } catch (err) {
    message.error(errorMessage(err))
    await loadContestProblems()
  }
}

// 拖动排序：原生 drag & drop，够用了
const dragging = ref<number | null>(null)
function onDragStart(index: number) {
  dragging.value = index
}
function onDragEnter(index: number) {
  const from = dragging.value
  if (from === null || from === index) return
  const list = [...items.value]
  const [moved] = list.splice(from, 1)
  list.splice(index, 0, moved!)
  items.value = list
  dragging.value = index
}
function onDragEnd() {
  if (dragging.value === null) return
  dragging.value = null
  saveOrder()
}

function editProblem(item: Item) {
  router.push({
    name: "admin contest problem edit",
    params: { contestID: props.contestID, problemID: item.id },
  })
}

// ---------------------------------------------------------------- 载入 / 保存

async function load() {
  keyword.value = ""
  if (!props.contestID) {
    ready.value = true
    return
  }
  const data = await getContest(props.contestID)
  Object.assign(contest, {
    id: data.id,
    title: data.title,
    description: data.description,
    tag: data.tag,
    startTime: data.startTime,
    endTime: data.endTime,
    password: data.password,
    visible: data.visible,
  })
  waitMins.value = null
  pickedStart.value = toPickerValue(Date.parse(data.startTime))
  const minutes = Math.round((Date.parse(data.endTime) - Date.parse(data.startTime)) / 60_000)
  durationMins.value = minutes
  customDuration.value = !DURATION_CHOICES.includes(minutes)
  await loadContestProblems()
  ready.value = true
}

async function submit() {
  if (!contest.title.trim()) {
    message.error("比赛还没起名字")
    return
  }
  if (durationMins.value <= 0) {
    message.error("时长要大于 0")
    return
  }
  contest.startTime = new Date(startMs.value).toISOString()
  contest.endTime = new Date(endMs.value).toISOString()
  if (!contest.description || contest.description === "<p><br></p>") {
    contest.description = contest.title
  }
  saving.value = true
  try {
    if (editing.value) {
      await editContest(contest)
      message.success("改好了")
      return
    }
    const created = await createContest(contest)
    for (const [index, item] of items.value.entries()) {
      await addProblemForContest(String(created.id), item.id, String(index + 1))
    }
    message.success(
      items.value.length ? `比赛建好了，${items.value.length} 道题都加进去了` : "比赛建好了",
    )
    router.replace({ name: "admin contest edit", params: { contestID: created.id } })
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    saving.value = false
  }
}

watch(() => props.contestID, load)
onMounted(load)
</script>

<template>
  <PageHeader :title="editing ? '编辑比赛' : '新建比赛'" :back="{ name: 'admin contest list' }">
    <template v-if="editing" #actions>
      <n-button tag="a" :href="`/contest/${contestID}/class`" target="_blank">
        到前台看这场比赛
      </n-button>
    </template>
  </PageHeader>

  <div v-if="ready" class="cols">
    <section class="card form">
      <div class="field">
        <span class="label">名字</span>
        <n-input v-model:value="contest.title" placeholder="比如 24计算机1班期末考试" />
      </div>

      <div class="field top">
        <span class="label">类型</span>
        <div class="stack">
          <n-radio-group v-model:value="contest.tag">
            <n-radio-button value="练习">练习</n-radio-button>
            <n-radio-button value="期中">期中</n-radio-button>
            <n-radio-button value="期末">期末</n-radio-button>
          </n-radio-group>
          <span class="hint">
            练习：学生边做边看排名。期中、期末：考试中学生看不到排名和每题做对人数，考完一起公布。
          </span>
        </div>
      </div>

      <div class="field top">
        <span class="label">开始</span>
        <div class="stack">
          <n-flex :size="6">
            <template v-if="!editing">
              <button
                v-for="m in WAIT_CHOICES"
                :key="m"
                class="chip"
                :class="{ on: waitMins === m }"
                @click="pickWait(m)"
              >
                {{ m }} 分钟后
              </button>
              <button class="chip" :class="{ on: waitMins === null }" @click="pickWait(null)">
                选时间…
              </button>
            </template>
            <n-date-picker
              v-if="waitMins === null"
              v-model:value="pickedStart"
              type="datetime"
              format="yyyy-MM-dd HH:mm"
              style="width: 200px"
            />
          </n-flex>
        </div>
      </div>

      <div class="field top">
        <span class="label">时长</span>
        <div class="stack">
          <n-flex :size="6" align="center">
            <button
              v-for="m in DURATION_CHOICES"
              :key="m"
              class="chip"
              :class="{ on: !customDuration && durationMins === m }"
              @click="pickDuration(m)"
            >
              {{ m === 60 ? "1 小时" : `${m} 分钟` }}
            </button>
            <button class="chip" :class="{ on: customDuration }" @click="pickDuration(null)">
              自己填
            </button>
            <n-input-number
              v-if="customDuration"
              v-model:value="durationMins"
              :min="1"
              :step="5"
              style="width: 130px"
            >
              <template #suffix>分钟</template>
            </n-input-number>
          </n-flex>
          <span class="hint">{{ timeHint }}</span>
        </div>
      </div>

      <div class="field">
        <span class="label">密码</span>
        <n-input v-model:value="contest.password" placeholder="不填，谁都能进" />
      </div>

      <div class="field">
        <span class="label">列出来</span>
        <n-switch v-model:value="contest.visible" />
        <span class="hint">{{
          contest.visible ? "学生在比赛列表里看得到" : "藏起来，学生进不去"
        }}</span>
      </div>

      <div class="field top">
        <span class="label">说明</span>
        <div class="stack grow">
          <TextEditor v-model:value="contest.description" title="" mini :min-height="80" />
          <span class="hint">选填，学生在「比赛信息」里看得到。</span>
        </div>
      </div>

      <div class="save">
        <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
        <span class="hint">{{ items.length }} 道题 · {{ timeHint }}</span>
      </div>
    </section>

    <section class="card picker">
      <div class="picker-head">
        <b>题目</b>
        <span class="hint">{{ items.length }} 道 · 拖动排顺序，题号自动按 1、2、3 排</span>
      </div>
      <div class="search">
        <n-input
          v-model:value="keyword"
          clearable
          :loading="searching"
          placeholder="输入题号或题目名，从题库里加"
        />
        <n-button
          v-if="editing"
          @click="router.push({ name: 'admin contest problem create', params: { contestID } })"
        >
          + 新出一道
        </n-button>
        <n-tooltip v-else>
          <template #trigger>
            <n-button disabled>+ 新出一道</n-button>
          </template>
          先保存比赛，再出只在比赛里用的题
        </n-tooltip>
      </div>
      <div v-if="results.length" class="results">
        <div v-for="row in results" :key="row.id" class="result">
          <span class="muted num">{{ row._id }}</span>
          <span class="ell grow">{{ row.title }}</span>
          <span class="muted tiny">{{ DIFFICULTY[row.difficulty] }}</span>
          <span v-if="added(row)" class="muted tiny">已加入</span>
          <n-button v-else size="small" text type="primary" @click="add(row)">+ 加入</n-button>
        </div>
      </div>

      <div v-if="items.length" class="list">
        <div
          v-for="(item, index) in items"
          :key="item.id"
          class="item"
          :class="{ dragging: dragging === index }"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragenter.prevent="onDragEnter(index)"
          @dragover.prevent
          @dragend="onDragEnd"
        >
          <span class="grip" aria-hidden="true">⋮⋮</span>
          <b class="num">{{ item.displayId }}</b>
          <span class="ell grow">{{ item.title }}</span>
          <span class="muted tiny">{{
            DIFFICULTY[item.difficulty as keyof typeof DIFFICULTY]
          }}</span>
          <n-button v-if="editing" size="small" text type="primary" @click="editProblem(item)"
            >改</n-button
          >
          <n-button
            size="small"
            text
            :aria-label="`删掉第 ${item.displayId} 题`"
            @click="remove(item)"
            >✕</n-button
          >
        </div>
      </div>
      <div v-else class="empty hint">还没加题。在上面输入题号，比如 2033</div>
      <span class="hint">
        从题库加的题会复制一份进比赛：比赛里改它不影响原题，学生在题库里也搜不到比赛题。
      </span>
    </section>
  </div>
</template>

<style scoped>
.cols {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}

.card {
  box-sizing: border-box;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
}

.form {
  flex: 1 1 460px;
  max-width: 560px;
}

.picker {
  flex: 999 1 480px;
  min-width: 0;
  gap: 12px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field.top {
  align-items: flex-start;
}

.field.top .label {
  line-height: 30px;
}

.label {
  width: 52px;
  flex-shrink: 0;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.grow {
  flex-grow: 1;
  min-width: 0;
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: v-bind("theme.textColor3");
}

.muted {
  color: v-bind("theme.textColor3");
}

.tiny {
  font-size: 12px;
  flex-shrink: 0;
}

.num {
  min-width: 28px;
  font-variant-numeric: tabular-nums;
}

.ell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.chip.on {
  border-color: v-bind("theme.primaryColor");
  color: v-bind("theme.primaryColor");
  font-weight: 600;
}

.save {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.picker-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.search {
  display: flex;
  gap: 8px;
}

.results,
.list {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  overflow: hidden;
}

.results {
  margin-top: -4px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

.result,
.item {
  min-height: 38px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.result + .result,
.item + .item {
  border-top: 1px solid v-bind("theme.dividerColor");
}

.item {
  cursor: grab;
  background: v-bind("theme.cardColor");
}

.item.dragging {
  opacity: 0.5;
}

.grip {
  color: v-bind("theme.textColor3");
  letter-spacing: -3px;
}

.empty {
  padding: 18px 0;
}
</style>
