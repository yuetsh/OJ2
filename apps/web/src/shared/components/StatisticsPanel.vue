<template>
  <n-flex align="center">
    <n-select
      placeholder="班级或用户（可选）"
      v-model:value="query.username"
      :options="classOptions"
      style="width: 190px"
      filterable
      tag
      clearable
    />
    <n-input
      placeholder="题号（可选，逗号分隔）"
      v-model:value="query.problem"
      style="width: 200px"
      clearable
    />
    <n-select
      style="width: 120px"
      v-model:value="query.duration"
      :options="options"
    />
    <n-button type="primary" :loading="loading" @click="handleStatistics">
      统计
    </n-button>
    <n-button v-if="route.name !== 'submissions'" @click="goSubmissions">
      前往提交列表
    </n-button>
  </n-flex>

  <n-empty v-if="!hasResult" description="暂无数据" style="margin: 40px 0" />

  <template v-if="hasResult">
    <n-divider style="margin: 16px 0" />
    <n-flex justify="space-around">
      <div class="stat-item">
        <n-text>总提交</n-text>
        <n-gradient-text type="info" font-size="28">{{
          count.total
        }}</n-gradient-text>
      </div>
      <div class="stat-item">
        <n-text>正确提交</n-text>
        <n-gradient-text type="primary" font-size="28">{{
          count.accepted
        }}</n-gradient-text>
      </div>
      <div class="stat-item" v-if="count.judging > 0">
        <n-text>判题中</n-text>
        <n-gradient-text type="info" font-size="28">{{
          count.judging
        }}</n-gradient-text>
      </div>
      <div class="stat-item">
        <n-text>正确率</n-text>
        <n-gradient-text type="warning" font-size="28"
          >{{ count.rate }}%</n-gradient-text
        >
      </div>
      <template v-if="personCount > 0">
        <div class="stat-item">
          <n-text>完成人数</n-text>
          <n-gradient-text type="error" font-size="28">{{
            list.length
          }}</n-gradient-text>
        </div>
        <div class="stat-item">
          <n-text>班级人数</n-text>
          <n-gradient-text type="warning" font-size="28">{{
            adjustedPersonCount
          }}</n-gradient-text>
        </div>
        <div class="stat-item">
          <n-text>完成度</n-text>
          <n-gradient-text type="success" font-size="28">{{
            adjustedPersonRate
          }}</n-gradient-text>
        </div>
      </template>
    </n-flex>
    <n-divider style="margin: 16px 0" />

    <n-tabs animated type="line">
      <n-tab-pane name="charts" tab="数据图表">
        <n-grid :cols="2" :x-gap="20" :y-gap="20" style="margin-top: 12px">
          <n-gi v-if="count.total > 0">
            <n-card title="提交正确率">
              <Doughnut :data="pieChartData" :options="pieChartOptions" />
            </n-card>
          </n-gi>
          <n-gi v-if="personCount > 0">
            <n-card title="班级完成度">
              <Doughnut
                :data="completionChartData"
                :options="completionChartOptions"
              />
            </n-card>
          </n-gi>
        </n-grid>
      </n-tab-pane>

      <n-tab-pane name="submissions" tab="提交记录">
        <n-data-table
          v-if="list.length"
          striped
          :columns="columns"
          :data="list"
          :row-key="rowKey"
          :expanded-row-keys="expandedRowKeys"
          @update:expanded-row-keys="updateExpandedRowKeys"
          :row-props="rowProps"
          style="margin-top: 12px"
        />
        <n-empty v-else description="还没有人做出来" style="margin: 24px 0" />
      </n-tab-pane>

      <n-tab-pane name="unaccepted" :tab="`未完成（${unfinishedTotal}）`">
        <n-flex align="center" style="margin: 12px 0">
          <n-switch v-model:value="hideMode" size="large">
            <template #checked>请假隐藏中</template>
            <template #unchecked>请假隐藏</template>
          </n-switch>
          <n-button
            v-if="hiddenCount > 0"
            size="small"
            type="info"
            @click="showAll"
          >
            恢复 {{ hiddenCount }} 位
          </n-button>
        </n-flex>
        <n-gradient-text
          v-if="unfinishedGroups.length === 0"
          font-size="24"
          type="success"
        >
          全都完成了
        </n-gradient-text>
        <template v-for="group in unfinishedGroups" :key="group.title">
          <n-text depth="3" class="group-title">
            {{ group.title }}（{{ group.items.length }}）
          </n-text>
          <n-flex size="large" align="center">
            <template v-for="item in group.items" :key="item.username">
              <n-popover
                trigger="click"
                placement="bottom"
                :disabled="!item.failure"
                style="max-width: 460px"
              >
                <template #trigger>
                  <n-tag
                    v-if="hideMode"
                    closable
                    size="large"
                    style="font-size: 20px"
                    @close="hideStudent(item.username)"
                  >
                    {{ item.label }}
                  </n-tag>
                  <span
                    v-else
                    :class="{ name: true, 'name-clickable': !!item.failure }"
                  >
                    {{ item.label }}
                  </span>
                </template>
                <n-flex vertical size="small">
                  <n-text depth="3">
                    最近一次：{{ item.failure?.problem }} ·
                    {{ statusName(item.failure?.result) }}
                  </n-text>
                  <pre v-if="item.failure?.error" class="failure-error">{{
                    item.failure?.error
                  }}</pre>
                  <n-button
                    size="small"
                    tertiary
                    @click="openFailure(item.failure?.id)"
                  >
                    看代码
                  </n-button>
                </n-flex>
              </n-popover>
            </template>
          </n-flex>
        </template>
      </n-tab-pane>
    </n-tabs>
  </template>
