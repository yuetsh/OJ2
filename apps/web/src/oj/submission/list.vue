<script setup lang="ts">
import { NButton, NFlex, NTag, NText } from "naive-ui"
import { useRouteQuery } from "@vueuse/router"
import {
  adminRejudge,
  getFlowchartSubmissions,
  getSubmissions,
  getTodaySubmissionCount,
  retryFlowchartSubmission,
} from "oj/api"
import { parseTime } from "utils/functions"
import type { Grade as GradeValue } from "utils/types"
import type {
  FlowchartSubmissionListItem,
  LANGUAGE,
  SubmissionListItem,
} from "utils/types"
import Pagination from "shared/components/Pagination.vue"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import { useBreakpoints } from "shared/composables/breakpoints"
import { usePagination } from "shared/composables/pagination"
import { useUserStore } from "shared/store/user"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"
import { renderTableTitle } from "utils/renders"
import { FlowchartSubmissionStatus } from "utils/types"

// 流程图提交的四种状态，列表里原来一列都没有 ——
// 老师分不出「还在评」和「评失败了」，两种都只是分数栏空着
const FLOWCHART_STATUS_TAG: Record<
  number,
  { text: string; type: "default" | "info" | "success" | "error" }
> = {
  [FlowchartSubmissionStatus.PENDING]: { text: "排队中", type: "default" },
  [FlowchartSubmissionStatus.PROCESSING]: { text: "评分中", type: "info" },
  [FlowchartSubmissionStatus.COMPLETED]: { text: "已完成", type: "success" },
  [FlowchartSubmissionStatus.FAILED]: { text: "评分失败", type: "error" },
}
import ButtonWithSearch from "./components/ButtonWithSearch.vue"
import SubmissionLink from "./components/SubmissionLink.vue"
import Grade from "./components/Grade.vue"
import FlowchartLink from "./components/FlowchartLink.vue"

// 下面四个组件只在默认关闭的 n-modal 里用，其中两个统计面板还只有老师看得见。
// 静态 import 会把它们拖进本路由的关键路径——光 chart.js 就 197KB，进页面前必须先下完。
// 改成异步后本路由增量下载从 675KB / 59 个文件降到 360KB 出头。
const StatisticsPanel = defineAsyncComponent(
  () => import("shared/components/StatisticsPanel.vue"),
)
const FlowchartStatisticsPanel = defineAsyncComponent(
  () => import("shared/components/FlowchartStatisticsPanel.vue"),
)
const SubmissionDetail = defineAsyncComponent(() => import("./detail.vue"))
const FlowchartScoreDetail = defineAsyncComponent(
  () => import("./components/FlowchartScoreDetail.vue"),
)

interface SubmissionQuery {
  username: string
  result: string
  myself: "0" | "1"
  problem: string
  language: LANGUAGE | ""
  today: "0" | "1"
}

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const message = useMessage()

const { isMobile, isDesktop } = useBreakpoints()

const submissions = ref<SubmissionListItem[]>([])
const flowcharts = ref<FlowchartSubmissionListItem[]>([])
const total = ref(0)
const todayCount = ref(0)
// 没有它的话，等接口这段时间表格就是一片空白，连转圈都没有
const loading = ref(false)

/**
 * 转圈圈延迟出现。翻页、切筛选大多在一百毫秒内就回来了，直接切数据比「闪一下
 * 转圈再切」看着稳；只有真的慢到 300ms 以上才值得给个反馈。
 *
 * 注意是**单向**延迟：只推迟「显示」，一旦请求结束立刻收掉，不留尾巴。
 *
 * 为什么不用 n-spin 的 delay：n-data-table 压根不走 n-spin，它渲染的是内部的
 * _internal/loading，直接由 loading 控制、没有 delay 参数。要用内置的就得把表格
 * 包进 <n-spin :show :delay> 再去掉 :loading —— 那会换掉加载样式，还会丢掉
 * loading 时锁住排序/分页交互（DataTable 里那个 `disabled: this.loading`）。
 * 下面这几行就是 n-spin 内部同样的写法（watchEffect + setTimeout + 清理）。
 */
