<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { ProblemProgress, ProblemTypeFilter, Tag } from "@oj2/contract"
import { useRouteQuery } from "@vueuse/router"
import { useThemeVars } from "naive-ui"
import { getAuthors, getProblemList, getProblemProgress, getRandomProblem } from "oj/api"
import { useCodeStore } from "oj/store/code"
import { useTone } from "oj/submission/composables/tone"
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import type { ProblemRow } from "utils/types"
import { getProblemTagList } from "shared/api"
import Hitokoto from "shared/components/Hitokoto.vue"
import Pagination from "shared/components/Pagination.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { usePagination } from "shared/composables/pagination"
import { useAuthModalStore } from "shared/store/authModal"
import { useUserStore } from "shared/store/user"
import ProblemStatus from "./components/ProblemStatus.vue"
import ProblemTypeTag from "./components/ProblemTypeTag.vue"
import ProgressRow from "./components/ProgressRow.vue"
import TagNav from "./components/TagNav.vue"
import { PROBLEM_TYPE_HINT, PROBLEM_TYPE_LABEL, problemTypes } from "./utils/problemType"

/**
 * 题目列表（设计稿「题目列表重设计」定稿 B + 改版）：左栏知识点和自己的进度，
 * 顶上一行先说做到了什么 + 一言，标题行是选中的知识点和筛选，每题最后一列是做对 / 做过的人数。
 * 这一页主要给学生课外自己挑题（课上找题走顶栏题号框和首页），见 docs 里的讨论记录。
 */
interface ProblemQuery {
  keyword: string
  difficulty: string
  tag: string
  author: string
  sort: string
  type: string
  /** "1" = 只看没做完。用字符串：布尔值会让地址栏常挂一个 ?undone=false */
  undone: string
}

const DIFFICULTIES = [
  { label: "全部", value: "" },
  { label: "简单", value: "Low" },
  { label: "中等", value: "Mid" },
  { label: "困难", value: "High" },
]

const TYPES: ProblemTypeFilter[] = ["sql", "reference", "flowchart", "ast"]

/** 新生一道还没做对时，顶行引去的知识点 */
const START_TAG = "输出入门"

const router = useRouter()
const userStore = useUserStore()
const authStore = useAuthModalStore()
const theme = useThemeVars()
const tone = useTone()
const codeStore = useCodeStore()
const { isDesktop, isMobile } = useBreakpoints()

const { query } = usePagination<ProblemQuery>(
  {
    keyword: useRouteQuery("keyword", "").value,
    difficulty: useRouteQuery("difficulty", "").value,
    tag: useRouteQuery("tag", "").value,
    author: useRouteQuery("author", "").value,
    sort: useRouteQuery("sort", "").value,
    type: useRouteQuery("type", "").value,
    undone: useRouteQuery("undone", "").value,
  },
  { defaultLimit: 30 },
)

const problems = ref<ProblemRow[]>([])
const total = ref(0)
const loaded = ref(false)
const tags = ref<Tag[]>([])
const allCount = ref(0)
const progress = ref<ProblemProgress | null>(null)

/** 老师看的是题库，没有状态列、没有个人进度（定稿「老师」那块） */
const teacher = computed(() => userStore.isTeacherOrAbove)
const showStatus = computed(() => userStore.isAuthed && !teacher.value)
const mine = computed(() => (showStatus.value ? progress.value : null))

// 老师那一版没有这个开关：没有状态列，开了也看不出藏了哪些题。带着 ?undone=1 进来也当没开
const undoneOn = computed({
  get: () => query.undone === "1" && !teacher.value,
  set: (on: boolean) => (query.undone = on ? "1" : ""),
})

const tagByName = computed(() => new Map(tags.value.map((t) => [t.name, t])))
const currentTag = computed(() => tagByName.value.get(query.tag) ?? null)
const startTag = computed(() => tagByName.value.get(START_TAG) ?? null)

const hasExtraFilter = computed(
  () => !!(query.keyword || query.difficulty || query.author || query.type),
)

