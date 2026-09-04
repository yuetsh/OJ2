<script setup lang="ts">
import type {
  ClassComparison,
  ClassRankItem as ClassRank,
  ClassUserRank,
  MyRank,
  Rank,
} from "utils/types"
import { formatISO, sub, type Duration } from "date-fns"
import { NButton, NFlex } from "naive-ui"
import {
  getActivityRank,
  getClassRank,
  getRank,
  getUserClassRank,
  getClassPK,
} from "oj/api"
import { useBreakpoints } from "shared/composables/breakpoints"
import { getACRate } from "utils/functions"
import Pagination from "shared/components/Pagination.vue"
import { ChartType } from "utils/constants"
import { renderTableTitle } from "utils/renders"
import Chart from "./components/Chart.vue"
import Index from "./components/Index.vue"
import { useUserStore } from "shared/store/user"
import { Icon } from "@iconify/vue"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { aiStreamError, consumeJSONEventStream } from "utils/stream"

const gradeOptions = [
  { label: "25年级", value: 25 },
  { label: "24年级", value: 24 },
  { label: "23年级", value: 23 },
  { label: "22年级", value: 22 },
  { label: "21年级", value: 21 },
  { label: "20年级", value: 20 },
]

const router = useRouter()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()
const data = ref<Rank[]>([])
const total = ref(0)
/** 我的全服名次；未登录、教师/超管不入榜时为 null */
const me = ref<MyRank | null>(null)
/** 我在前 100 名之外 —— 榜上高亮不到我，另起一行显示 */
const meOffBoard = computed(() => !!me.value && me.value.rank > total.value)
const query = reactive({
  limit: 10,
  page: 1,
})
const message = useMessage()
const rankChart = ref<Rank[]>([])
const activityChart = ref<Rank[]>([])
const duration = ref("months:1")
const classData = ref<ClassRank[]>([])
const classQuery = reactive({
  grade: gradeOptions[0].value,
})
const myClassData = ref<ClassUserRank["ranks"]>([])
const myRank = ref(-1)
const myClassName = ref("")
const myClassScope = ref<"window" | "all">("window")
const myClassTotal = ref(0)
const myClassQuery = reactive({
  page: 1,
  limit: 10,
})

const showClassDetailModal = ref(false)
const classDetailData = ref<ClassComparison | null>(null)
const classDetailLoading = ref(false)

const classDetailAiLoading = ref(false)
const classDetailAiContent = ref("")
const showClassDetailAiModal = ref(false)
let classDetailAiController: AbortController | null = null

async function loadClassDetail(className: string) {
  showClassDetailModal.value = true
  classDetailLoading.value = true
  classDetailData.value = null
  try {
    const res = await getClassPK([className])
    classDetailData.value = res.comparisons[0] ?? null
  } catch {
    // ignore
  } finally {
    classDetailLoading.value = false
  }
}

async function analyzeSingleClassWithAI() {
  if (!classDetailData.value) return
  if (classDetailAiController) classDetailAiController.abort()
  const controller = new AbortController()
  classDetailAiController = controller

  showClassDetailModal.value = false
  showClassDetailAiModal.value = true
  classDetailAiContent.value = ""
  classDetailAiLoading.value = true

  try {
    const response = await fetch("/api/ai/class-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comparison: classDetailData.value }),
      signal: controller.signal,
    })
    if (!response.ok) throw await aiStreamError(response)

    let hasStarted = false
    await consumeJSONEventStream(response, {
      signal: controller.signal,
      onEvent(event) {
        if (event === "end" && !hasStarted) classDetailAiLoading.value = false
      },
      onMessage(payload) {
        const parsed = payload as {
          type?: string
          content?: string
          message?: string
        }
        if (parsed.type === "delta" && parsed.content) {
          if (!hasStarted) {
            hasStarted = true
            classDetailAiLoading.value = false
          }
          classDetailAiContent.value += parsed.content
        } else if (parsed.type === "error") {
          throw new Error(parsed.message || "AI 服务异常")
        } else if (parsed.type === "done" && !hasStarted) {
          classDetailAiLoading.value = false
        }
      },
    })
  } catch (error: any) {
    if (controller.signal.aborted) return
    message.error(error?.message || "AI 分析失败，请稍后再试")
    classDetailAiLoading.value = false
  } finally {
    if (classDetailAiController === controller) classDetailAiController = null
  }
}

async function init() {
  const offset = (query.page - 1) * query.limit
  const res = await getRank(offset, query.limit)
  data.value = res.results
  total.value = res.total
  me.value = res.me
  return res.results
}