const LOADING_DELAY = 300
const showLoading = ref(false)
let loadingTimer: ReturnType<typeof setTimeout> | undefined
watch(loading, (value) => {
  clearTimeout(loadingTimer)
  if (!value) {
    showLoading.value = false
    return
  }
  loadingTimer = setTimeout(() => (showLoading.value = true), LOADING_DELAY)
})
onUnmounted(() => clearTimeout(loadingTimer))

// 使用分页 composable
const { query, clearQuery } = usePagination<SubmissionQuery>({
  username: useRouteQuery("username", "").value,
  result: useRouteQuery("result", "").value,
  myself: useRouteQuery("myself", "0").value,
  problem: useRouteQuery("problem", "").value,
  language: useRouteQuery("language", "").value,
  today: "0",
})
const submissionID = ref("")
const problemDisplayID = ref("")
const [statisticPanel, toggleStatisticPanel] = useToggle(false)

const [codePanel, toggleCodePanel] = useToggle(false)
const [scoreDetailPanel, toggleScoreDetailPanel] = useToggle(false)
const selectedFlowchartId = ref("")
const selectedFlowchart = computed(() => {
  return flowcharts.value.find((f) => f.id === selectedFlowchartId.value)
})

const resultOptions: SelectOption[] = [
  { label: "全部", value: "" },
  { label: "答案正确", value: "0" },
  { label: "语法未通过", value: "10" },
  { label: "答案错误", value: "-1" },
  { label: "编译失败", value: "-2" },
  { label: "运行时错误", value: "4" },
]

const gradeOptions: SelectOption[] = [
  { label: "全部", value: "" },
  { label: "S级", value: "S" },
  { label: "A级", value: "A" },
  { label: "B级", value: "B" },
  { label: "C级", value: "C" },
]

const languageOptions: SelectOption[] = [
  { label: "流程图", value: "Flowchart" },
  { label: "全部语言", value: "" },
  { label: "Python", value: "Python3" },
  { label: "C语言", value: "C" },
  { label: "C++", value: "C++" },
]
async function listSubmissions() {
  if (query.page < 1) query.page = 1
  const offset = query.limit * (query.page - 1)
  loading.value = true
  try {
    if (query.language === "Flowchart") {
      const res = await getFlowchartSubmissions({
        username: query.username,
        problemId: query.problem,
        myself: query.myself,
        offset,
        limit: query.limit,
        today: query.today,
        grade: query.result,
      })
      total.value = res.total
      flowcharts.value = res.results
    } else {
      const res = await getSubmissions({
        ...query,
        offset,
        problemId: query.problem,
        contestId: (route.params.contestID as string) ?? "",
        language: query.language,
        today: query.today,
      })
      submissions.value = res.results
      total.value = res.total
    }
  } finally {
    loading.value = false
  }
}

async function getTodayCount() {
  const res = await getTodaySubmissionCount(query.language)
  todayCount.value = res
}

onMounted(() => {
  listSubmissions()
  if (route.name === "submissions") {
    getTodayCount()
  }
})

function search(username: string, problem: string) {
  query.username = username
  query.problem = problem
}

function clear() {
  clearQuery()
}

async function rejudge(submissionID: string) {
  await adminRejudge(submissionID)
  message.success("重新判分成功")
  listSubmissions()
}

async function retryFlowchart(submissionId: string) {
  // 后端会拒掉「还在评分中」的提交（409 retry-not-allowed），也可能撞上限流。
  // 不兜住的话拦截器静默 reject，老师点下去完全没反应。
  // 按错误码分支而不是 match 文案（见 utils/api.ts 的约定）——后端文案是英文的，
  // 直接弹给老师看不合适
  const retryTips: Record<string, string> = {
    "retry-not-allowed": "这条还在评分中，等出了结果再重新评分",
    "too-many-submissions": "操作太频繁了，缓一下再试",
    "flowchart-not-found": "提交不存在，或者没有权限",
  }
  try {
    await retryFlowchartSubmission(submissionId)
  } catch (err: any) {
    message.error(retryTips[err?.error] ?? "重新评分失败")
    return
  }
  message.success("重新评分已提交")
  listSubmissions()
}