// 连着点几个知识点时，先发的请求可能后回来（按人数排序那条要慢一截），只认最后一次
let listSeq = 0
async function listProblems() {
  if (query.page < 1) query.page = 1
  const seq = ++listSeq
  const offset = (query.page - 1) * query.limit
  const res = await getProblemList(offset, query.limit, {
    keyword: query.keyword,
    tag: query.tag,
    difficulty: query.difficulty,
    author: query.author,
    sort: query.sort,
    type: query.type,
    // 不看 isAuthed：首屏请求发出时登录信息往往还没回来，后端对没登录的人自己会忽略它
    undone: undoneOn.value ? "1" : "",
  })
  if (seq !== listSeq) return
  total.value = res.total
  problems.value = res.results
  loaded.value = true
  // 左栏「全部题目」的题数：没筛的时候这一页的 total 就是；带着筛选进来的才单独数一次
  if (!query.tag && !hasExtraFilter.value && !undoneOn.value) allCount.value = res.total
  else if (!allCount.value) allCount.value = (await getProblemList(0, 1, {})).total
}

async function loadSide() {
  const [tagRes, progressRes] = await Promise.all([
    getProblemTagList(),
    userStore.isAuthed ? getProblemProgress().catch(() => null) : Promise.resolve(null),
  ])
  tags.value = tagRes
  progress.value = progressRes
}

watchDebounced(() => query.keyword, listProblems, { debounce: 500, maxWait: 1000 })
watch(
  () => [
    query.tag,
    query.difficulty,
    query.limit,
    query.page,
    query.author,
    query.sort,
    query.type,
    query.undone,
  ],
  listProblems,
)

// 用登录框登进来（页面不刷新）、或者退出：状态列和进度都要换成另一个人的。
// 进站那一次不用：请求带 cookie，首屏那一份本来就是全的
let authedAtLoad: boolean = storage.get(STORAGE_KEY.AUTHED) ?? false
watch(
  () => [userStore.isFinished, userStore.isAuthed],
  ([isFinished, isAuthed]) => {
    if (!isFinished || isAuthed === authedAtLoad) return
    authedAtLoad = isAuthed
    listProblems()
    loadSide()
  },
)

onMounted(() => {
  listProblems()
  loadSide()
})

function selectTag(name: string) {
  query.tag = name
}

const solvedInTag = computed(() =>
  mine.value && currentTag.value ? (mine.value.byTag[String(currentTag.value.id)] ?? 0) : null,
)

/** 标题旁那句：学生看自己在这个知识点的进度，打开「只看没做完」就说还剩几道 */
const countText = computed(() => {
  // 全做对了（下面是空状态）就别说「还有 0 道」，照常说做对几道
  if (undoneOn.value && mine.value && total.value > 0)
    return { kind: "left" as const, n: total.value }
  if (solvedInTag.value !== null && !hasExtraFilter.value && currentTag.value)
    return {
      kind: "mine" as const,
      n: solvedInTag.value,
      of: currentTag.value.problemCount,
    }
  return { kind: "total" as const, n: total.value }
})

// ---- 排序：和原来同一套，「最多 / 最少」按人数（和最后一列「做对 / 做过」对得上） ----
const sortOptions = [
  { label: "最新创建", value: "" },
  { label: "最早创建", value: "create_time" },
  { label: "最多人做过", value: "-submission_number" },
  { label: "最少人做过", value: "submission_number" },
  { label: "最多人做对", value: "-accepted_number" },
  { label: "最少人做对", value: "accepted_number" },
]

// ---- 出题者 ----
const authorOptions = ref<{ label: string; value: string }[]>([])
async function loadAuthors(show: boolean) {
  if (!show || authorOptions.value.length) return
  const res = await getAuthors(false)
  authorOptions.value = res.map((a) => ({
    label: `${a.username}（${a.problemCount}）`,
    value: a.username,
  }))
}