</template>
<script setup lang="ts">
import { h } from "vue"
import { formatISO, sub, type Duration } from "date-fns"
import { getSubmissionStatistics, getSubmissionStatisticsItems } from "oj/api"
import { DURATION_OPTIONS, STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import { useConfigStore } from "../store/config"
import { Doughnut } from "vue-chartjs"
import { Chart as ChartJS, ArcElement, Title, Tooltip, Legend } from "chart.js"
import { NButton, NFlex, NText, type DataTableRowKey } from "naive-ui"
import { JUDGE_STATUS } from "utils/constants"
import type {
  AttemptedStudent,
  SubmissionStatisticsItems,
  SubmissionStatisticsUser,
  UnacceptedStudent,
} from "@oj2/contract"

// 注册 Chart.js 组件
ChartJS.register(ArcElement, Title, Tooltip, Legend)

interface Props {
  problem: string
  username: string
}

const props = defineProps<Props>()

const options: SelectOption[] = [
  { label: "10分钟内", value: "minutes:10" },
  { label: "20分钟内", value: "minutes:20" },
  { label: "30分钟内", value: "minutes:30" },
  ...DURATION_OPTIONS,
  { label: "全部时段", value: "all" },
]

function openSubmission(id: string) {
  window.open(`/submission/${id}`, "_blank", "noopener")
}

const columns: DataTableColumn<SubmissionStatisticsUser>[] = [
  {
    type: "expand",
    renderExpand: (row) => {
      const loaded = items[row.username]
      if (!loaded) return h(NText, { depth: 3 }, () => "加载中…")
      return h(NFlex, { vertical: true, size: "small" }, () => [
        h(NFlex, { size: "small", wrap: true }, () =>
          loaded.items.map((item) =>
            h(
              NButton,
              {
                size: "small",
                tertiary: true,
                type: JUDGE_STATUS[item.result]?.type ?? "default",
                style: "width: 120px",
                onClick: (event: MouseEvent) => {
                  event.stopPropagation()
                  openSubmission(item.id)
                },
              },
              () => item.id.toString().slice(0, 12),
            ),
          ),
        ),
        loaded.truncated
          ? h(
              NText,
              { depth: 3 },
              () => `只显示最近 ${loaded.items.length} 条，上面「提交数」才是总数`,
            )
          : null,
      ])
    },
  },
  { title: "用户", key: "username" },
  {
    title: "提交数",
    key: "submissionCount",
    render: (row) =>
      row.judgingCount > 0
        ? `${row.submissionCount}（${row.judgingCount} 条判题中）`
        : `${row.submissionCount}`,
  },
  // 题数，不是通过的提交条数 —— 同一道题重复 AC 只算一道。
  // 「语法未过」是答案对了但没按要求写、而且最后也没改对的，算在已解决里但教学上没达标
  {
    title: "已解决",
    key: "solvedCount",
    render: (row) =>
      row.astOnlyCount > 0
        ? `${row.solvedCount}（${row.astOnlyCount} 题语法未过）`
        : `${row.solvedCount}`,
  },
  // 新后端返回的是数值，百分号在这里补 —— 旧后端直接返回 "85.5%" 字符串
  {
    title: "正确率",
    key: "correctRate",
    render: (row) => `${row.correctRate}%`,
  },
]

const configStore = useConfigStore()

/**
 * 班级下拉。值就是用户名前缀（`ks231`），后端那边本来就是 ilike 模糊匹配，
 * 所以选班级和手打前缀是同一件事。`tag` 留着让老师仍然能直接打某个学生的名字。
 */
const classOptions = computed<SelectOption[]>(
  () =>
    configStore.config?.classList.map((item) => ({
      label: `${item.slice(0, 2)}计算机${item.slice(2)}班`,
      value: `ks${item}`,
    })) ?? [],
)

// 机房电脑一台对一个班，用过的班级记在本地，下次打开就带上（和登录框同一套做法）
function lastUsedClass() {
  const last = storage.get(STORAGE_KEY.STATISTICS_CLASS)
  return typeof last === "string" ? last : ""
}

const query = reactive({
  username: props.username || lastUsedClass(),
  problem: props.problem,
  duration: options[0].value,
})

const count = reactive({
  total: 0,
  accepted: 0,
  // 还在判题队列里的条数。total 含它，rate 的分母不含 —— 全班同时交卷的那几秒，
  // 分母涨了分子没涨，正确率会凭空掉一截
  judging: 0,
  rate: 0,
})
// 花名册人数。后端只下发这一个分母，完成度在前端算 —— 「请假隐藏」要从分母里
// 减人，那是浏览器本地状态，后端算不出来
const personCount = ref(0)
const route = useRoute()
const router = useRouter()

const list = ref<SubmissionStatisticsUser[]>([])
const listUnaccepted = ref<UnacceptedStudent[]>([])
// 交了但一次没对的。和上面那一栏合起来才是「未完成」的全部
const listAttempted = ref<AttemptedStudent[]>([])
const expandedRowKeys = ref<DataTableRowKey[]>([])

/**
 * 展开行的明细，按人缓存。**每次重新统计都清空** —— 时间窗滚过之后旧明细就不对了；
 * 清完如果还有展开着的行，顺手把那一行重拉一遍，让它跟着自动刷新一起活着。
 */
const items = reactive<Record<string, SubmissionStatisticsItems>>({})

// 点一行会同时走 rowProps 的 onClick 和表格的 update:expanded-row-keys，
// 两边都想拉一次；去重放在这里，调用方不用各自判
const itemsLoading = new Set<string>()

async function loadItems(username: string) {
  if (items[username] || itemsLoading.has(username)) return
  itemsLoading.add(username)
  const current = Date.now()
  const duration =
    query.duration === "all"
      ? { end: formatISO(current) }
      : {
          start: formatISO(sub(current, subOptions.value)),
          end: formatISO(current),
        }
  try {
    items[username] = await getSubmissionStatisticsItems(
      duration,
      username,
      query.problem,
    )
  } catch {
    // 拉不到就当空的：展开行显示不出东西，但不该把整个面板带崩
    items[username] = { items: [], truncated: false }
  } finally {
    itemsLoading.delete(username)
  }
}

/**
 * 「查出东西了吗」。**不能只看提交数** —— 一节课刚开始时一条提交都没有，但后端
 * 已经把整份花名册当作「未完成」返回了，而那正是老师最想看名单的时刻。
 * 原来整个面板 v-if 在 count.total > 0 上，那会儿只显示「暂无数据」。
 */
const hasResult = computed(
  () => count.total > 0 || listUnaccepted.value.length > 0,
)

const HIDE_DURATION = 2 * 60 * 60 * 1000
const HIDDEN_KEY = "oj_hidden_students"

function loadHidden(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "{}")
  } catch {
    return {}
  }
}