function problemClicked(row: SubmissionListItem | FlowchartSubmissionListItem) {
  if (route.name === "contest submissions") {
    const path = router.resolve({
      name: "contest problem",
      params: {
        problemID: row.problem,
      },
    })
    window.open(path.href, "_blank")
  } else {
    window.open("/problem/" + row.problem, "_blank")
  }
}

function showCodePanel(id: string, problem: string) {
  toggleCodePanel(true)
  submissionID.value = id
  problemDisplayID.value = problem
}

function showScoreDetail(id: string) {
  selectedFlowchartId.value = id
  toggleScoreDetailPanel(true)
}

function getGradeType(grade?: string) {
  if (!grade) return "default"
  if (grade === "S") return "primary"
  if (grade === "A") return "info"
  if (grade === "B") return "warning"
  return "error"
}

// 监听用户名和题号变化（防抖）
watchDebounced(() => [query.username, query.problem], listSubmissions, {
  debounce: 500,
  maxWait: 1000,
})

// 监听其他查询条件变化
watch(
  () => [
    query.page,
    query.limit,
    query.myself,
    query.result,
    query.language,
    query.today,
  ],
  listSubmissions,
)

// 切换语言时重置过滤条件，刷新今日提交数
watch(
  () => query.language,
  () => {
    query.result = ""
    if (route.name === "submissions") getTodayCount()
  },
)

// 登录状态变化后刷新提交列表，更新提交编号列的可点击状态。
// 今日提交数不看登录态，onMounted 那次就够了，这里不用再拉一遍。
watch(
  () => userStore.isAuthed,
  () => listSubmissions(),
)