// ---- 类型 ----
const showTypeMenu = ref(false)
const [showMobileFilters, toggleMobileFilters] = useToggle(false)
// 弹层被传送到 body 下面，样式里的 v-bind 变量挂在页面根上、够不着它，主题色只能就地给
const menuVars = computed(() => ({
  "--menu-bg": theme.value.popoverColor,
  "--menu-shadow": theme.value.boxShadow2,
  "--menu-text": theme.value.textColor1,
  "--menu-hint": theme.value.textColor3,
  "--menu-hover": theme.value.hoverColor,
  "--menu-on": tone("success").background,
  "--menu-check": theme.value.successColor,
}))
// 下拉里每类后面的题数：一共三十几道，第一次打开时数一下就行
// 下拉里每类后面的题数，跟着左栏的知识点和其它筛选走（类型本身除外）：
// 选了「条件判断」就说「条件判断」里有几道画流程图的题，不然一直是全站那个固定数，看着像没生效。
// 只在下拉打开时数，条件没变就不重数
type Counts = Partial<Record<ProblemTypeFilter | "all", number>>
const typeCounts = ref<Counts>({})
let countedFor = ""
const countFilters = computed(() => ({
  keyword: query.keyword,
  tag: query.tag,
  difficulty: query.difficulty,
  author: query.author,
  undone: undoneOn.value ? "1" : "",
}))
async function refreshTypeCounts() {
  const key = JSON.stringify(countFilters.value)
  if (key === countedFor) return
  countedFor = key
  const kinds = ["all", ...TYPES] as const
  const results = await Promise.all(
    kinds.map((kind) =>
      getProblemList(0, 1, { ...countFilters.value, type: kind === "all" ? "" : kind }),
    ),
  )
  // 数的过程中条件又变了：这一份已经过时，留给下一次
  if (key !== JSON.stringify(countFilters.value)) return
  typeCounts.value = Object.fromEntries(kinds.map((kind, i) => [kind, results[i]!.total]))
}
watch([showTypeMenu, () => showMobileFilters.value, countFilters], () => {
  if (showTypeMenu.value || showMobileFilters.value) refreshTypeCounts()
})

/**
 * 当前条件下一道都没有的类型置灰：点了只会得到一个空列表。
 * 已经选中的那一项除外 —— 选了「画流程图」再切到一个没有这类题的知识点，它变成 0 道，
 * 置灰的话看着像没选中，人也不知道列表为什么空了
 */
function typeEmpty(kind: ProblemTypeFilter) {
  return typeCounts.value[kind] === 0 && query.type !== kind
}

const mobileTypeOptions = computed(() =>
  TYPES.map((kind) => ({
    disabled: typeEmpty(kind),
    label:
      typeCounts.value[kind] === undefined
        ? PROBLEM_TYPE_LABEL[kind]
        : `${PROBLEM_TYPE_LABEL[kind]}（${typeCounts.value[kind]} 道）`,
    value: kind,
  })),
)

function pickType(value: string) {
  query.type = value
  showTypeMenu.value = false
}

// ---- 随便来一道 ----
const picking = ref(false)
async function pickRandom() {
  picking.value = true
  try {
    const id = await getRandomProblem({
      tag: query.tag,
      type: query.type,
      // 只挑能用自己的语言做的题：学生在编辑器里上次用的语言，没用过就是 Python
      language: codeStore.preferredLanguage(),
    })
    router.push("/problem/" + id)
  } finally {
    picking.value = false
  }
}

// ---- 「只看没做完」下一道都没有了：说清楚为什么是空的，给两条路 ----
const nextTag = computed(() => {
  const p = mine.value
  if (!p) return null
  let best: { tag: Tag; left: number } | null = null
  for (const tag of tags.value) {
    if (tag.category !== "knowledge" || tag.name === query.tag) continue
    const left = tag.problemCount - (p.byTag[String(tag.id)] ?? 0)
    if (left <= 0) continue
    // 先挑做过一些的（接着练），都没碰过就挑题最多的
    const started = (p.byTag[String(tag.id)] ?? 0) > 0
    const bestStarted = best ? (p.byTag[String(best.tag.id)] ?? 0) > 0 : false
    if (!best || (started && !bestStarted) || (started === bestStarted && left > best.left))
      best = { tag, left }
  }
  return best
})
// 只在「只看没做完」是唯一的条件时才说「你都做对了」：带着类型、难度这些筛选空了，
// 不能说成整个知识点都做对了
const allDone = computed(
  () =>
    loaded.value && undoneOn.value && total.value === 0 && !!mine.value && !hasExtraFilter.value,
)

/**
 * 筛空了：说清楚是哪些条件把题筛没了，每个条件一个按钮，只去掉那一个。
 * 原来只有一个「清空筛选」，点了连左栏的知识点一起清掉，人又得重新找回来
 */
