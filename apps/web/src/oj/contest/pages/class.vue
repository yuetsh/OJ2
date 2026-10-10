<script setup lang="ts">
import type { ContestClassView, ContestScoreCell, ContestScoreRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { updateACMHelperChecked } from "admin/api"
import { getContestClassView, getSubmission, getSubmissions } from "oj/api"
import { useContestStore } from "oj/store/contest"
import UserName from "shared/components/UserName.vue"
import { useTone } from "oj/submission/composables/tone"
import { classLabel } from "oj/submission/utils"
import { useLeaveStudents } from "shared/composables/leaveStudents"
import { ContestStatus, LANGUAGE_FORMAT_VALUE } from "utils/constants"
import { parseTime, secondsToDuration } from "utils/functions"
import type { Submission } from "utils/types"

/**
 * 老师的「全班情况」，考完叫「成绩」（设计稿「比赛重设计」老师两块）。学生看不到这一页。
 *
 * 名字和排行榜一样用用户名（ks241XXX），不用真名。
 * 考试中：卡在一道题（错 3 次以上）和 15 分钟以上没交的人放最上面，
 * 没进来的人在最下面（看板里标了请假的写「请假」）。
 * 考完：按姓名一张表，点格子右边看代码、标「看过了」（代替原来后台的「审核」页），导出成绩。
 * 名单是推出来的：比赛不绑班，来了一半以上的班才算这场的班（后端 buildClassView）
 */
const props = defineProps<{ contestID: string }>()

const contestStore = useContestStore()
const theme = useThemeVars()
const tone = useTone()
const message = useMessage()
const { onLeave } = useLeaveStudents("oj_leave_students")

const view = ref<ContestClassView | null>(null)
const failed = ref(false)

async function load() {
  try {
    view.value = await getContestClassView(props.contestID)
  } catch {
    failed.value = true
  }
}

const running = computed(() => contestStore.contestStatus === ContestStatus.underway)
const ended = computed(() => contestStore.contestStatus === ContestStatus.finished)

const { pause, resume } = useIntervalFn(load, 15_000, { immediate: false })
watch(
  () => [contestStore.canEnter, running.value] as const,
  ([enter, run]) => {
    if (!enter) return
    load()
    if (run) resume()
    else pause()
  },
  { immediate: true },
)

const problems = computed(() => view.value?.problems ?? [])
const rows = computed(() => view.value?.rows ?? [])

function cellOf(row: ContestScoreRow, problemId: number): ContestScoreCell | undefined {
  return row.cells[String(problemId)]
}

// ---------------------------------------------------------------- 考试中

const STUCK_ERRORS = 3
const IDLE_MINUTES = 15

function minutesSinceLast(row: ContestScoreRow) {
  const last = view.value?.lastSubmit[String(row.userId)]
  if (!last) return null
  return Math.max(0, Math.floor((contestStore.now - Date.parse(last.time)) / 60_000))
}

function flagOf(row: ContestScoreRow) {
  for (const p of problems.value) {
    const cell = cellOf(row, p.id)
    if (cell && !cell.isAc && cell.errors >= STUCK_ERRORS) {
      return { kind: "stuck" as const, text: `卡在第 ${p._id} 题，错 ${cell.errors} 次` }
    }
  }
  const idle = minutesSinceLast(row)
  if (
    running.value &&
    idle !== null &&
    idle >= IDLE_MINUTES &&
    row.solved < problems.value.length
  ) {
    return { kind: "idle" as const, text: `${idle} 分钟没交` }
  }
  return null
}

const attention = computed(() =>
  rows.value
    .map((row) => ({ row, flag: flagOf(row) }))
    .filter((item) => item.flag !== null)
    .sort((a, b) =>
      a.flag!.kind === b.flag!.kind
        ? a.row.solved - b.row.solved
        : a.flag!.kind === "stuck"
          ? -1
          : 1,
    ),
)
const others = computed(() => {
  const flagged = new Set(attention.value.map((item) => item.row.userId))
  return rows.value
    .filter((row) => !flagged.has(row.userId))
    .sort((a, b) => a.solved - b.solved || (minutesSinceLast(b) ?? 0) - (minutesSinceLast(a) ?? 0))
})
const absent = computed(() =>
  (view.value?.absent ?? []).map((user) => ({ ...user, leave: onLeave(user.username) })),
)
const leaveCount = computed(() => absent.value.filter((user) => user.leave).length)
const rosterSize = computed(() => {
  const classes = new Set(view.value?.classes ?? [])
  return (
    rows.value.filter((row) => row.className && classes.has(row.className)).length +
    absent.value.length
  )
})
const average = computed(() =>
  rows.value.length
    ? (rows.value.reduce((sum, row) => sum + row.solved, 0) / rows.value.length).toFixed(1)
    : "0",
)
const stuckCount = computed(
  () => attention.value.filter((item) => item.flag!.kind === "stuck").length,
)
const idleCount = computed(
  () => attention.value.filter((item) => item.flag!.kind === "idle").length,
)

function lastText(row: ContestScoreRow) {
  const minutes = minutesSinceLast(row)
  if (minutes === null) return ""
  return minutes === 0 ? "刚刚" : `${minutes} 分钟前`
}

const classNames = computed(() => (view.value?.classes ?? []).map(classLabel).join("、"))

// ---------------------------------------------------------------- 考完：成绩

/** 按姓名（用户名，中文按拼音）/ 名次 / 做对少的在前 */
type Sort = "username" | "rank" | "weak"
const sort = ref<Sort>("username")
const gradeRows = computed(() => {
  const list = [...rows.value]
  if (sort.value === "username") list.sort((a, b) => a.username.localeCompare(b.username, "zh-CN"))
  else if (sort.value === "weak") list.sort((a, b) => a.solved - b.solved || b.rank! - a.rank!)
  return list
})

const distribution = computed(() => {
  const count = new Map<number, number>()
  for (const row of rows.value) count.set(row.solved, (count.get(row.solved) ?? 0) + 1)
  return [...count.entries()].sort(([a], [b]) => b - a)
})
const acTotal = computed(() =>
  rows.value.reduce((sum, row) => sum + Object.values(row.cells).filter((c) => c.isAc).length, 0),
)
const checkedTotal = computed(() =>
  rows.value.reduce(
    (sum, row) => sum + Object.values(row.cells).filter((c) => c.isAc && c.checked).length,
    0,
  ),
)

function barColor(solved: number) {
  const n = problems.value.length || 1
  const ratio = solved / n
  if (ratio >= 1) return theme.value.successColor
  if (ratio >= 0.7) return tone("success").solid + "b3"
  if (ratio >= 0.5) return tone("success").solid + "66"
  if (ratio >= 0.3) return theme.value.warningColor
  return theme.value.errorColor + "aa"
}

const selected = ref<{ userId: number; problemId: number } | null>(null)
const code = ref<Submission | null>(null)
const codeState = ref<"idle" | "loading" | "none" | "failed">("idle")

const selectedRow = computed(() =>
  selected.value ? rows.value.find((row) => row.userId === selected.value!.userId) : undefined,
)
const selectedProblem = computed(() =>
  selected.value ? problems.value.find((p) => p.id === selected.value!.problemId) : undefined,
)
const selectedCell = computed(() =>
  selectedRow.value && selectedProblem.value
    ? cellOf(selectedRow.value, selectedProblem.value.id)
    : undefined,
)

async function pick(row: ContestScoreRow, problemId: number) {
  selected.value = { userId: row.userId, problemId }
  code.value = null
  const problem = problems.value.find((p) => p.id === problemId)
  if (!problem || !cellOf(row, problemId)) {
    codeState.value = "none"
    return
  }
  codeState.value = "loading"
  try {
    const list = await getSubmissions({
      contestId: props.contestID,
      username: row.username,
      problemDisplayId: problem._id,
      limit: 100,
      offset: 0,
    })
    const mine = list.results.filter((item) => item.username === row.username)
    const target = mine.find((item) => item.result === 0) ?? mine[0]
    if (!target) {
      codeState.value = "none"
      return
    }
    const detail = await getSubmission(target.id)
    if (selected.value?.userId !== row.userId || selected.value.problemId !== problemId) return
    code.value = detail
    codeState.value = "idle"
  } catch {
    codeState.value = "failed"
  }
}

async function toggleChecked(value: boolean) {
  const row = selectedRow.value
  const cell = selectedCell.value
  if (!row || !cell || !selected.value) return
  try {
    await updateACMHelperChecked(
      Number(props.contestID),
      row.rankId,
      String(selected.value.problemId),
      value,
    )
    cell.checked = value
  } catch {
    message.error("没标上，只有出这场比赛的老师能标")
  }
}

function step(dx: number, dy: number) {
  if (!selected.value) return
  const list = gradeRows.value
  const r = list.findIndex((row) => row.userId === selected.value!.userId)
  const c = problems.value.findIndex((p) => p.id === selected.value!.problemId)
  const nr = Math.min(list.length - 1, Math.max(0, r + dy))
  const nc = Math.min(problems.value.length - 1, Math.max(0, c + dx))
  if (list[nr] && problems.value[nc]) pick(list[nr], problems.value[nc].id)
}

onKeyStroke(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], (event) => {
  if (!ended.value || !selected.value) return
  const target = event.target as HTMLElement | null
  if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return
  event.preventDefault()
  const map = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  } as const
  const [dx, dy] = map[event.key as keyof typeof map]
  step(dx, dy)
})