function isMe(row: Rank) {
  return !!me.value && row.user.id === me.value.user.id
}

// 高亮我那一行。用 id 比对而不是用户名：用户名会重名到大小写差异上，id 不会
function rowClassName(row: Rank) {
  return isMe(row) ? "me-row" : ""
}

const columns: DataTableColumn<Rank>[] = [
  {
    title: renderTableTitle("排名", "streamline-emojis:flexed-biceps-1"),
    key: "index",
    width: 100,
    align: "center",
    render: (_, index) =>
      h(Index, { index, page: query.page, limit: query.limit }),
  },
  {
    title: renderTableTitle(
      "用户",
      "streamline-emojis:smiling-face-with-sunglasses",
    ),
    key: "username",
    width: 240,
    render: (row) =>
      h("div", { style: "display:flex;align-items:center;gap:6px" }, [
        h(
          NButton,
          {
            text: true,
            type: "info",
            onClick: () => router.push("/user?name=" + row.user.username),
          },
          () => row.user.username,
        ),
        isMe(row)
          ? h(Icon, { width: 20, icon: "fluent-emoji:person-raising-hand" })
          : null,
        h(
          NButton,
          {
            text: true,
            size: "tiny",
            title: "查看成就",
            onClick: () =>
              router.push("/achievement?name=" + row.user.username),
          },
          () => "🏆",
        ),
      ]),
  },
  {
    title: renderTableTitle(
      "个性签名",
      "streamline-emojis:no-one-under-eighteen",
    ),
    key: "mood",
    minWidth: 200,
  },
  {
    title: renderTableTitle("已解决", "streamline-emojis:raised-fist-1"),
    key: "acceptedNumber",
    width: 120,
    align: "center",
  },
  {
    title: renderTableTitle(
      "提交数",
      "streamline-ultimate-color:space-rocket-earth",
    ),
    key: "submissionNumber",
    width: 120,
    align: "center",
  },
  {
    title: renderTableTitle("正确率", "streamline-ultimate-color:gift-box-1"),
    key: "rate",
    width: 120,
    align: "center",
    render: (row) => getACRate(row.acceptedNumber, row.submissionNumber),
  },
]

watch(() => query.page, init)
// 改每页条数时，若当前不在第一页，把重新取数交给 page 的 watcher ——
// 这里再自己取一次，就是两个一模一样的请求
watch(
  () => query.limit,
  () => {
    if (query.page === 1) init()
    else query.page = 1
  },
)
watch(duration, listActivity)

async function listActivity() {
  const current = Date.now()
  const start = formatISO(sub(current, subOptions.value))
  const res = await getActivityRank(start)
  // 活动榜只有「用户名 + 做题数」，塞进榜单图表复用的 Rank 形状里
  activityChart.value = res.map((d, index) => ({
    id: index,
    user: { id: index, username: d.username, realName: null },
    acceptedNumber: d.count,
    submissionNumber: 0,
    mood: null,
  }))
}

const options: SelectOption[] = [
  { label: "一周内", value: "weeks:1" },
  { label: "一个月内", value: "months:1" },
  { label: "两个月内", value: "months:2" },
  { label: "半年内", value: "months:6" },
  { label: "一年内", value: "years:1" },
]

const subOptions = computed<Duration>(() => {
  let dur = options.find((it) => it.value === duration.value) ?? options[1]
  const x = dur.value!.toString().split(":")
  const unit = x[0]
  const n = x[1]
  return { [unit]: parseInt(n) }
})

onMounted(() => {
  // 「全服 Top10」就是榜单第一页的前 10 条：挂载时 init() 取的正是 offset=0&limit=10，
  // 再单发一次一模一样的 /rankings/users 只会让这张图排在日活后面出来。
  // 图只在挂载时定一次，翻页/改每页条数不该动它。
  init().then((results) => (rankChart.value = results.slice(0, 10)))
  listActivity()
  listClassRank()
  listMyClassRank()
})

const classColumns: DataTableColumn<ClassRank>[] = [
  {
    title: "排名",
    key: "rank",
    width: 60,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "班级",
    key: "class_name",
    render: (row) =>
      `${row.className.slice(0, 2)}计算机${row.className.slice(2)}班`,
    minWidth: 120,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "人数",
    key: "userCount",
    width: 80,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "总AC数",
    key: "totalAc",
    width: 90,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "提交数",
    key: "totalSubmission",
    width: 90,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "平均AC数",
    key: "avgAc",
    width: 100,
    titleAlign: "center",
    align: "center",
  },
  {
    title: "正确率",
    key: "ac_rate",
    width: 90,
    titleAlign: "center",
    align: "center",
    render: (row) => `${row.acRate}%`,
  },
  {
    title: "详情",
    key: "action",
    width: 70,
    titleAlign: "center",
    align: "center",
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: "info",
          onClick: () => loadClassDetail(row.className),
        },
        () => "查看",
      ),
  },
]

