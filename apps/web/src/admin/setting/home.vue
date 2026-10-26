<script setup lang="ts">
import type { DashboardInfo } from '@oj2/contract'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'
import { useThemeVars } from 'naive-ui'
import { Bar } from 'vue-chartjs'
import { useChartTheme } from 'shared/composables/chartTheme'
import { rgba } from 'shared/composables/tone'
import PageHeader from 'admin/components/PageHeader.vue'
import { classLabel, groupClassOptions } from 'utils/classes'
import { useConfigStore } from 'shared/store/config'
import { useUserStore } from 'shared/store/user'
import { SubmissionStatus } from 'utils/constants'
import { getBaseInfo, randomUser10 } from '../api'

/**
 * 后台首页（设计稿「后台首页」AdminHome）：一块看板。上面一排看「现在」—— 判题机在不在、
 * 今天交了多少其中有没有系统错误、现在几个人在线、哪个班在上课；中间一排全站的数（用户、题目、
 * 提交、比赛、题单、自学、这周做题的人，用户要的「类似一个看板」）和最近 30 天每天交了几次；
 * 最下面是常用的四个入口和「抽一个人」。
 *
 * 原来是总用户数 / 今日提交 / 近期比赛 / 判题机四个数，加一张要手输班级前缀的班级排名表 ——
 * 总用户数、近期比赛没人看，排名前台排名页有（还更好看）。「随机抽签」上课点名用，留着，
 * 班级改成下拉选，默认就是正在上课的那个班
 */
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

const theme = useThemeVars()
const { chartKey } = useChartTheme()
const router = useRouter()
const userStore = useUserStore()
const configStore = useConfigStore()

const info = ref<DashboardInfo | null>(null)
onMounted(async () => {
  info.value = await getBaseInfo()
  if (!luckyClass.value && info.value.activeClass) luckyClass.value = info.value.activeClass
})

const siteTiles = computed(() => {
  const site = info.value?.site
  if (!site) return []
  const n = (value: number) => value.toLocaleString('zh-CN')
  return [
    { label: '学生', value: n(site.students), note: `老师 ${site.teachers} 人` },
    {
      label: '题目',
      value: n(site.problems),
      note: `学生看得到 ${n(site.visibleProblems)} 道`,
      to: '/admin/problem/list',
    },
    { label: '提交', value: n(site.submissions), note: `这学期 ${n(site.termSubmissions)} 次` },
    { label: '这周做题的人', value: n(site.weekActive), note: '周一起交过题的' },
    { label: '比赛', value: n(site.contests), note: '', to: '/admin/contest/list' },
    { label: '题单', value: n(site.problemSets), note: '', to: '/admin/problemset/list' },
    { label: '自学', value: n(site.tutorials), note: '课', to: '/admin/tutorial/list' },
  ]
})

/** 最近 30 天每天交了几次。今天那根用主色，其余淡一点 */
const dailyData = computed(() => {
  const daily = info.value?.daily ?? []
  return {
    labels: daily.map((d) => d.day.slice(5)),
    datasets: [
      {
        data: daily.map((d) => d.count),
        backgroundColor: daily.map((_, i) => (i === daily.length - 1 ? theme.value.primaryColor : rgba(theme.value.primaryColor, 0.4))),
        borderRadius: 3,
        maxBarThickness: 22,
      },
    ],
  }
})
const dailyOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: { label: (ctx: { parsed: { y: number | null } }) => `${ctx.parsed.y ?? 0} 次` },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } },
    y: { beginAtZero: true, ticks: { precision: 0 } },
  },
}

function openSystemErrors() {
  router.push({ name: 'submissions', query: { result: String(SubmissionStatus.system_error) } })
}

const shortcuts = [
  { label: '新建题目', to: '/admin/problem/create' },
  { label: '新建比赛', to: '/admin/contest/create' },
  { label: '批量建号', to: '/admin/user/generate' },
  { label: '课堂看板', to: '/classroom' },
]

// ---------------------------------------------------------------- 抽一个人

const classOptions = computed(() => groupClassOptions(configStore.config?.classList ?? []))
const luckyClass = ref<string | null>(null)
const luckyGuy = ref('')
const isRolling = ref(false)
const pulseKey = ref(0)
let rollingTimer: ReturnType<typeof setInterval> | null = null
let rollingStopper: ReturnType<typeof setTimeout> | null = null

function stopRolling() {
  if (rollingTimer) clearInterval(rollingTimer)
  if (rollingStopper) clearTimeout(rollingStopper)
  rollingTimer = null
  rollingStopper = null
  isRolling.value = false
}