function exportGrades() {
  const title = contestStore.contest?.title ?? "比赛"
  const head = [
    "用户名",
    "班级",
    "做对",
    "名次",
    "用时",
    ...problems.value.map((p) => `第${p._id}题 ${p.title}`),
  ]
  const lines = [head]
  const byUsername = [...rows.value].sort((a, b) => a.username.localeCompare(b.username, "zh-CN"))
  for (const row of byUsername) {
    lines.push([
      row.username,
      row.className ? classLabel(row.className) : "",
      String(row.solved),
      String(row.rank ?? ""),
      secondsToDuration(row.totalTime),
      ...problems.value.map((p) => {
        const cell = cellOf(row, p.id)
        return !cell ? "没交" : cell.isAc ? "对" : "错"
      }),
    ])
  }
  for (const user of absent.value) {
    lines.push([
      user.username,
      user.className ? classLabel(user.className) : "",
      user.leave ? "请假" : "没考",
      "",
      "",
      ...problems.value.map(() => ""),
    ])
  }
  const csv = lines
    .map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\r\n")
  // 带 BOM，Excel 双击打开中文才不乱码
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${title} 成绩.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const success = computed(() => tone("success"))
const danger = computed(() => tone("error"))
const warning = computed(() => tone("warning"))
const liveColumns = computed(
  () => `130px 48px repeat(${problems.value.length}, minmax(70px, 96px)) 90px 1fr`,
)
const gradeColumns = computed(() => `24px 124px 40px 36px repeat(${problems.value.length}, 50px)`)
</script>

<template>
  <div v-if="failed" class="empty">没拉到全班情况，刷新试试</div>
  <div v-else-if="!view" class="empty">加载中…</div>

  <!-- ==================== 考试中 / 还没开始 ==================== -->
  <div v-else-if="!ended" class="live">
    <div class="summary">
      <div class="stat">
        <b>{{ rows.length }}</b>
        <span
          >进来了<template v-if="classNames">
            · {{ classNames }} {{ rosterSize }} 人</template
          ></span
        >
      </div>
      <div v-if="absent.length" class="stat">
        <b class="grey">{{ absent.length }}</b>
        <span
          >没进来<template v-if="leaveCount">（{{ leaveCount }} 人请假）</template></span
        >
      </div>
      <div class="stat">
        <b>{{ average }}</b
        ><span>平均做对（共 {{ problems.length }} 道）</span>
      </div>
      <div class="stat">
        <b class="red">{{ stuckCount }}</b
        ><span>卡在一道题上（错 3 次以上）</span>
      </div>
      <div v-if="running" class="stat">
        <b class="amber">{{ idleCount }}</b
        ><span>{{ IDLE_MINUTES }} 分钟以上没交</span>
      </div>
    </div>

    <div class="grid-wrap">
      <div class="tr th" :style="{ gridTemplateColumns: liveColumns }">
        <span>学生</span>
        <span class="num">做对</span>
        <span v-for="p in problems" :key="p.id" class="ph" :title="p.title">
          <span class="ell"
            ><b>{{ p._id }}</b> {{ p.title }}</span
          >
          <span>{{ p.solvedUsers }} 人对</span>
        </span>
        <span class="num">最近一次交</span>
        <span></span>
      </div>

      <template v-if="attention.length">
        <div class="group red-group">要看一眼的 {{ attention.length }} 人</div>
        <div
          v-for="{ row, flag } in attention"
          :key="row.userId"
          class="tr"
          :style="{ gridTemplateColumns: liveColumns }"
        >
          <UserName :username="row.username" />
          <span class="num solved">{{ row.solved }}</span>
          <span v-for="p in problems" :key="p.id" class="lc">
            <template v-if="cellOf(row, p.id)">
              <span v-if="cellOf(row, p.id)!.isAc" class="cell ac"
                >✓ {{ Math.floor(cellOf(row, p.id)!.acTime / 60) }}′<small
                  v-if="cellOf(row, p.id)!.errors"
                  >-{{ cellOf(row, p.id)!.errors }}</small
                ></span
              >
              <span v-else class="cell no" :class="{ hot: cellOf(row, p.id)!.errors >= 3 }">{{
                cellOf(row, p.id)!.errors ? `错 ${cellOf(row, p.id)!.errors}` : "交过"
              }}</span>
            </template>
            <span v-else class="dot">·</span>
          </span>
          <span class="num muted tiny">{{ lastText(row) }}</span>
          <span class="flag-wrap">
            <span class="flag" :class="flag!.kind">{{ flag!.text }}</span>
          </span>
        </div>
      </template>

      <div class="group">其余 {{ others.length }} 人 · 做对少的在前</div>
      <div
        v-for="row in others"
        :key="row.userId"
        class="tr"
        :style="{ gridTemplateColumns: liveColumns }"
      >
        <UserName :username="row.username" />
        <span class="num solved">{{ row.solved }}</span>
        <span v-for="p in problems" :key="p.id" class="lc">
          <template v-if="cellOf(row, p.id)">
            <span v-if="cellOf(row, p.id)!.isAc" class="cell ac"
              >✓ {{ Math.floor(cellOf(row, p.id)!.acTime / 60) }}′<small
                v-if="cellOf(row, p.id)!.errors"
                >-{{ cellOf(row, p.id)!.errors }}</small
              ></span
            >
            <span v-else class="cell no">{{
              cellOf(row, p.id)!.errors ? `错 ${cellOf(row, p.id)!.errors}` : "交过"
            }}</span>
          </template>
          <span v-else class="dot">·</span>
        </span>
        <span class="num muted tiny">{{ lastText(row) }}</span>
        <span></span>
      </div>

      <template v-if="absent.length">
        <div class="group">没进来 {{ absent.length }} 人</div>
        <div
          v-for="user in absent"
          :key="user.userId"
          class="tr absent"
          :style="{ gridTemplateColumns: liveColumns }"
        >
          <UserName :username="user.username" muted />
          <span></span>
          <span v-for="p in problems" :key="p.id"></span>
          <span></span>
          <span class="flag-wrap">
            <span class="flag grey">{{ user.leave ? "请假（看板里标的）" : "没进来" }}</span>
          </span>
        </div>
      </template>
    </div>
  </div>

  <!-- ==================== 考完：成绩 ==================== -->
  <div v-else class="grades">
    <div class="grade-bar">
      <div class="dist">
        <div class="dist-bar">
          <span
            v-for="[solved, n] in distribution"
            :key="solved"
            :title="`做对 ${solved} 道 ${n} 人`"
            :style="{ width: `${(n / rows.length) * 100}%`, background: barColor(solved) }"
          ></span>
        </div>
        <div class="dist-legend">
          <span v-for="[solved, n] in distribution" :key="solved">
            <i :style="{ background: barColor(solved) }"></i>{{ solved }} 道 {{ n }} 人
          </span>
        </div>
      </div>
      <span class="sec small">
        {{ rows.length }} 人考了<template v-if="absent.length">
          · {{ absent.length }} 人没考<template v-if="leaveCount"
            >（{{ leaveCount }} 人请假）</template
          ></template
        >
        · 平均做对 {{ average }} 道
      </span>
      <div class="spacer"></div>
      <span class="muted small">代码看过 {{ checkedTotal }} / {{ acTotal }} 份</span>
      <n-button type="primary" @click="exportGrades">导出成绩</n-button>
    </div>

    <div class="split">
      <section class="sheet">
        <div class="sort">
          <span class="muted small">排序</span>
          <button class="chip" :class="{ on: sort === 'username' }" @click="sort = 'username'">
            姓名
          </button>
          <button class="chip" :class="{ on: sort === 'rank' }" @click="sort = 'rank'">名次</button>
          <button class="chip" :class="{ on: sort === 'weak' }" @click="sort = 'weak'">
            做对少的在前
          </button>
        </div>
        <div class="sheet-scroll">
          <div class="tr th" :style="{ gridTemplateColumns: gradeColumns }">
            <span></span>
            <span>学生</span>
            <span class="num">做对</span>
            <span class="num">名次</span>
            <span v-for="p in problems" :key="p.id" class="ph center" :title="p.title">
              <b>{{ p._id }}</b
              ><span>{{ p.solvedUsers }} 人对</span>
            </span>
          </div>
          <div
            v-for="(row, index) in gradeRows"
            :key="row.userId"
            class="tr"
            :class="{ picked: selected?.userId === row.userId }"
            :style="{ gridTemplateColumns: gradeColumns }"
          >
            <span class="muted tiny num">{{ index + 1 }}</span>
            <UserName :username="row.username" />
            <span class="num solved">{{ row.solved }}</span>
            <span class="num muted tiny">{{ row.rank }}</span>
            <button
              v-for="p in problems"
              :key="p.id"
              class="gc"
              :class="{
                ac: cellOf(row, p.id)?.isAc,
                no: cellOf(row, p.id) && !cellOf(row, p.id)!.isAc,
                sel: selected?.userId === row.userId && selected.problemId === p.id,
              }"
              :title="`${row.username} · 第 ${p._id} 题`"
              @click="pick(row, p.id)"
            >
              <template v-if="cellOf(row, p.id)?.isAc">✓</template>
              <template v-else-if="cellOf(row, p.id)">✗</template>
              <template v-else>·</template>
              <i v-if="cellOf(row, p.id)?.checked" class="seen"></i>
            </button>
          </div>
          <div
            v-for="user in absent"
            :key="user.userId"
            class="tr absent"
            :style="{ gridTemplateColumns: gradeColumns }"
          >
            <span></span>
            <UserName :username="user.username" muted />
            <span class="tiny">{{ user.leave ? "请假" : "没考" }}</span>
          </div>
        </div>
      </section>

      <section class="code-panel">
        <template v-if="selectedRow && selectedProblem">
          <div class="code-head">
            <UserName :username="selectedRow.username" />
            <span class="muted">·</span>
            <span
              ><span class="muted">{{ selectedProblem._id }}</span>
              {{ selectedProblem.title }}</span
            >
            <span v-if="selectedCell?.isAc" class="pill ok">
              {{
                Math.floor(selectedCell.acTime / 60) === 0
                  ? "1 分钟内做对"
                  : `第 ${Math.floor(selectedCell.acTime / 60)} 分钟做对`
              }}
            </span>
            <span v-else-if="selectedCell" class="pill bad">没做对</span>
            <span v-if="selectedCell?.errors" class="muted small"
              >错过 {{ selectedCell.errors }} 次</span
            >
            <span v-if="selectedCell?.firstAc" class="muted small">· 全班最先做对</span>
          </div>
          <div class="code-box">
            <n-code
              v-if="code"
              :code="code.code"
              :language="LANGUAGE_FORMAT_VALUE[code.language]"
              show-line-numbers
            />
            <span v-else-if="codeState === 'loading'" class="muted">代码加载中…</span>
            <span v-else-if="codeState === 'none'" class="muted">这题没交</span>
            <span v-else-if="codeState === 'failed'" class="muted">代码没拉下来，再点一次</span>
          </div>
          <div class="code-foot">
            <n-checkbox
              v-if="selectedCell?.isAc"
              :checked="selectedCell.checked"
              :disabled="!contestStore.isContestAdmin"
              @update:checked="toggleChecked"
              >看过了，没问题</n-checkbox
            >
            <span v-if="code" class="muted tiny">
              {{ code.language }} · {{ parseTime(code.createTime, "M月D日 HH:mm:ss") }}
            </span>
          </div>
        </template>
        <div v-else class="code-empty muted">
          点左边任意一格，这里看那个人那道题的代码。<br />做对的格子看完可以标「看过了」，查抄袭用。
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.empty {
  padding: 60px 20px;
  text-align: center;
  color: v-bind("theme.textColor3");
}