const columns = computed(() => {
  const res: DataTableColumn<SubmissionListItem>[] = [
    {
      title: renderTableTitle("提交时间", "fluent-emoji:seven-oclock"),
      key: "create_time",
      minWidth: 200,
      render: (row) => parseTime(row.createTime, "YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: renderTableTitle("提交编号", "fluent-emoji-flat:input-numbers"),
      key: "id",
      minWidth: 200,
      render: (row) =>
        h(SubmissionLink, {
          submission: row,
          onShowCode: () => showCodePanel(row.id, row.problem),
        }),
    },
    {
      title: renderTableTitle("状态", "streamline-emojis:panda-face"),
      key: "status",
      minWidth: 140,
      render: (row) => h(SubmissionResultTag, { result: row.result }),
    },
    {
      title: renderTableTitle("题目", "streamline-emojis:blossom"),
      key: "problem",
      minWidth: 360,
      render: (row) => {
        const problem = h(
          ButtonWithSearch,
          {
            type: "题目",
            onClick: () => problemClicked(row),
            onSearch: () => (query.problem = row.problem),
          },
          () => `${row.problem} ${row.problemTitle}`,
        )
        // 从题单入口做出来的提交才有这个标记（后端只在提交时记来源），
        // 同一道题从普通题库刷的不会带。老提交里只有当年首次 AC 那条有
        const problemSet = row.problemSet
        if (!problemSet) return problem
        return h(NFlex, { align: "center", size: 8, wrap: false }, () => [
          problem,
          h(
            NTag,
            {
              size: "small",
              round: true,
              type: "info",
              bordered: false,
              style: { cursor: "pointer", flexShrink: 0 },
              onClick: () =>
                window.open("/problemset/" + problemSet.id, "_blank"),
            },
            () => "题单 " + problemSet.title,
          ),
        ])
      },
    },
    {
      title: renderTableTitle("语言", "streamline-ultimate-color:earth-pin-2"),
      key: "language",
      minWidth: 120,
      render: (row) => LANGUAGE_SHOW_VALUE[row.language],
    },
    {
      title: renderTableTitle(
        "用户",
        "streamline-emojis:smiling-face-with-sunglasses",
      ),
      key: "username",
      minWidth: 200,
      render: (row) =>
        h(
          ButtonWithSearch,
          {
            type: "用户",
            username: row.username,
            onClick: () => window.open("/user?name=" + row.username, "_blank"),
            onSearch: () => (query.username = row.username),
            onFilterClass: (classname: string) => (query.username = classname),
          },
          () => row.username,
        ),
    },
  ]
  if (!route.params.contestID && userStore.isTeacherOrAbove) {
    res.push({
      title: renderTableTitle("选项", "streamline-emojis:wrench"),
      key: "rejudge",
      render: (row) =>
        h(
          NButton,
          {
            quaternary: true,
            size: "small",
            type: "primary",
            onClick: () => rejudge(row.id),
          },
          () => "重新判题",
        ),
    })
  }
  return res
})

const flowchartColumns = computed(() => {
  const res: DataTableColumn<FlowchartSubmissionListItem>[] = [
    {
      title: renderTableTitle("提交时间", "fluent-emoji:seven-oclock"),
      key: "create_time",
      render: (row) => parseTime(row.createTime, "YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: renderTableTitle("提交编号", "fluent-emoji-flat:input-numbers"),
      key: "id",
      render: (row) =>
        h(FlowchartLink, {
          flowchart: row,
          onShowDetail: (id: string) => showScoreDetail(id),
        }),
    },
    {
      title: renderTableTitle("题目", "streamline-emojis:blossom"),
      key: "problem_title",
      render: (row) =>
        h(
          ButtonWithSearch,
          {
            type: "题目",
            onClick: () => problemClicked(row),
            onSearch: () => (query.problem = row.problem),
          },
          () => `${row.problem} ${row.problemTitle}`,
        ),
    },
    {
      title: renderTableTitle("状态", "fluent-emoji:hourglass-not-done"),
      key: "status",
      render: (row) => {
        const tag = FLOWCHART_STATUS_TAG[row.status]
        return h(
          NTag,
          { size: "small", round: true, type: tag?.type ?? "default" },
          () => tag?.text ?? "未知",
        )
      },
    },
    {
      title: renderTableTitle(
        "评分",
        "streamline-ultimate-color:analytics-bars-3d",
      ),
      key: "ai_score",
      // 只有评完的才有分数。没评完也渲染 Grade 的话会显示成 0 分，
      // 看着像「评了但得了 0 分」
      render: (row) =>
        row.status === FlowchartSubmissionStatus.COMPLETED
          ? h(Grade, {
              score: row.aiScore ?? 0,
              grade: (row.aiGrade ?? "") as GradeValue,
            })
          : h(NText, { depth: 3 }, () => "—"),
    },
    {
      title: renderTableTitle(
        "用户",
        "streamline-emojis:smiling-face-with-sunglasses",
      ),
      key: "username",
      minWidth: 200,
      render: (row) =>
        h(
          ButtonWithSearch,
          {
            type: "用户",
            username: row.username,
            onClick: () => window.open("/user?name=" + row.username, "_blank"),
            onSearch: () => (query.username = row.username),
            onFilterClass: (classname: string) => (query.username = classname),
          },
          () => row.username,
        ),
    },
  ]
  if (!route.params.contestID && userStore.isTeacherOrAbove) {
    res.push({
      title: renderTableTitle("选项", "streamline-emojis:wrench"),
      key: "retry",
      // 后端只接受已完成 / 已失败的重判（其余返回 409），这里同步置灰，
      // 免得老师点了才发现不行
      render: (row) =>
        h(
          NButton,
          {
            quaternary: true,
            size: "small",
            type: "primary",
            disabled:
              row.status !== FlowchartSubmissionStatus.COMPLETED &&
              row.status !== FlowchartSubmissionStatus.FAILED,
            onClick: () => retryFlowchart(row.id),
          },
          () => "重新判题",
        ),
    })
  }
  return res
})
</script>
<template>
  <n-flex vertical size="large">
    <n-space>
      <n-form :show-feedback="false" inline label-placement="left">
        <n-form-item v-if="isDesktop && userStore.isAuthed" label="只看自己">
          <n-switch
            v-model:value="query.myself"
            checked-value="1"
            unchecked-value="0"
          />
        </n-form-item>
        <n-form-item label="语言" v-if="route.name !== 'contest submissions'">
          <n-select
            class="select"
            v-model:value="query.language"
            :options="languageOptions"
          />
        </n-form-item>
        <n-form-item :label="query.language === 'Flowchart' ? '等级' : '状态'">
          <n-select
            class="select"
            v-model:value="query.result"
            :options="
              query.language === 'Flowchart' ? gradeOptions : resultOptions
            "
          />
        </n-form-item>
      </n-form>
      <n-form :show-feedback="false" inline label-placement="left">
        <n-form-item>
          <n-input
            :disabled="query.myself === '1'"
            style="width: 140px"
            clearable
            v-model:value="query.username"
            placeholder="用户"
          />
        </n-form-item>
        <n-form-item>
          <n-input
            style="width: 120px"
            clearable
            v-model:value="query.problem"
            placeholder="题号"
          />
        </n-form-item>
      </n-form>
      <n-form :show-feedback="false" inline label-placement="left">
        <n-form-item v-if="isMobile && userStore.isAuthed" label="只看自己">
          <n-switch
            v-model:value="query.myself"
            checked-value="1"
            unchecked-value="0"
          />
        </n-form-item>
        <n-form-item>
          <n-button @click="search(query.username, query.problem)">
            搜索
          </n-button>
        </n-form-item>
        <n-form-item>
          <n-button @click="clear" quaternary>重置</n-button>
        </n-form-item>
        <n-form-item
          v-if="userStore.isTeacherOrAbove && route.name === 'submissions'"
        >
          <n-button
            quaternary
            type="warning"
            @click="toggleStatisticPanel(true)"
          >
            数据统计
          </n-button>
        </n-form-item>
      </n-form>
      <n-tag
        v-if="todayCount > 0"
        checkable
        :checked="query.today === '1'"
        type="success"
        size="large"
        @update:checked="(v: boolean) => (query.today = v ? '1' : '0')"
      >
        <n-gradient-text v-if="query.today !== '1'" type="success">
          今日提交数：{{ todayCount }}
        </n-gradient-text>
        <template v-else>今日提交数：{{ todayCount }}</template>
      </n-tag>
    </n-space>
    <n-data-table
      v-if="query.language === 'Flowchart'"
      :bordered="false"
      :columns="flowchartColumns"
      :data="flowcharts"
      :loading="showLoading"
    />
    <n-data-table
      v-else
      :bordered="false"
      :columns="columns"
      :data="submissions"
      :loading="showLoading"
    />
  </n-flex>
  <Pagination
    :total="total"
    v-model:limit="query.limit"
    v-model:page="query.page"
  />
  <n-modal
    v-if="userStore.isTeacherOrAbove"
    v-model:show="statisticPanel"
    preset="card"
    :style="{ maxWidth: isDesktop && '800px', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
    :title="
      query.language === 'Flowchart' ? '流程图提交的统计' : '提交记录的统计'
    "
  >
    <FlowchartStatisticsPanel
      v-if="query.language === 'Flowchart'"
      :problem="query.problem"
      :username="query.username"
    />
    <StatisticsPanel
      v-else
      :problem="query.problem"
      :username="query.username"
    />
  </n-modal>
  <n-modal
    v-model:show="codePanel"
    preset="card"
    :style="{ maxWidth: isDesktop && '70vw', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
    title="代码详情"
  >
    <SubmissionDetail
      :problemID="problemDisplayID"
      :submissionID="submissionID"
      hideList
      @copied="toggleCodePanel(false)"
    />
  </n-modal>
  <n-modal
    v-model:show="scoreDetailPanel"
    preset="card"
    :style="{ maxWidth: isDesktop && '1000px', maxHeight: '80vh' }"
    :content-style="{ overflow: 'auto' }"
  >
    <template #header>
      <n-flex align="center">
        <n-text>流程图评分详情</n-text>
        <n-text
          v-if="selectedFlowchart"
          :type="getGradeType(selectedFlowchart.aiGrade ?? '')"
        >
          {{ selectedFlowchart.aiScore }}分 {{ selectedFlowchart.aiGrade }}级
        </n-text>
      </n-flex>
    </template>
    <FlowchartScoreDetail :submissionId="selectedFlowchartId" />
  </n-modal>
</template>
<style scoped>
.select {
  width: 120px;
}

.code {
  font-size: 20px;
  overflow: auto;
}

.flowchart-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