const emptyConditions = computed(() => {
  const list: { label: string; action: string; clear: () => void }[] = []
  if (query.type) {
    const label = PROBLEM_TYPE_LABEL[query.type as ProblemTypeFilter]
    list.push({ label: `「${label}」的`, action: "看全部类型", clear: () => (query.type = "") })
  }
  if (query.difficulty) {
    const label = DIFFICULTIES.find((d) => d.value === query.difficulty)?.label ?? ""
    list.push({ label, action: "看全部难度", clear: () => (query.difficulty = "") })
  }
  if (query.author)
    list.push({
      label: `${query.author} 出的`,
      action: "看所有出题者",
      clear: () => (query.author = ""),
    })
  if (query.keyword)
    list.push({
      label: `和「${query.keyword}」对得上的`,
      action: "清掉搜索",
      clear: () => (query.keyword = ""),
    })
  if (undoneOn.value)
    list.push({
      label: "没做完的",
      action: "关掉只看没做完",
      clear: () => (undoneOn.value = false),
    })
  return list
})

const emptyText = computed(() => {
  const where = query.tag ? `「${query.tag}」里` : "题库里"
  const conds = emptyConditions.value
  if (conds.length === 0) return `${where}还没有题`
  if (conds.length === 1) return `${where}没有${conds[0]!.label}题`
  return `${where}没有同时符合这些条件的题`
})

// 按左栏的顺序（题数多的在前）排，同样几个知识点在每道题上的先后才一致
function knowledgeOf(row: ProblemRow) {
  return row.tags
    .map((name) => tagByName.value.get(name))
    .filter((tag): tag is Tag => tag?.category === "knowledge")
    .sort((a, b) => b.problemCount - a.problemCount)
    .map((tag) => tag.name)
    .join(" · ")
}

function mustDo(row: ProblemRow) {
  return row.tags.includes("必会题")
}

// 「C语言」是主题标签，告诉学生这道题是 C 语言课专门用的，和「必会」一样挂在题目名后
function cCourse(row: ProblemRow) {
  return row.tags.includes("C语言")
}

const DIFFICULTY_TONE = { 简单: "success", 中等: "warning", 困难: "error" } as const

function difficultyStyle(row: ProblemRow) {
  if (!row.difficulty) return {}
  const t = tone(DIFFICULTY_TONE[row.difficulty])
  return { color: t.color, background: t.background }
}

// 手机上知识点横着滑：带着 ?tag= 进来、或者点了靠后的知识点，把它滑到看得见的地方
const chipsRef = ref<HTMLElement | null>(null)
watch(
  () => [query.tag, tags.value.length],
  () =>
    nextTick(() =>
      chipsRef.value
        ?.querySelector(".m-chip.on")
        ?.scrollIntoView({ block: "nearest", inline: "center" }),
    ),
)

const gridColumns = computed(() =>
  showStatus.value
    ? "40px 72px minmax(0, 1fr) 260px 72px 136px"
    : "72px minmax(0, 1fr) 260px 72px 136px",
)
</script>