.muted {
  color: v-bind("theme.textColor3");
}

.sec {
  color: v-bind("theme.textColor2");
}

.small {
  font-size: var(--oj-fs-sec);
}

.tiny {
  font-size: var(--oj-fs-meta);
}

.spacer {
  flex-grow: 1;
}

.ell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.summary {
  min-height: 80px;
  box-sizing: border-box;
  padding: 12px var(--oj-pad-x);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px 36px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat b {
  font-size: 26px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.stat span {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.stat .grey {
  color: v-bind("theme.textColor3");
}

.stat .red {
  color: v-bind("danger.color");
}

.stat .amber {
  color: v-bind("warning.color");
}

.grid-wrap {
  overflow-x: auto;
}

.tr {
  display: grid;
  align-items: center;
  column-gap: 6px;
  min-width: max-content;
  min-height: 46px;
  padding: 0 var(--oj-pad-x);
  font-size: var(--oj-fs-body);
  box-sizing: border-box;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.th {
  min-height: 50px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
}

.ph {
  display: flex;
  flex-direction: column;
  line-height: 16px;
  min-width: 0;
}

.ph b {
  color: v-bind("theme.textColor2");
}

.ph.center {
  align-items: center;
}

.ph span {
  font-size: 12px;
}

.solved {
  font-weight: 700;
  padding-right: 10px;
}

.lc {
  display: flex;
}

.cell {
  width: 100%;
  height: 30px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: var(--oj-fs-meta);
  font-variant-numeric: tabular-nums;
}

.cell small {
  font-size: 11px;
  opacity: 0.8;
}

.cell.ac {
  font-weight: 600;
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.cell.no {
  background: v-bind("danger.background");
  color: v-bind("danger.color");
}

.cell.no.hot {
  font-weight: 700;
  box-shadow: inset 0 0 0 1px v-bind("danger.color");
}

.dot {
  width: 100%;
  text-align: center;
  color: v-bind("theme.textColor3");
  opacity: 0.5;
}

.group {
  height: 32px;
  padding: 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  font-size: var(--oj-fs-meta);
  font-weight: 600;
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.red-group {
  color: v-bind("danger.color");
  background: v-bind("danger.background");
}

.flag-wrap {
  display: flex;
  justify-content: flex-end;
}

.flag {
  height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.flag.stuck {
  background: v-bind("danger.background");
  color: v-bind("danger.color");
}

.flag.idle {
  background: v-bind("warning.background");
  color: v-bind("warning.color");
}

.flag.grey {
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor3");
}

.tr.absent {
  color: v-bind("theme.textColor3");
  background: v-bind("theme.actionColor");
}

/* ---------- 成绩 ---------- */

.grade-bar {
  min-height: 72px;
  box-sizing: border-box;
  padding: 12px var(--oj-pad-x);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.dist {
  width: 480px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dist-bar {
  display: flex;
  height: 12px;
  border-radius: 3px;
  overflow: hidden;
}

.dist-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor2");
}

.dist-legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dist-legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.split {
  display: flex;
  flex-wrap: wrap;
}

.sheet {
  flex: 1 1 560px;
  min-width: 0;
  border-right: 1px solid v-bind("theme.dividerColor");
}

.sort {
  height: 48px;
  padding: 0 var(--oj-pad-x);
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.chip {
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  cursor: pointer;
}

.chip.on {
  border-color: transparent;
  background: v-bind("success.background");
  color: v-bind("success.color");
  font-weight: 600;
}

.sheet-scroll {
  max-height: calc(100vh - 284px);
  overflow: auto;
}

.sheet .tr {
  min-height: 40px;
  padding: 0 16px 0 var(--oj-pad-x);
}

.sheet .th {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 46px;
}

.tr.picked {
  background: v-bind("theme.hoverColor");
}

.gc {
  position: relative;
  height: 28px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.gc.ac {
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.gc.no {
  background: v-bind("danger.background");
  color: v-bind("danger.color");
}

.gc.sel {
  box-shadow: 0 0 0 2px v-bind("theme.textColor1");
}

.seen {
  position: absolute;
  top: 3px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: v-bind("success.color");
}

.code-panel {
  flex: 1 1 480px;
  min-width: 0;
  box-sizing: border-box;
  padding: 16px var(--oj-pad-x) 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: v-bind("theme.actionColor");
}

.code-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.pill.ok {
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.pill.bad {
  background: v-bind("danger.background");
  color: v-bind("danger.color");
}

.code-box {
  flex-grow: 1;
  min-height: 300px;
  max-height: calc(100vh - 360px);
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
  font-size: 15px;
}

.code-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.code-empty {
  padding: 80px 20px;
  text-align: center;
  line-height: 1.8;
}
</style>