/** 名字滚两秒停下：接口一次给 10 个随机的，最后一个就是抽中的 */
async function draw() {
  if (!luckyClass.value) return
  const prefix = `ks${luckyClass.value}`
  const names = (await randomUser10(prefix)).map((name) => name.slice(prefix.length) || name)
  if (!names.length) {
    luckyGuy.value = '这个班没有人'
    return
  }
  stopRolling()
  isRolling.value = true
  let index = 0
  rollingTimer = setInterval(() => {
    luckyGuy.value = names[index % names.length]!
    index += 1
  }, 80)
  rollingStopper = setTimeout(() => {
    stopRolling()
    luckyGuy.value = names[names.length - 1]!
    pulseKey.value += 1
  }, 2000)
}

watch(luckyClass, () => {
  stopRolling()
  luckyGuy.value = ''
})
onUnmounted(stopRolling)
</script>

<template>
  <PageHeader :title="`你好，${userStore.user?.username ?? '管理员'}`" />

  <div v-if="info" class="tiles">
    <div class="tile">
      <span class="label">判题机</span>
      <b :class="info.judgeServerCount ? 'ok' : 'bad'">{{ info.judgeServerCount }} 台在线</b>
      <span v-if="!info.judgeServerCount" class="bad-note">学生交了会一直判不出来</span>
    </div>
    <div class="tile">
      <span class="label">今天提交</span>
      <b>{{ info.todaySubmissionCount }} 次</b>
      <button v-if="info.todaySystemErrorCount" type="button" class="link bad-note" @click="openSystemErrors">
        系统错误 {{ info.todaySystemErrorCount }} 次 →
      </button>
      <span v-else class="note">系统错误 0 次</span>
    </div>
    <div class="tile">
      <span class="label">现在在线</span>
      <b>{{ info.onlineCount }} 人</b>
      <span class="note">5 分钟内有动静的</span>
    </div>
    <div class="tile">
      <span class="label">正在上课</span>
      <b>{{ info.activeClass ? classLabel(info.activeClass) : '没有' }}</b>
      <router-link v-if="info.activeClass" class="link" :to="{ name: 'classroom board', query: { className: info.activeClass } }"> 去课堂看板 → </router-link>
      <span v-else class="note">最近两小时没有哪个班在交题</span>
    </div>
  </div>

  <div v-if="info" class="site">
    <component
      :is="tile.to ? 'router-link' : 'div'"
      v-for="tile in siteTiles"
      :key="tile.label"
      :to="tile.to"
      class="site-tile"
      :class="{ clickable: tile.to }"
    >
      <span class="label">{{ tile.label }}</span>
      <b>{{ tile.value }}</b>
      <span class="note">{{ tile.note }}</span>
    </component>
  </div>

  <div v-if="info" class="chart-card">
    <div class="chart-head">
      <b>最近 30 天每天交了几次</b>
    </div>
    <div class="chart">
      <Bar :key="chartKey" :data="dailyData" :options="dailyOptions" />
    </div>
  </div>

  <div class="shortcuts">
    <n-button v-for="it in shortcuts" :key="it.to" size="large" @click="router.push(it.to)">
      {{ it.label }}
    </n-button>
  </div>

  <div class="lucky">
    <b class="lucky-title">抽一个人</b>
    <n-select v-model:value="luckyClass" :options="classOptions" filterable placeholder="选班级" aria-label="班级" class="lucky-select" />
    <span :key="pulseKey" class="lucky-name" :class="{ pulse: !isRolling && luckyGuy }">
      {{ luckyGuy }}
    </span>
    <n-button type="primary" :disabled="!luckyClass || isRolling" @click="draw">
      {{ luckyGuy ? '再抽一个' : '抽' }}
    </n-button>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid v-bind('theme.dividerColor');
}

.label,
.note {
  font-size: 13px;
  color: v-bind('theme.textColor3');
}

.tile b {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}

.tile b.ok {
  color: v-bind('theme.successColor');
}

.tile b.bad,
.bad-note {
  color: v-bind('theme.errorColor');
}

.bad-note {
  font-size: 13px;
}

.link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  color: v-bind('theme.primaryColor');
  text-decoration: none;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}

.site {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.site-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: 10px;
  background: v-bind('theme.actionColor');
  color: inherit;
  text-decoration: none;
}

.site-tile b {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.site-tile.clickable:hover {
  background: v-bind('theme.hoverColor');
}

.chart-card {
  margin-bottom: 18px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid v-bind('theme.dividerColor');
}

.chart-head {
  margin-bottom: 8px;
  font-size: 15px;
}

.chart {
  height: 220px;
}

.shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.lucky {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid v-bind('theme.dividerColor');
}

.lucky-select {
  width: 160px;
}

.lucky-title {
  font-size: 15px;
}

.lucky-name {
  min-width: 120px;
  font-size: 26px;
  font-weight: 700;
  text-align: center;
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

@media (max-width: 900px) {
  .tiles,
  .site {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 手机上一行放不下：标题 + 选班一行，抽到的名字和按钮各占一整行 */
@media (max-width: 768px) {
  .lucky {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
  }

  .lucky-select {
    width: 100%;
  }

  .lucky-name,
  .lucky > .n-button {
    grid-column: 1 / -1;
  }
}
</style>
