<script lang="ts" setup>
import { useThemeVars } from "naive-ui"
import { getRankOfProblem, getSubmission, getSubmissions } from "oj/api"
import { useCodeStore } from "oj/store/code"
import { useProblemStore } from "oj/store/problem"
import Pagination from "shared/components/Pagination.vue"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"
import { JUDGE_STATUS, LANGUAGE_SHOW_VALUE } from "utils/constants"
import { copyToClipboard, parseTime } from "utils/functions"
import type { ProblemRank } from "@oj2/contract"
import type { LANGUAGE, SubmissionListItem } from "utils/types"
import { useProblemPageContext } from "../composables/problemPageContext"
import { useTeacherCollab } from "../composables/teacherCollab"

/**
 * 「我的提交」抽屉：这道题自己交过的每一次。
 *
 * 原来是一张表（提交时间 / 编号 / 状态 / 语言），点编号弹出一个 70vw 的提交详情弹窗，
 * 盖住整个题目页；「复制回到题目」还会整页跳一次路由。现在每一行点开就在行内看代码，
 * 「放回编辑器」直接换掉右边编辑器里的代码（按 Ctrl+Z 能撤回），抽屉不关、不跳页。
 */

const userStore = useUserStore()
const codeStore = useCodeStore()
const problemStore = useProblemStore()
const collabStore = useCollabStore()
const ctx = useProblemPageContext()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const theme = useThemeVars()

const problemDisplayId = computed(() => String(route.params.problemID ?? ""))

/**
 * 协作中的教师：编辑器里是学生的代码，「放回编辑器」会经 Yjs 直接盖掉学生正在写的
 * 那一份，所以不给（设计文档第 9 节）。
 */
const teacherCollab = useTeacherCollab()

/** 协作中看的是学生的提交（设计文档第 9 节）：房间里的 peerName 就是学生的用户名 */
const peer = computed(() => (teacherCollab.value ? (collabStore.room?.peerName ?? null) : null))

// ==================== 班上第几个做对的 ====================
// 只在题库入口给：比赛有自己的排名，题单里整个抽屉都不出现
const rank = ref<ProblemRank | null>(null)

const rankLine = computed(() => {
  const r = rank.value
  if (!r) return null
  const inClass = !!r.className
  const scope = inClass ? "班上" : "全站"
  const count = inClass ? r.classAcCount : r.allAcCount
  if (r.rank !== -1)
    return {
      text: `你是${scope}第 ${r.rank} 个做对的，${scope}一共 ${count} 人做对了`,
      solved: true,
    }
  if (count > 0)
    return { text: `${inClass ? "你们班" : "全站"}已经有 ${count} 人做对了`, solved: false }
  return null
})

/** 「看看他们的写法」：同班的走 'ks' + 班级名的用户名前缀约定（设计文档第 13 节） */
function goAccepted() {
  const r = rank.value
  if (!r) return
  const target = {
    name: "submissions",
    query: {
      problem: problemDisplayId.value,
      result: "0",
      page: 1,
      limit: 10,
      ...(r.className ? { username: "ks" + r.className } : {}),
    },
  }
  // 协作中跳走这一页协作就断了
  if (teacherCollab.value) window.open(router.resolve(target).href, "_blank")
  else router.push(target)
}

// ==================== 列表 ====================
const submissions = ref<SubmissionListItem[]>([])
const total = ref(0)
// 拉回来之前别说「还没交过」
const listed = ref(false)
const query = reactive({ limit: 10, page: 1 })

const blocked = computed(() => {
  if (!userStore.isAuthed) return "登录之后才能看到自己的提交"
  if (!userStore.showSubmissions) return "提交列表已被管理员关闭"
  return ""
})

async function listSubmissions() {
  const res = await getSubmissions({
    ...query,
    ...(peer.value
      ? { username: peer.value, exactUsername: "1" as const }
      : { myself: "1" as const }),
    offset: query.limit * (query.page - 1),
    problemDisplayId: problemDisplayId.value,
    contestId: ctx.value.contestId,
  })
  submissions.value = res.results
  total.value = res.total
  listed.value = true
}

/**
 * 「我的提交统计」：这一页里各种结果各几次（「答案错误 × 3」「答案正确 × 1」），和原来一样
 * 只数当前这一页。被题单闸门锁住的那几次不数 —— 它们在列表里只露一行说明，这里也不该露出结果
 */