const myClassColumns: DataTableColumn<ClassUserRank["ranks"][number]>[] = [
  {
    title: "排名",
    key: "rank",
    width: 100,
    align: "center",
  },
  {
    title: "用户名",
    key: "username",
    width: 240,
    render: (row) =>
      h("div", { style: "display:flex;align-items:center;gap:6px" }, [
        h(
          NButton,
          {
            text: true,
            type: "info",
            onClick: () => router.push("/user?name=" + row.username),
          },
          () =>
            row.rank === myRank.value
              ? h(
                  NFlex,
                  { align: "flex-end" },
                  {
                    default: () => [
                      h("span", {}, row.username),
                      h(Icon, {
                        width: 20,
                        icon: "fluent-emoji:person-raising-hand",
                      }),
                    ],
                  },
                )
              : row.username,
        ),
        h(
          NButton,
          {
            text: true,
            size: "tiny",
            title: "查看成就",
            onClick: () => router.push("/achievement?name=" + row.username),
          },
          () => "🏆",
        ),
      ]),
  },
  {
    title: "已解决",
    key: "acceptedNumber",
    width: 120,
    align: "center",
  },
  {
    title: "提交数",
    key: "submissionNumber",
    width: 120,
    align: "center",
  },
]

async function listClassRank() {
  if (!userStore.user) {
    await userStore.getMyProfile()
  }
  const className = userStore.user?.className
  if (className) {
    classQuery.grade = parseInt(className.slice(0, 2))
  }
  const res = await getClassRank(classQuery.grade)
  classData.value = res
}

async function listMyClassRank() {
  try {
    const offset =
      myClassScope.value === "all"
        ? (myClassQuery.page - 1) * myClassQuery.limit
        : 0
    const limit = myClassScope.value === "all" ? myClassQuery.limit : undefined
    const res = await getUserClassRank(myClassScope.value, offset, limit)
    myRank.value = res.myRank
    myClassName.value = res.className
    myClassData.value = res.ranks
    myClassTotal.value = res.total ?? res.ranks.length
    if (myClassScope.value === "window") {
      myClassQuery.page = 1
    }
  } catch (err: any) {
    console.error(err)
  }
}

watch(
  () => classQuery.grade,
  () => {
    listClassRank()
  },
)

watch(myClassScope, listMyClassRank)

watch(
  () => myClassQuery.page,
  () => {
    if (myClassScope.value === "all") {
      listMyClassRank()
    }
  },
)

// 同上：page 改了自会触发下面那个 watcher，别重复取
watch(
  () => myClassQuery.limit,
  () => {
    if (myClassQuery.page !== 1) myClassQuery.page = 1
    else if (myClassScope.value === "all") listMyClassRank()
  },
)
</script>

