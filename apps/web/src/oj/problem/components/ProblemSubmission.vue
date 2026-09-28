<script lang="ts" setup>
import { getRankOfProblem, getSubmission, getSubmissions } from "oj/api"
import { useCodeStore } from "oj/store/code"
import Pagination from "shared/components/Pagination.vue"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"
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
const collabStore = useCollabStore()
const ctx = useProblemPageContext()
const route = useRoute()
const router = useRouter()
const message = useMessage()

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

function loadedOf(id: string): Loaded | null {
  const value = details[id]
  return value && typeof value === "object" ? value : null
}

function putBack(id: string) {
  const loaded = loadedOf(id)
  if (!loaded) return
  // 同一个编辑器里 dispatch 一次整段替换，CodeMirror 的历史记着它，Ctrl+Z 能撤回
  codeStore.setLanguage(loaded.language)
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

    <n-empty
      v-if="listed && !submissions.length"
      class="empty"
      :description="peer ? '他还没有交过这道题' : '这道题你还没有交过'"
    />

    <ul v-else class="list">
      <li v-for="(row, index) in submissions" :key="row.id" class="item">
        <button
          type="button"
          class="row"
          :class="{ open: expanded === row.id, locked: !row.showLink }"
          :disabled="!row.showLink"
          :aria-expanded="row.showLink ? expanded === row.id : undefined"
          @click="toggle(row)"
        >
          <span class="attempt">第 {{ attemptNo(index) }} 次</span>
          <SubmissionResultTag :result="row.result" />
          <span class="meta">{{ LANGUAGE_SHOW_VALUE[row.language] }}</span>
          <span class="meta time">{{ parseTime(row.createTime, "MM-DD HH:mm") }}</span>
          <span v-if="row.showLink" class="caret" aria-hidden="true">
            {{ expanded === row.id ? "▾" : "▸" }}
          </span>
        </button>

        <p v-if="!row.showLink" class="locked-note">
          🔒 这是加入题单之前交的，先藏起来了：在题单里做出这道题就解锁，题单过了截止时间也会解锁
        </p>

        <div v-else-if="expanded === row.id" class="detail">
          <n-flex v-if="details[row.id] === 'loading'" justify="center" class="pad">
            <n-spin size="small" />
          </n-flex>
          <n-text v-else-if="details[row.id] === 'failed'" type="error">
            代码读不出来，收起来再点开试试
          </n-text>
          <template v-else-if="loadedOf(row.id)">
            <pre class="code">{{ loadedOf(row.id)!.code }}</pre>
            <n-flex :size="8" align="center">
              <n-button
                v-if="!teacherCollab"
                size="small"
                type="primary"
                secondary
                @click="putBack(row.id)"
              >
                放回编辑器
              </n-button>
              <n-button size="small" @click="copy(row.id)">复制</n-button>
              <n-button size="small" text class="more" @click="openDetail(row.id)">
                完整详情 ›
              </n-button>
            </n-flex>
          </template>
        </div>
      </li>
    </ul>

    <Pagination
      v-if="total > query.limit"
      :total="total"
      v-model:limit="query.limit"
      v-model:page="query.page"
    />
  </template>
</template>

<style scoped>
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
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.row:hover:not(:disabled),
.row.open {
  background-color: rgba(128, 128, 128, 0.08);
}

.row.locked {
  cursor: default;
  opacity: 0.7;
}

.attempt {
  flex: none;
  min-width: 4.5em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.meta {
  flex: none;
  opacity: 0.7;
}

.time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.caret {
  flex: none;
  width: 1em;
  opacity: 0.6;
}

.locked-note {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 13px;
  opacity: 0.7;
}

.detail {
  padding: 4px 12px 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}

.pad {
  padding: 12px 0;
}

.code {
  margin: 8px 0 10px;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  border-radius: 6px;
  background-color: rgba(128, 128, 128, 0.08);
  font-family: Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre;
}

.more {
  margin-left: auto;
}
</style>