const hiddenStudents = ref<Record<string, number>>(loadHidden())
const hideMode = ref(false)

function saveHidden(data: Record<string, number>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(data))
}

function hideStudent(username: string) {
  hiddenStudents.value = {
    ...hiddenStudents.value,
    [username]: Date.now() + HIDE_DURATION,
  }
  saveHidden(hiddenStudents.value)
}

function showAll() {
  hiddenStudents.value = {}
  saveHidden({})
}

function notHidden(item: { username: string }) {
  const exp = hiddenStudents.value[item.username]
  return !exp || exp <= Date.now()
}

const visibleUnaccepted = computed(() => listUnaccepted.value.filter(notHidden))
const visibleAttempted = computed(() => listAttempted.value.filter(notHidden))

// 请假的人两栏都要藏 —— 他们同样占着班级人数这个分母
const hiddenCount = computed(
  () =>
    listUnaccepted.value.length +
    listAttempted.value.length -
    visibleUnaccepted.value.length -
    visibleAttempted.value.length,
)

const unfinishedTotal = computed(
  () => visibleUnaccepted.value.length + visibleAttempted.value.length,
)

/**
 * 这次查的是几道题。**取的是「上次点统计时」的值**，不是输入框的当前内容 ——
 * 老师改到一半的题号不该把已经查出来的结果重新解释一遍。
 */