<template>
  <n-flex vertical size="large">
    <n-grid :cols="isDesktop ? 2 : 1" :x-gap="20" :y-gap="20">
      <n-gi :span="1">
        <n-card>
          <template #header>
            <div style="height: 34px">全服 Top10</div>
          </template>
          <Chart
            v-if="rankChart.length"
            :type="ChartType.Rank"
            :rank-data="rankChart"
          />
          <n-empty v-else style="padding: 20px 0"></n-empty>
        </n-card>
      </n-gi>
      <n-gi :span="1">
        <n-card>
          <template #header>日活 Top10</template>
          <template #header-extra>
            <n-select
              style="width: 120px"
              :options="options"
              v-model:value="duration"
            />
          </template>
          <Chart
            v-if="activityChart.length"
            :type="ChartType.Activity"
            :rank-data="activityChart"
          />
          <n-empty v-else style="padding: 20px 0"></n-empty>
        </n-card>
      </n-gi>
    </n-grid>
    <n-card>
      <template #header>全服 Top100</template>
      <n-data-table
        :data="data"
        :columns="columns"
        :row-class-name="rowClassName"
      />
      <template #footer>
        <n-flex align="center" justify="space-between" :wrap="false">
          <!-- 前 100 名之外的学生榜上找不到自己，这里单独给一行 -->
          <n-tag v-if="meOffBoard" type="info" round :bordered="false">
            <template #icon>
              <Icon width="18" icon="fluent-emoji:person-raising-hand" />
            </template>
            我的排名：第 {{ me!.rank }} 名 · 已解决 {{ me!.acceptedNumber }} ·
            提交 {{ me!.submissionNumber }} · 正确率
            {{ getACRate(me!.acceptedNumber, me!.submissionNumber) }}
          </n-tag>
          <span v-else />
          <Pagination
            :total="total"
            v-model:page="query.page"
            v-model:limit="query.limit"
          />
        </n-flex>
      </template>
    </n-card>
    <n-grid :cols="isDesktop ? 2 : 1" :x-gap="20" :y-gap="20">
      <n-gi :span="1">
        <n-card>
          <template #header>
            <n-flex align="center">
              <span>班级排名</span>
              <n-button
                type="primary"
                secondary
                @click="router.push('/class')"
                v-if="userStore.isAdminRole"
              >
                班级PK
              </n-button>
            </n-flex>
          </template>
          <template #header-extra>
            <n-select
              v-model:value="classQuery.grade"
              placeholder="选择年级"
              clearable
              style="width: 180px"
              :options="gradeOptions"
            />
          </template>
          <n-data-table :data="classData" :columns="classColumns" />
        </n-card>
      </n-gi>
      <n-gi :span="1">
        <n-card>
          <template #header>我在班级的排名</template>
          <template #header-extra>
            <n-select
              style="width: 180px"
              :options="[
                { label: '我的位置', value: 'window' },
                { label: '全班排名', value: 'all' },
              ]"
              v-model:value="myClassScope"
            />
          </template>
          <n-data-table :data="myClassData" :columns="myClassColumns" />
          <template #footer v-if="myClassScope === 'all'">
            <Pagination
              :total="myClassTotal"
              v-model:page="myClassQuery.page"
              v-model:limit="myClassQuery.limit"
            />
          </template>
        </n-card>
      </n-gi>
    </n-grid>
  </n-flex>

  <n-modal
    v-model:show="showClassDetailModal"
    preset="card"
    :title="
      classDetailData
        ? `${classDetailData.className.slice(0, 2)}计算机${classDetailData.className.slice(2)}班`
        : '班级详情'
    "
    :style="{ width: '700px', maxWidth: '95vw' }"
  >
    <n-spin :show="classDetailLoading" style="min-height: 200px">
      <n-flex v-if="classDetailData" vertical :size="12">
        <n-grid :cols="5" :x-gap="8" responsive="screen">
          <n-gi>
            <n-statistic
              label="总AC数"
              :value="classDetailData.totalAc"
              size="large"
              class="stat-total-ac"
            >
              <template #suffix>
                <Icon icon="streamline-emojis:raised-fist-1" width="20" />
              </template>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic
              label="平均AC数"
              :value="classDetailData.avgAc.toFixed(2)"
              size="large"
              class="stat-avg-ac"
            >
              <template #suffix>
                <Icon
                  icon="streamline-ultimate-color:analytics-pie-2"
                  width="20"
                />
              </template>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic
              label="中位数AC数"
              :value="classDetailData.medianAc.toFixed(2)"
              size="large"
              class="stat-median-ac"
            >
              <template #suffix>
                <Icon
                  icon="streamline-ultimate-color:cursor-target-1"
                  width="20"
                />
              </template>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic
              label="总提交数"
              :value="classDetailData.totalSubmission"
              size="large"
              class="stat-total-submission"
            >
              <template #suffix>
                <Icon
                  icon="streamline-ultimate-color:common-file-text"
                  width="20"
                />
              </template>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic
              label="AC率"
              :value="classDetailData.acRate.toFixed(1) + '%'"
              size="large"
              class="stat-ac-rate"
            >
              <template #suffix>
                <Icon icon="fluent-emoji:check-mark-button" width="20" />
              </template>
            </n-statistic>
          </n-gi>
        </n-grid>

        <n-divider style="margin: 12px 0" />

        <n-descriptions
          bordered
          :column="2"
          size="small"
          label-placement="left"
        >
          <n-descriptions-item label="第一四分位数(Q1)">
            <span style="color: #9254de; font-weight: 500">{{
              classDetailData.q1Ac.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="第三四分位数(Q3)">
            <span style="color: #f759ab; font-weight: 500">{{
              classDetailData.q3Ac.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="四分位距(IQR)">
            <span style="color: #13c2c2; font-weight: 500">{{
              classDetailData.iqr.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="标准差">
            <span style="color: #fa8c16; font-weight: 500">{{
              classDetailData.stdDev.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="前10%均值">
            <span style="color: #cf1322; font-weight: 600">{{
              classDetailData.top10Avg.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="中间80%均值">
            <span style="color: #389e0d; font-weight: 600">{{
              classDetailData.middle80Avg.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="后10%均值">
            <span style="color: #096dd9; font-weight: 500">{{
              classDetailData.bottom10Avg.toFixed(2)
            }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="人数">
            <span style="color: #1890ff; font-weight: 600">{{
              classDetailData.userCount
            }}</span>
          </n-descriptions-item>
        </n-descriptions>

        <n-card size="small" title="比率统计" embedded style="margin-top: 12px">
          <n-space vertical :size="10">
            <n-progress
              type="line"
              :percentage="classDetailData.excellentRate"
              :show-indicator="true"
              :border-radius="4"
            >
              <template #default
                >优秀率:
                {{ classDetailData.excellentRate.toFixed(1) }}%</template
              >
            </n-progress>
            <n-progress
              type="line"
              :percentage="classDetailData.passRate"
              :show-indicator="true"
              :border-radius="4"
              status="success"
            >
              <template #default
                >及格率: {{ classDetailData.passRate.toFixed(1) }}%</template
              >
            </n-progress>
            <n-progress
              type="line"
              :percentage="classDetailData.activeRate"
              :show-indicator="true"
              :border-radius="4"
              status="info"
            >
              <template #default
                >参与度: {{ classDetailData.activeRate.toFixed(1) }}%</template
              >
            </n-progress>
          </n-space>
        </n-card>

        <n-flex
          justify="center"
          align="center"
          :size="12"
          style="margin-top: 12px"
        >
          <n-tag type="success" size="large">
            综合分: {{ classDetailData.compositeScore.toFixed(1) }}
          </n-tag>
          <n-button
            type="info"
            :loading="classDetailAiLoading"
            @click="analyzeSingleClassWithAI"
          >
            <template #icon>
              <Icon icon="ph:sparkle" />
            </template>
            AI分析
          </n-button>
        </n-flex>
      </n-flex>
      <n-empty
        v-else-if="!classDetailLoading"
        description="暂无数据"
        style="padding: 40px 0"
      />
    </n-spin>
  </n-modal>

  <n-modal
    v-model:show="showClassDetailAiModal"
    preset="card"
    title="AI 分析报告"
    :style="{ width: '800px', maxWidth: '95vw' }"
  >
    <n-spin :show="classDetailAiLoading" :delay="50">
      <div style="min-height: 200px">
        <MdPreview
          v-if="classDetailAiContent"
          :model-value="classDetailAiContent"
        />
        <n-flex
          v-else-if="!classDetailAiLoading"
          align="center"
          justify="center"
          style="min-height: 200px"
        >
          <n-empty description="暂无分析内容" />
        </n-flex>
      </div>
    </n-spin>
  </n-modal>
</template>

<style scoped>
:deep(.me-row > td) {
  background-color: rgba(24, 160, 88, 0.12) !important;
}

.stat-total-ac :deep(.n-statistic-value),
.stat-total-ac :deep(.n-statistic-value__content),
.stat-total-ac :deep(.n-number-animation),
.stat-total-ac :deep(.n-statistic-value > *),
.stat-total-ac :deep(.n-statistic-value span) {
  color: #ff4d4f !important;
  font-weight: 600;
}

.stat-avg-ac :deep(.n-statistic-value),
.stat-avg-ac :deep(.n-statistic-value__content),
.stat-avg-ac :deep(.n-number-animation),
.stat-avg-ac :deep(.n-statistic-value > *),
.stat-avg-ac :deep(.n-statistic-value span) {
  color: #52c41a !important;
  font-weight: 600;
}

.stat-median-ac :deep(.n-statistic-value),
.stat-median-ac :deep(.n-statistic-value__content),
.stat-median-ac :deep(.n-number-animation),
.stat-median-ac :deep(.n-statistic-value > *),
.stat-median-ac :deep(.n-statistic-value span) {
  color: #fa8c16 !important;
  font-weight: 600;
}

.stat-total-submission :deep(.n-statistic-value),
.stat-total-submission :deep(.n-statistic-value__content),
.stat-total-submission :deep(.n-number-animation),
.stat-total-submission :deep(.n-statistic-value > *),
.stat-total-submission :deep(.n-statistic-value span) {
  color: #805ad5 !important;
  font-weight: 600;
}

.stat-ac-rate :deep(.n-statistic-value),
.stat-ac-rate :deep(.n-statistic-value__content),
.stat-ac-rate :deep(.n-number-animation),
.stat-ac-rate :deep(.n-statistic-value > *),
.stat-ac-rate :deep(.n-statistic-value span) {
  color: #00b894 !important;
  font-weight: 600;
}
</style>