<template>
  <div class="page" :class="{ mobile: isMobile }">
    <!-- ================= 桌面 ================= -->
    <div v-if="isDesktop" class="split">
      <TagNav
        :tags="tags"
        :selected="query.tag"
        :all-count="allCount"
        :progress="mine?.byTag ?? null"
        @select="selectTag"
      />
      <section class="main">
        <div class="top">
          <ProgressRow v-if="mine" :progress="mine" :start-tag="startTag" @select-tag="selectTag" />
          <div v-else-if="!userStore.isAuthed && userStore.isFinished" class="anon">
            登录以后，左边每个知识点会显示你做对了几道
            <button class="link" @click="authStore.openLoginModal()">登录</button>
          </div>
          <div class="spacer"></div>
          <Hitokoto class="hitokoto" />
        </div>

        <div class="titlebar">
          <h1>{{ query.tag || "全部题目" }}</h1>
          <span class="count">
            <template v-if="countText.kind === 'left'">
              还有 <b class="plain">{{ countText.n }}</b> 道没做对
            </template>
            <template v-else-if="countText.kind === 'mine'">
              你做对 <b>{{ countText.n }}</b> / {{ countText.of }}
            </template>
            <template v-else>{{ countText.n }} 道</template>
          </span>
          <button class="random" :disabled="picking" @click="pickRandom">
            <Icon icon="ph:dice-five-bold" :width="15" />随便来一道
          </button>
          <div class="spacer"></div>
          <n-input
            v-model:value="query.keyword"
            class="w-search"
            clearable
            placeholder="题号或标题"
          >
            <template #prefix><Icon icon="ph:magnifying-glass" /></template>
          </n-input>
          <div class="segmented">
            <button
              v-for="d in DIFFICULTIES"
              :key="d.value"
              :class="{ on: query.difficulty === d.value }"
              @click="query.difficulty = d.value"
            >
              {{ d.label }}
            </button>
          </div>
          <n-popover
            v-model:show="showTypeMenu"
            trigger="click"
            placement="bottom-start"
            :show-arrow="false"
            raw
          >
            <template #trigger>
              <button class="select" :class="{ on: query.type }">
                <span>{{
                  query.type ? PROBLEM_TYPE_LABEL[query.type as ProblemTypeFilter] : "全部类型"
                }}</span>
                <Icon icon="ph:caret-down-bold" :width="12" />
              </button>
            </template>
            <div class="type-menu" :style="menuVars">
              <button :class="{ on: !query.type }" @click="pickType('')">
                <span class="check"><Icon v-if="!query.type" icon="ph:check-bold" /></span>
                <span class="body">
                  <span class="label-line">
                    <span class="label">全部类型</span>
                    <span v-if="typeCounts.all !== undefined" class="n"
                      >{{ typeCounts.all }} 道</span
                    >
                  </span>
                </span>
              </button>
              <button
                v-for="kind in TYPES"
                :key="kind"
                :class="{ on: query.type === kind }"
                :disabled="typeEmpty(kind)"
                :title="typeEmpty(kind) ? '这里没有这类题' : undefined"
                @click="pickType(kind)"
              >
                <span class="check"><Icon v-if="query.type === kind" icon="ph:check-bold" /></span>
                <span class="body">
                  <span class="label-line">
                    <ProblemTypeTag :kind="kind" />
                    <span v-if="typeCounts[kind] !== undefined" class="n"
                      >{{ typeCounts[kind] }} 道</span
                    >
                  </span>
                  <span class="hint">{{ PROBLEM_TYPE_HINT[kind] }}</span>
                </span>
              </button>
            </div>
          </n-popover>
          <n-select
            :value="query.author || null"
            class="w-author"
            placeholder="出题者"
            clearable
            filterable
            :consistent-menu-width="false"
            :options="authorOptions"
            @update:show="loadAuthors"
            @update:value="(v: string | null) => (query.author = v ?? '')"
          />
          <n-select
            v-model:value="query.sort"
            class="w-sort"
            :consistent-menu-width="false"
            :options="sortOptions"
          />
          <span v-if="!teacher" class="vsep"></span>
          <label
            v-if="!teacher"
            class="undone"
            :class="{ disabled: !userStore.isAuthed }"
            :title="userStore.isAuthed ? '做对的题藏起来' : '登录后才能用'"
          >
            <n-switch v-model:value="undoneOn" size="small" :disabled="!userStore.isAuthed" />
            只看没做完
          </label>
        </div>

        <div class="table">
          <div class="thead" :style="{ gridTemplateColumns: gridColumns }">
            <div v-if="showStatus" class="center">状态</div>
            <div>题号</div>
            <div>题目</div>
            <div>知识点</div>
            <div>难度</div>
            <div>做对 / 做过</div>
          </div>
          <div class="rows">
            <RouterLink
              v-for="row in problems"
              :key="row.id"
              :to="'/problem/' + row._id"
              class="row"
              :style="{ gridTemplateColumns: gridColumns }"
            >
              <div v-if="showStatus" class="center"><ProblemStatus :status="row.status" /></div>
              <div class="id">{{ row._id }}</div>
              <div class="title">
                <span class="text">{{ row.title }}</span>
                <span v-if="mustDo(row)" class="must">必会</span>
                <span v-if="cCourse(row)" class="must course">C语言</span>
                <ProblemTypeTag v-for="kind in problemTypes(row)" :key="kind" :kind="kind" />
              </div>
              <div class="knowledge" :title="knowledgeOf(row)">{{ knowledgeOf(row) || "—" }}</div>
              <div>
                <span v-if="row.difficulty" class="difficulty" :style="difficultyStyle(row)">
                  {{ row.difficulty }}
                </span>
              </div>
              <div class="people">
                <b>{{ row.solvedUsers }}</b> / {{ row.triedUsers }} 人
              </div>
            </RouterLink>

            <div v-if="allDone" class="empty">
              <span class="empty-icon"><Icon icon="ph:check-bold" :width="26" /></span>
              <b v-if="currentTag"
                >{{ currentTag.name }}的 {{ currentTag.problemCount }} 道你都做对了</b
              >
              <b v-else>这里的题你都做对了</b>
              <span class="sub">关掉「只看没做完」能看回这些题</span>
              <div class="empty-actions">
                <n-button v-if="nextTag" type="primary" @click="selectTag(nextTag.tag.name)">
                  接着练「{{ nextTag.tag.name }}」（还有 {{ nextTag.left }} 道）
                </n-button>
                <n-button @click="undoneOn = false">关掉只看没做完</n-button>
              </div>
            </div>
            <div v-else-if="loaded && !problems.length" class="empty">
              <b>{{ emptyText }}</b>
              <div class="empty-actions">
                <n-button v-for="c in emptyConditions" :key="c.action" @click="c.clear">
                  {{ c.action }}
                </n-button>
              </div>
            </div>
          </div>
          <!-- Pagination 根上自带 width: 100%，内边距得加在外面一层，不然右边溢出被截掉 -->
          <div class="pager">
            <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
          </div>
        </div>
      </section>
    </div>

    <!-- ================= 手机 ================= -->
    <template v-else>
      <div v-if="mine" class="m-progress">
        <ProgressRow :progress="mine" :start-tag="startTag" compact @select-tag="selectTag" />
      </div>
      <div ref="chipsRef" class="m-chips">
        <button class="m-chip" :class="{ on: !query.tag }" @click="selectTag('')">
          全部<span>{{ allCount || "" }}</span>
        </button>
        <button
          v-for="tag in tags
            .filter((t) => t.category === 'knowledge')
            .sort((a, b) => b.problemCount - a.problemCount)"
          :key="tag.id"
          class="m-chip"
          :class="{ on: query.tag === tag.name }"
          @click="selectTag(tag.name)"
        >
          {{ tag.name }}
          <span v-if="mine && (mine.byTag[String(tag.id)] ?? 0) >= tag.problemCount" class="done">
            <Icon icon="ph:check-bold" :width="11" />
          </span>
          <span v-else-if="mine && (mine.byTag[String(tag.id)] ?? 0) > 0">
            {{ mine.byTag[String(tag.id)] }}/{{ tag.problemCount }}
          </span>
          <span v-else>{{ tag.problemCount }}</span>
        </button>
      </div>
      <div class="m-title">
        <div class="m-heading">
          <h1>{{ query.tag || "全部题目" }}</h1>
          <span class="count">
            <template v-if="countText.kind === 'left'">还有 {{ countText.n }} 道没做对</template>
            <template v-else-if="countText.kind === 'mine'">
              {{ countText.of }} 道 · 你做对 {{ countText.n }} 道
            </template>
            <template v-else>{{ countText.n }} 道</template>
          </span>
        </div>
        <button class="random" :disabled="picking" @click="pickRandom">
          <Icon icon="ph:dice-five-bold" :width="15" />随便来一道
        </button>
        <button class="m-filter" :class="{ on: showMobileFilters }" @click="toggleMobileFilters()">
          <Icon icon="ph:funnel-simple-bold" :width="14" />筛选
        </button>
      </div>
      <div v-if="showMobileFilters" class="m-panel">
        <n-input v-model:value="query.keyword" size="small" clearable placeholder="题号或标题" />
        <div class="segmented">
          <button
            v-for="d in DIFFICULTIES"
            :key="d.value"
            :class="{ on: query.difficulty === d.value }"
            @click="query.difficulty = d.value"
          >
            {{ d.label }}
          </button>
        </div>
        <n-select
          :value="query.type || null"
          size="small"
          placeholder="全部类型"
          clearable
          :options="mobileTypeOptions"
          @update:value="(v: string | null) => (query.type = v ?? '')"
        />
        <n-select
          :value="query.author || null"
          size="small"
          placeholder="出题者"
          clearable
          filterable
          :options="authorOptions"
          @update:show="loadAuthors"
          @update:value="(v: string | null) => (query.author = v ?? '')"
        />
        <n-select v-model:value="query.sort" size="small" :options="sortOptions" />
        <label v-if="!teacher" class="undone" :class="{ disabled: !userStore.isAuthed }">
          <n-switch v-model:value="undoneOn" size="small" :disabled="!userStore.isAuthed" />
          只看没做完
        </label>
      </div>
      <div class="m-rows">
        <RouterLink v-for="row in problems" :key="row.id" :to="'/problem/' + row._id" class="m-row">
          <span class="m-status"><ProblemStatus v-if="showStatus" :status="row.status" /></span>
          <span class="id">{{ row._id }}</span>
          <span class="m-main">
            <span class="m-name">
              <span class="text">{{ row.title }}</span>
              <span v-if="mustDo(row)" class="must">必会</span>
              <span v-if="cCourse(row)" class="must course">C语言</span>
            </span>
            <span class="m-meta">
              <span v-if="row.difficulty" class="difficulty" :style="difficultyStyle(row)">
                {{ row.difficulty }}
              </span>
              <ProblemTypeTag v-for="kind in problemTypes(row)" :key="kind" :kind="kind" />
              <span class="people">{{ row.solvedUsers }} / {{ row.triedUsers }} 人做对</span>
            </span>
          </span>
        </RouterLink>
        <div v-if="allDone" class="empty">
          <b>这里的题你都做对了</b>
          <n-button size="small" @click="undoneOn = false">关掉只看没做完</n-button>
        </div>
        <div v-else-if="loaded && !problems.length" class="empty">
          <b>{{ emptyText }}</b>
          <div class="empty-actions">
            <n-button v-for="c in emptyConditions" :key="c.action" size="small" @click="c.clear">
              {{ c.action }}
            </n-button>
          </div>
        </div>
      </div>
      <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
    </template>
  </div>