const queriedProblemCount = ref(0)

/**
 * 未完成的两组。合成一栏而不是各占一个 tab：点名时来回切 tab 很别扭；
 * 但也不能混成一个名单 —— 「卡住了」和「还没动手」在课堂上要做的事不一样。
 * 次数缀在名字后面，教师一眼看得出谁卡得最久（后端按提交数倒序给）。
 */
type UnfinishedItem = {
  username: string
  label: string
  /** 只有「交了没对」那一组有，点名字弹出来看错在哪 */
  failure: AttemptedStudent["lastFailure"]
}

const unfinishedGroups = computed<{ title: string; items: UnfinishedItem[] }[]>(
  () =>
    [
      {
        title: "还没交",
        items: visibleUnaccepted.value.map((item) => ({
          username: item.username,
          label: item.realName,
          failure: null,
        })),
      },
      {
        // 查多道题时这一栏混着「一道没对」和「差一道」两种人，标题得说清是「没全对」
        title: queriedProblemCount.value > 1 ? "交了没全对" : "交了没对",
        items: visibleAttempted.value.map((item) => ({
          username: item.username,
          label: attemptedLabel(item),
          failure: item.lastFailure,
        })),
      },
    ].filter((group) => group.items.length > 0),
)

type FailureResult = NonNullable<AttemptedStudent["lastFailure"]>["result"]

// 查多道题时把「做出几道」缀上：差一道和一道没做出来，老师要先管的不是同一个人
function attemptedLabel(item: AttemptedStudent) {
  const total = queriedProblemCount.value
  const progress = total > 1 ? ` ${item.solvedCount}/${total}题` : ""
  return `${item.realName}${progress} ${item.submissionCount}次`
}

function statusName(result?: FailureResult) {
  return result === undefined ? "" : (JUDGE_STATUS[result]?.name ?? "未知状态")
}

function openFailure(id?: string) {
  if (id) openSubmission(id)
}

const adjustedPersonCount = computed(
  () => personCount.value - hiddenCount.value,
)

const adjustedPersonRate = computed(() => {
  if (adjustedPersonCount.value <= 0) return "0%"
  const rate = Math.min(
    100,
    (list.value.length / adjustedPersonCount.value) * 100,
  )
  return `${Math.round(rate * 100) / 100}%`
})

onMounted(() => {
  const now = Date.now()
  const cleaned = Object.fromEntries(
    Object.entries(hiddenStudents.value).filter(([, exp]) => exp > now),
  )
  hiddenStudents.value = cleaned
  saveHidden(cleaned)
  // 打开就查一次。老师是投在屏幕上盯着看的，不该还要先点一下按钮
  handleStatistics()
})

/**
 * 课堂上「还剩几个没交」每十几秒就在变，所以面板自己刷。
 * 时间窗是相对当下算的，每次刷都是新的窗口，不是同一份快照重放。
 * 页面切到后台就停 —— 那会儿没人在看，白跑而已。
 */
const visibility = useDocumentVisibility()
useIntervalFn(() => {
  if (visibility.value === "visible") handleStatistics()
}, 15000)

// 饼图数据 - 提交正确率分布
const pieChartData = computed(() => {
  // 判题中的既不算对也不算错，和正确率同一个口径
  const wrongCount = count.total - count.accepted - count.judging
  return {
    labels: ["正确提交", "错误提交"],
    datasets: [
      {
        label: "提交数",
        data: [count.accepted, wrongCount],
        backgroundColor: ["rgba(75, 192, 192, 0.6)", "rgba(255, 99, 132, 0.6)"],
        borderColor: ["rgba(75, 192, 192, 1)", "rgba(255, 99, 132, 1)"],
        borderWidth: 2,
      },
    ],
  }
})

const pieChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom" as const,
    },
    tooltip: {
      callbacks: {
        label: function (context: any) {
          const label = context.label || ""
          const value = context.parsed || 0
          const total = context.dataset.data.reduce(
            (a: number, b: number) => a + b,
            0,
          )
          const percentage = ((value / total) * 100).toFixed(1)
          return `${label}: ${value} (${percentage}%)`
        },
      },
    },
  },
}

// 环形图数据 - 班级完成度
const completionChartData = computed(() => {
  const completedCount = list.value.length
  const uncompletedCount = Math.max(
    0,
    adjustedPersonCount.value - completedCount,
  )
  return {
    labels: ["已完成", "未完成"],
    datasets: [
      {
        label: "人数",
        data: [completedCount, uncompletedCount],
        backgroundColor: ["rgba(106, 176, 76, 0.6)", "rgba(255, 159, 64, 0.6)"],
        borderColor: ["rgba(106, 176, 76, 1)", "rgba(255, 159, 64, 1)"],
        borderWidth: 2,
      },
    ],
  }
})

const completionChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom" as const,
    },
    tooltip: {
      callbacks: {
        label: function (context: any) {
          const label = context.label || ""
          const value = context.parsed || 0
          const total = context.dataset.data.reduce(
            (a: number, b: number) => a + b,
            0,
          )
          const percentage = ((value / total) * 100).toFixed(1)
          return `${label}: ${value} (${percentage}%)`
        },
      },
    },
  },
}

const subOptions = computed<Duration>(() => {
  let dur = options.find((it) => it.value === query.duration) ?? options[0]
  const x = dur.value!.toString().split(":")
  const unit = x[0]
  const n = x[1]
  return { [unit]: parseInt(n) }
})

function goSubmissions() {
  router.push({
    name: "submissions",
    query: {
      username: query.username,
      problem: query.problem,
    },
  })
}
const loading = ref(false)

async function handleStatistics() {
  // 自动刷新和手点可能撞上，上一次没回来就跳过这一次
  if (loading.value) return
  loading.value = true
  try {
    await fetchStatistics()
  } finally {
    loading.value = false
  }
}

async function fetchStatistics() {
  const current = Date.now()
  const end = formatISO(current)
  const duration =
    query.duration === "all"
      ? { end }
      : { start: formatISO(sub(current, subOptions.value)), end }
  const problems = query.problem
    .split(/[,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const res = await getSubmissionStatistics(
    duration,
    query.problem,
    query.username,
  )
  queriedProblemCount.value = new Set(problems.map((p) => p.toLowerCase())).size
  count.total = res.submissionCount
  count.accepted = res.acceptedCount
  count.judging = res.judgingCount
  count.rate = res.correctRate
  // 这里的 res.data 是载荷**自己**的 data 字段（每个学生一行），
  // 不是原来那层信封 —— 契约 submissionStatisticsSchema 就是这么定的
  list.value = res.data
  listUnaccepted.value = res.dataUnaccepted
  listAttempted.value = res.dataAttempted
  personCount.value = res.personCount
  // 查过的班级记下来，下次打开直接带上
  if (query.username) storage.set(STORAGE_KEY.STATISTICS_CLASS, query.username)

  const expanded = expandedRowKeys.value[0]
  for (const key of Object.keys(items)) delete items[key]
  if (typeof expanded === "string") loadItems(expanded)
}

function rowKey(row: SubmissionStatisticsUser): DataTableRowKey {
  return row.username
}

function updateExpandedRowKeys(keys: DataTableRowKey[]) {
  expandedRowKeys.value = keys.slice(-1)
  const opened = expandedRowKeys.value[0]
  if (typeof opened === "string") loadItems(opened)
}

function rowProps(row: SubmissionStatisticsUser) {
  return {
    style: "cursor: pointer;",
    onClick: () => {
      const key = rowKey(row)
      const isExpanded = expandedRowKeys.value.includes(key)
      expandedRowKeys.value = isExpanded ? [] : [key]
      if (!isExpanded) loadItems(row.username)
    },
  }
}
</script>
<style scoped>
.name {
  font-size: 24px;
}

.name-clickable {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 4px;
}

.failure-error {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.group-title {
  display: block;
  margin: 16px 0 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
</style>
