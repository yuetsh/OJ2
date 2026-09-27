<script setup lang="ts">
import { h, onMounted, reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { NButton } from "naive-ui"
import PageHeader from "admin/components/PageHeader.vue"
import Pagination from "shared/components/Pagination.vue"
import { useUserStore } from "shared/store/user"
import { getACRate } from "utils/functions"
import type { Rank } from "utils/types"
import { getAdminUserRank, getBaseInfo, randomUser10 } from "../api"

const userCount = ref(0)
const submissionCount = ref(0)
const contestCount = ref(0)
const judgeServerCount = ref(0)
const userStore = useUserStore()
const router = useRouter()
const showModal = ref(false)
const luckyGuy = ref("")
const isRolling = ref(false)
const rollingNames = ref<string[]>([])
const pulseKey = ref(0)
let rollingTimer: ReturnType<typeof setInterval> | null = null
let rollingStopper: ReturnType<typeof setTimeout> | null = null
const data = ref<Rank[]>([])
const total = ref(0)
const query = reactive({
  limit: 10,
  page: 1,
  classroom: "",
})

const columns: DataTableColumn<Rank>[] = [
  {
    title: "排名",
    key: "index",
    width: 80,
    align: "center",
    render: (_, index) => index + (query.page - 1) * query.limit + 1,
  },
  {
    title: "用户",
    key: "username",
    width: 200,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: "info",
          onClick: () => router.push("/user?name=" + row.user.username),
        },
        () => row.user.username,
      ),
  },
  { title: "个性签名", key: "mood" },
  { title: "已解决", key: "acceptedNumber", width: 100 },
  { title: "提交数", key: "submissionNumber", width: 100 },
  {
    title: "正确率",
    key: "rate",
    width: 100,
    render: (row) => getACRate(row.acceptedNumber, row.submissionNumber),
  },
]

onMounted(async () => {
  const res = await getBaseInfo()
  userCount.value = res.userCount
  submissionCount.value = res.todaySubmissionCount
  contestCount.value = res.recentContestCount
  judgeServerCount.value = res.judgeServerCount
})

async function listRanks() {
  const offset = (query.page - 1) * query.limit
  const res = await getAdminUserRank(offset, query.limit, query.classroom)
  data.value = res.results
  total.value = res.total
}

function stopRolling() {
  if (rollingTimer) {
    clearInterval(rollingTimer)
    rollingTimer = null
  }
  if (rollingStopper) {
    clearTimeout(rollingStopper)
    rollingStopper = null
  }
  isRolling.value = false
}

function startRolling(finalName: string) {
  stopRolling()
  if (!rollingNames.value.length) return
  isRolling.value = true
  const interval = 80
  const duration = 2000
  let index = 0
  rollingTimer = setInterval(() => {
    luckyGuy.value = rollingNames.value[index % rollingNames.value.length]
    index += 1
  }, interval)
  rollingStopper = setTimeout(() => {
    stopRolling()
    luckyGuy.value = finalName
    pulseKey.value += 1
  }, duration)
}

async function getRandom() {
  const res = await randomUser10(query.classroom)
  const names = (res as string[]).map((name) => name.split(query.classroom)[1])
  rollingNames.value = names
  const finalName = names[names.length - 1]
  startRolling(finalName)
}

async function getRandomModal() {
  showModal.value = true
  stopRolling()
  luckyGuy.value = ""
}

watch(() => query.page, listRanks)
watch(
  () => query.limit,
  () => {
    query.page = 1
    listRanks()
  },
)

watch(
  () => query.classroom,
  (v) => {
    query.page = 1
    if (!v) {
      data.value = []
      total.value = 0
    }
  },
)

watch(showModal, (v) => {
  if (!v) {
    stopRolling()
    luckyGuy.value = ""
  }
})
</script>

<template>
  <PageHeader :title="`你好，${userStore.user?.username ?? '管理员'}`">
    <template #actions>
      <n-button @click="router.push('/admin/contest/create')">新建比赛</n-button>
      <n-button type="primary" @click="router.push('/admin/problem/create')">新建题目</n-button>
    </template>
  </PageHeader>

  <n-grid cols="2 m:4" :x-gap="12" :y-gap="12" responsive="screen" class="stats">
    <n-gi>
      <n-card size="small"><n-statistic label="总用户数" :value="userCount" /></n-card>
    </n-gi>
    <n-gi>
      <n-card size="small"><n-statistic label="今日提交" :value="submissionCount" /></n-card>
    </n-gi>
    <n-gi>
      <n-card size="small"><n-statistic label="近期比赛" :value="contestCount" /></n-card>
    </n-gi>
    <n-gi>
      <!-- 判题机数量后端一直在下发，这里以前没显示 —— 判题机全掉线的时候，
           这一栏是 0，比学生喊「交了没反应」早得多 -->
      <n-card size="small">
        <n-statistic label="在线判题机">
          <n-text :type="judgeServerCount > 0 ? 'success' : 'error'">
            {{ judgeServerCount }}
          </n-text>
        </n-statistic>
      </n-card>
    </n-gi>
  </n-grid>

  <n-card size="small" title="班级排名">
    <template #header-extra>
      <n-flex align="center" :size="8">
        <n-input
          style="width: 160px"
          clearable
          v-model:value="query.classroom"
          placeholder="班级前缀"
          @keyup.enter="listRanks"
        />
        <n-button secondary type="primary" @click="listRanks">查询</n-button>
        <n-button v-if="query.classroom" @click="getRandomModal">随机抽签</n-button>
      </n-flex>
    </template>
    <template v-if="data.length">
      <n-data-table striped :data="data" :columns="columns" />
      <Pagination :total="total" v-model:page="query.page" v-model:limit="query.limit" />
    </template>
    <n-empty v-else description="输入班级前缀后查询" style="padding: 24px 0" />
  </n-card>
  <n-modal preset="card" title="猜猜看幸运儿是谁？" v-model:show="showModal" style="width: 400px">
    <n-flex vertical justify="center" align="center">
      <n-h1 :key="pulseKey" class="lucky pulse">{{ luckyGuy }}</n-h1>
      <n-button block :disabled="isRolling" @click="getRandom">
        {{ luckyGuy ? "再来一次" : "开始抽签" }}
      </n-button>
    </n-flex>
  </n-modal>
</template>

<style scoped>
.stats {
  margin-bottom: 16px;
}

.lucky {
  height: 48px;
}

.pulse {
  animation: lucky-pulse 0.6s ease-out;
}

@keyframes lucky-pulse {
  0% {
    transform: scale(0.9);
  }
  60% {
    transform: scale(1.18);
  }
  100% {
    transform: scale(1);
  }
}
</style>