const statusDistribution = computed(() => {
  const counts = new Map<number, number>()
  for (const row of submissions.value) {
    if (row.showLink) counts.set(row.result, (counts.get(row.result) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([result, count]) => ({
      result,
      name: JUDGE_STATUS[result as keyof typeof JUDGE_STATUS]?.name ?? "未知",
      type: JUDGE_STATUS[result as keyof typeof JUDGE_STATUS]?.type ?? "info",
      count,
    }))
})

/** 列表是新的在前；「第几次」从最早那次数起 */
function attemptNo(index: number) {
  return total.value - (query.page - 1) * query.limit - index
}

// ==================== 行内展开 ====================
const expanded = ref<string | null>(null)
type Loaded = { code: string; language: LANGUAGE }
const details = reactive<Record<string, Loaded | "loading" | "failed">>({})

async function toggle(row: SubmissionListItem) {
  // 加入题单之前的提交被锁住，点不开（后端也不会给代码）
  if (!row.showLink) return
  if (expanded.value === row.id) {
    expanded.value = null
    return
  }
  expanded.value = row.id
  if (details[row.id] && details[row.id] !== "failed") return
  details[row.id] = "loading"
  try {
    const res = await getSubmission(row.id)
    details[row.id] = { code: res.code, language: res.language }
  } catch {
    details[row.id] = "failed"
  }
}

/** 这一页里被题单闸门藏起来的次数 */
const lockedCount = computed(() => submissions.value.filter((row) => !row.showLink).length)

/** 展开的代码先只露 5 行，「一共 11 行」点一下再全摆出来（设计稿） */
const PREVIEW_LINES = 5
const fullCode = reactive<Record<string, boolean>>({})
function preview(id: string) {
  const code = loadedOf(id)?.code ?? ""
  const lines = code.replace(/\s+$/, "").split("\n")
  const more = !fullCode[id] && lines.length > PREVIEW_LINES + 1
  return {
    text: more ? `${lines.slice(0, PREVIEW_LINES).join("\n")}\n` : code,
    more,
    total: lines.length,
  }
}

function loadedOf(id: string): Loaded | null {
  const value = details[id]
  return value && typeof value === "object" ? value : null
}

/** 这道题现在还收不收那次提交的语言（0020 从题目里摘掉了 Java / JS / Go，老提交还在） */
function canPutBack(id: string) {
  const loaded = loadedOf(id)
  return !!loaded && problemStore.codeLanguages.some((language) => language === loaded.language)
}

async function putBack(id: string) {
  const loaded = loadedOf(id)
  if (!loaded || !canPutBack(id)) return
  // 语言不一样就先按正常的路子切过去（存语言偏好、读那门语言的草稿；画流程图时切回代码编辑器），
  // 等编辑器切完再放代码 —— 直接改 codeStore 的语言会绕过这些，草稿存错地方
  if (codeStore.code.language !== loaded.language) {
    problemStore.switchLanguage(loaded.language)
    await nextTick()
  }
  // 同一个编辑器里 dispatch 一次整段替换，CodeMirror 的历史记着它，Ctrl+Z 能撤回
  codeStore.setCode(loaded.code)
  message.success("已放回编辑器，按 Ctrl+Z 可以撤回")
}

async function copy(id: string) {
  const loaded = loadedOf(id)
  if (!loaded) return
  const ok = await copyToClipboard(loaded.code)
  message[ok ? "success" : "error"](ok ? "代码已复制" : "复制失败")
}

/** 完整详情（测试点、自测猫、分享）开新标签：这一页的编辑器和结果还要留着 */
function openDetail(id: string) {
  window.open(router.resolve(`/submission/${id}`).href, "_blank")
}

onMounted(() => {
  if (blocked.value) return
  listSubmissions()
  // 排名是按当前登录的人算的，协作中那是老师自己的，不给
  if (ctx.value.entry === "problem" && !peer.value) {
    getRankOfProblem(problemDisplayId.value)
      .then((res) => {
        rank.value = res
      })
      .catch(() => {})
  }
})
watch(query, () => {
  expanded.value = null
  listSubmissions()
})
</script>

<template>
  <n-alert v-if="blocked" type="warning" :show-icon="false">{{ blocked }}</n-alert>

  <template v-else>
    <div v-if="rankLine" class="rank" :class="{ solved: rankLine.solved }">
      <span>{{ rankLine.text }}</span>
      <n-button v-if="userStore.showSubmissions" text type="primary" @click="goAccepted">
        看看他们的写法 ›
      </n-button>
    </div>

    <div v-if="statusDistribution.length" class="distribution">
      <n-tag
        v-for="item in statusDistribution"
        :key="item.result"
        :type="item.type"
        size="small"
        round
        :bordered="false"
      >
        {{ item.name }} × {{ item.count }}
      </n-tag>
    </div>

    <n-empty
      v-if="listed && !submissions.length"
      class="empty"
      :description="peer ? '他还没有交过这道题' : '这道题你还没有交过'"
    />

    <!-- 设计稿「我的提交 / 统计 / 点评：抽屉盖住左栏」：一整块带框的列表，行间一条细线 -->
    <div v-else-if="submissions.length" class="list">
      <template v-for="(row, index) in submissions" :key="row.id">
        <div v-if="row.showLink" class="item" :class="{ open: expanded === row.id }">
          <button
            type="button"
            class="row"
            :aria-expanded="expanded === row.id"
            @click="toggle(row)"
          >
            <span class="attempt">第 {{ attemptNo(index) }} 次</span>
            <span class="verdict" :class="JUDGE_STATUS[row.result]?.type">
              {{ JUDGE_STATUS[row.result]?.name ?? "未知" }}
            </span>
            <span class="meta">
              {{ LANGUAGE_SHOW_VALUE[row.language] }} ·
              {{ parseTime(row.createTime, "MM-DD HH:mm") }}
            </span>
            <svg
              class="caret"
              :class="{ up: expanded === row.id }"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <div v-if="expanded === row.id" class="detail">
            <n-flex v-if="details[row.id] === 'loading'" justify="center" class="pad">
              <n-spin size="small" />
            </n-flex>
            <n-text v-else-if="details[row.id] === 'failed'" type="error">
              代码读不出来，收起来再点开试试
            </n-text>
            <template v-else-if="loadedOf(row.id)">
              <pre class="code">{{ preview(row.id).text
                }}<button
                  v-if="preview(row.id).more"
                  type="button"
                  class="code-more"
                  @click="fullCode[row.id] = true"
                >…… 一共 {{ preview(row.id).total }} 行，点开看全部</button></pre>
              <div class="detail-actions">
                <n-button
                  v-if="!teacherCollab"
                  size="small"
                  type="primary"
                  ghost
                  :disabled="!canPutBack(row.id)"
                  :title="
                    canPutBack(row.id)
                      ? undefined
                      : `这道题现在不收 ${LANGUAGE_SHOW_VALUE[loadedOf(row.id)!.language]} 了，只能复制`
                  "
                  @click="putBack(row.id)"
                >
                  放回编辑器
                </n-button>
                <n-button size="small" @click="copy(row.id)">复制</n-button>
                <n-button size="small" text class="more" @click="openDetail(row.id)">
                  完整详情 ›
                </n-button>
              </div>
            </template>
          </div>
        </div>
      </template>
      <!-- 加入题单之前交的那几次：合成一行，点不开（后端也不给代码） -->
      <div v-if="lockedCount" class="locked">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
        <span>
          加入题单之前的
          {{ lockedCount }} 次提交先藏起来了，在题单里做出这道题就能看（题单过了截止时间也会解锁）
        </span>
      </div>
    </div>

    <Pagination
      v-if="total > query.limit"
      :total="total"
      v-model:limit="query.limit"
      v-model:page="query.page"
    />
  </template>
</template>

<style scoped>
.distribution {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.rank {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  font-size: 14px;
}

.rank.solved {
  background-color: rgba(24, 160, 88, 0.1);
}

.empty {
  margin: 32px 0;
}

.list {
  margin: 0 0 12px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 6px;
  overflow: hidden;
}

.item + .item,
.item + .locked {
  border-top: 1px solid v-bind("theme.dividerColor");
}

.row {
  width: 100%;
  height: 44px;
  box-sizing: border-box;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row:hover,
.item.open .row {
  background-color: rgba(128, 128, 128, 0.06);
}

.attempt {
  flex: none;
  width: 4em;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  font-variant-numeric: tabular-nums;
}

.verdict {
  flex: none;
  min-width: 5em;
}

.verdict.success {
  color: v-bind("theme.successColorPressed");
  font-weight: 600;
}

.verdict.error {
  color: v-bind("theme.errorColorPressed");
}

.verdict.warning {
  color: v-bind("theme.warningColorPressed");
}

.meta {
  font-size: 13px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.caret {
  margin-left: auto;
  flex: none;
  color: v-bind("theme.textColor3");
  transition: transform 0.15s;
}

.caret.up {
  transform: rotate(180deg);
}

.detail {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pad {
  padding: 12px 0;
}

.code {
  margin: 0;
  padding: 8px 10px;
  max-height: 360px;
  overflow: auto;
  border-radius: 4px;
  background-color: rgba(128, 128, 128, 0.06);
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 20px;
  white-space: pre;
}

.code-more {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.code-more:hover {
  color: v-bind("theme.primaryColor");
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.locked {
  height: 44px;
  box-sizing: border-box;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.more {
  margin-left: auto;
}
</style>