</template>

<style scoped>
/* 铺满顶栏以下：和提交列表一样用负边距吃掉外层 16px 的内边距（顶栏 56） */
.page {
  margin: -16px;
  height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
}

.page.mobile {
  height: auto;
}

/* 1920 的屏上不限宽的话，题目名在最左、人数在最右，中间一大片空 */
.split {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.top {
  height: 52px;
  flex: none;
  box-sizing: border-box;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.spacer {
  flex: 1;
}

.hitokoto {
  flex: 0 1 460px;
  max-width: 460px;
}

.anon {
  font-size: 13px;
  color: v-bind("theme.textColor2");
  white-space: nowrap;
}

.link {
  border: 0;
  padding: 0;
  margin-left: 8px;
  background: transparent;
  font: inherit;
  font-weight: 600;
  color: v-bind("theme.primaryColor");
  cursor: pointer;
}

/* 1280 宽（机房 1280×1024）也要一行放下：左栏 224 之后只剩 1008，控件宽度是按它掐的，
   加东西之前先在 1280 下看一眼「只看没做完」还在不在 */
.titlebar {
  height: 68px;
  flex: none;
  box-sizing: border-box;
  padding: 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.titlebar h1 {
  margin: 0 2px 0 0;
  font-size: 22px;
  font-weight: 700;
}

.count {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.count b {
  font-weight: 600;
  color: v-bind("theme.successColor");
}

.count b.plain {
  color: v-bind("theme.textColor2");
}

.random {
  height: var(--oj-ctrl-h);
  flex: none;
  box-sizing: border-box;
  margin-left: 4px;
  padding: 0 12px 0 10px;
  border: 1px solid v-bind("theme.primaryColorSuppl");
  border-radius: 17px;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("tone('success').color");
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.random:hover {
  background: v-bind("tone('success').background");
}

.random:disabled {
  cursor: wait;
  opacity: 0.7;
}

.w-search {
  flex: 0 1 132px;
  min-width: 100px;
}

.w-author {
  width: 92px;
  flex: none;
}

.w-sort {
  width: 96px;
  flex: none;
}

.segmented {
  display: flex;
  flex: none;
}

.segmented button {
  height: var(--oj-ctrl-h);
  padding: 0 10px;
  margin-left: -1px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  cursor: pointer;
  white-space: nowrap;
}

.segmented button:first-child {
  margin-left: 0;
  border-radius: 3px 0 0 3px;
}

.segmented button:last-child {
  border-radius: 0 3px 3px 0;
}

.segmented button.on {
  position: relative;
  z-index: 1;
  border-color: v-bind("theme.primaryColor");
  color: v-bind("theme.primaryColor");
}

.select {
  width: 100px;
  height: var(--oj-ctrl-h);
  flex: none;
  box-sizing: border-box;
  padding: 0 8px 0 10px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 3px;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor1");
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  cursor: pointer;
}

.select span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.select svg {
  flex: none;
  color: v-bind("theme.textColor3");
}

.select.on {
  border-color: v-bind("theme.primaryColor");
  color: v-bind("tone('success').color");
}

.type-menu {
  width: 300px;
  box-sizing: border-box;
  padding: 4px 0;
  border-radius: 6px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
}

.type-menu button {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  color: var(--menu-text);
}

.type-menu button:hover:not(:disabled) {
  background: var(--menu-hover);
}

/* 没有这类题：整项淡下去（标签自己的颜色也一起），不能点 */
.type-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.type-menu button.on {
  background: var(--menu-on);
}

.type-menu .check {
  width: 14px;
  flex: none;
  padding-top: 2px;
  color: var(--menu-check);
}

.type-menu .body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.type-menu .label-line {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.type-menu .n {
  font-size: 12px;
  color: var(--menu-hint);
  font-variant-numeric: tabular-nums;
}

.type-menu .label {
  font-size: 13px;
}

.type-menu .hint {
  font-size: 12px;
  line-height: 17px;
  color: var(--menu-hint);
  white-space: normal;
}

.vsep {
  width: 1px;
  height: 20px;
  margin: 0 2px;
  flex: none;
  background: v-bind("theme.dividerColor");
}

.undone {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  cursor: pointer;
  white-space: nowrap;
}

.undone.disabled {
  color: v-bind("theme.textColorDisabled");
  cursor: not-allowed;
}

.table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.thead,
.row {
  box-sizing: border-box;
  padding: 0 var(--oj-pad-x);
  display: grid;
  column-gap: 16px;
  align-items: center;
}

.thead {
  height: var(--oj-head-h);
  flex: none;
  font-size: var(--oj-fs-meta);
  font-weight: 600;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.tableHeaderColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.row {
  height: var(--oj-row-h);
  font-size: var(--oj-fs-body);
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.row:hover {
  background: v-bind("theme.hoverColor");
}

.center {
  display: flex;
  justify-content: center;
  text-align: center;
}

.id {
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.must {
  flex: none;
  height: 20px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid v-bind("theme.warningColorSuppl");
  border-radius: 3px;
  font-size: 12px;
  line-height: 18px;
  color: v-bind("tone('warning').color");
}

.must.course {
  border-color: v-bind("theme.infoColorSuppl");
  color: v-bind("tone('info').color");
}

.knowledge {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.difficulty {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
}

.people {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.people b {
  font-weight: 600;
  color: v-bind("theme.textColor2");
}

.pager {
  flex: none;
  padding: 0 24px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.pager :deep(.margin) {
  margin: 10px 0;
}

.empty {
  padding: 56px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.empty b {
  font-size: 16px;
}

.empty .sub {
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.empty-icon {
  width: 52px;
  height: 52px;
  border-radius: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: v-bind("theme.successColor");
  background: v-bind("tone('success').background");
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
}

/* 1280 宽：控件放大一档以后一行差几十像素，筛选条这几样退回 13px 的字 */
@media (max-width: 1365px) {
  .count,
  .random,
  .segmented button,
  .select,
  .undone {
    font-size: 13px;
  }

  .select {
    width: 92px;
  }
}

/* ---------- 手机 ---------- */
.m-progress {
  padding: 12px 16px 0;
}

.m-chips {
  padding: 14px 0 0 16px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.m-chip {
  height: 32px;
  flex: none;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 16px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.m-chip span {
  color: v-bind("theme.textColor3");
}

.m-chip .done {
  display: inline-flex;
  color: v-bind("theme.successColor");
}

.m-chip.on {
  border-color: v-bind("theme.primaryColor");
  background: v-bind("tone('success').background");
  color: v-bind("tone('success').color");
  font-weight: 600;
}

.m-title {
  padding: 14px 16px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.m-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.m-heading h1 {
  margin: 0;
  font-size: 18px;
}

.m-heading .count {
  font-size: 12px;
}

.m-title .random {
  height: 34px;
  border-radius: 17px;
}

.m-filter {
  height: 34px;
  padding: 0 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 17px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.m-filter.on {
  border-color: v-bind("theme.primaryColor");
  color: v-bind("tone('success').color");
}

.m-panel {
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.m-row {
  box-sizing: border-box;
  min-height: 58px;
  padding: 9px 16px;
  display: grid;
  grid-template-columns: 20px 44px minmax(0, 1fr);
  column-gap: 8px;
  align-items: center;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.m-row .id {
  font-size: 13px;
}

.m-status {
  display: flex;
}

.m-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.m-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.m-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.m-meta .difficulty {
  height: 20px;
  padding: 0 6px;
}

.m-meta .people {
  font-size: 12px;
}
</style>
