<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { useTone } from "oj/submission/composables/tone"
import { ContestStatus } from "utils/constants"
import { parseTime, secondsToDuration } from "utils/functions"
import { useContestStore } from "../store/contest"
import ContestBadge from "./components/ContestBadge.vue"
import ContestInfo from "./components/ContestInfo.vue"

/**
 * 比赛页的外壳（设计稿「比赛重设计」）：一条顶栏 + 下面三个页之一。
 * 顶栏左边是状态、名字、类型，右边是倒计时和去别的页的按钮：
 * 学生只有「题目 / 我的提交 / 比赛信息」，排名从题目页右边的名次卡进；
 * 老师是一排页签「全班情况 · 排名 · 提交 · 题目」，出题人另有「比赛设置」
 */
const props = defineProps<{
  contestID: string
}>()
const contestStore = useContestStore()
const route = useRoute()
const message = useMessage()
const theme = useThemeVars()
const tone = useTone()
const success = computed(() => tone("success"))

const password = ref("")

async function check() {
  const error = await contestStore.checkPassword(props.contestID, password.value)
  if (error === "too-many-password-attempts") {
    message.error("密码错误次数太多，请 10 分钟后再试")
  } else if (!contestStore.access) {
    message.error("密码不对")
  }
}

watch(
  () => contestStore.contestStatus,
  (nv, ov) => {
    if (nv === ContestStatus.underway && ov == ContestStatus.not_started) {
      contestStore.init(props.contestID)
    }
  },
)

onMounted(() => {
  contestStore.init(props.contestID)
})

onBeforeUnmount(contestStore.clear)

const status = computed(() => contestStore.contestStatus)
const contest = computed(() => contestStore.contest)

const passwordFormVisible = computed(
  () => contestStore.isPrivate && !contestStore.access && !contestStore.isContestAdmin,
)
/** 学生在开始前进来：题目和榜都还拿不到，整页就是「几点开始、还有多久」 */
const waiting = computed(
  () =>
    status.value === ContestStatus.not_started &&
    !contestStore.isContestAdmin &&
    !passwordFormVisible.value,
)

const untilStart = computed(() => {
  if (!contest.value) return ""
  const seconds = Math.floor((Date.parse(contest.value.startTime) - contestStore.now) / 1000)
  if (seconds <= 0) return ""
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`
  return secondsToDuration(seconds)
})

const timeRange = computed(() => {
  if (!contest.value) return ""
  const start = parseTime(contest.value.startTime, "M月D日 HH:mm")
  const sameDay =
    parseTime(contest.value.startTime, "YYYY-MM-DD") ===
    parseTime(contest.value.endTime, "YYYY-MM-DD")
  const end = parseTime(contest.value.endTime, sameDay ? "HH:mm" : "M月D日 HH:mm")
  return `${start} – ${end}`
})

const routeName = computed(() => String(route.name ?? ""))
const teacherTabs = computed(() => [
  {
    name: "contest class",
    label: status.value === ContestStatus.finished ? "成绩" : "全班情况",
  },
  { name: "contest rank", label: "排名" },
  { name: "contest submissions", label: "提交" },
  { name: "contest problems", label: "题目" },
])
const to = (name: string) => ({ name, params: { contestID: props.contestID } })
</script>

<template>
  <div v-if="contest" class="contest-page">
    <header class="bar">
      <ContestBadge :status="status" />
      <h2 class="title">{{ contest.title }}</h2>
      <ContestBadge :tag="contest.tag" />
      <div class="spacer"></div>
      <span v-if="status === ContestStatus.underway" class="countdown">
        <span class="countdown-label">还剩</span>
        <span class="countdown-num">{{ contestStore.remaining }}</span>
      </span>
      <span v-else-if="status === ContestStatus.not_started" class="countdown">
        <span class="countdown-label">{{ parseTime(contest.startTime, "M月D日 HH:mm") }} 开始</span>
        <span v-if="untilStart" class="countdown-num small">还有 {{ untilStart }}</span>
      </span>
      <span v-else class="range">{{ timeRange }}</span>
      <template v-if="contestStore.canEnter">
        <i class="divider"></i>
        <nav v-if="contestStore.isTeacher" class="tabs" aria-label="比赛">
          <RouterLink
            v-for="tab in teacherTabs"
            :key="tab.name"
            :to="to(tab.name)"
            class="tab"
            :class="{ on: routeName === tab.name }"
            >{{ tab.label }}</RouterLink
          >
        </nav>
        <template v-else>
          <RouterLink v-if="routeName !== 'contest problems'" :to="to('contest problems')">
            <n-button>‹ 题目</n-button>
          </RouterLink>
          <RouterLink
            v-if="routeName !== 'contest submissions'"
            :to="{ ...to('contest submissions'), query: { myself: '1' } }"
          >
            <n-button>我的提交</n-button>
          </RouterLink>
        </template>
        <RouterLink
          v-if="contestStore.isContestAdmin"
          :to="{ name: 'admin contest edit', params: { contestID } }"
        >
          <n-button>比赛设置</n-button>
        </RouterLink>
      </template>
      <ContestInfo v-if="!contestStore.isTeacher" />
    </header>

    <div v-if="passwordFormVisible" class="gate">
      <b>这场比赛要输入密码才能进</b>
      <span class="gate-sub">密码问老师</span>
      <n-flex :wrap="false">
        <n-input
          v-model:value="password"
          name="ContestPassword"
          type="password"
          placeholder="比赛密码"
          style="width: 220px"
          @keyup.enter="password && check()"
        />
        <n-button type="primary" :disabled="!password" @click="check">进入</n-button>
      </n-flex>
    </div>
    <div v-else-if="waiting" class="gate">
      <b>比赛还没开始</b>
      <span class="gate-sub">
        {{ parseTime(contest.startTime, "M月D日 HH:mm") }} 开始，到时候题目会自己出来，不用刷新
      </span>
      <span v-if="untilStart" class="gate-count">{{ untilStart }}</span>
    </div>
    <div v-else class="body"><router-view></router-view></div>
  </div>
</template>

<style scoped>
.contest-page {
  display: flex;
  flex-direction: column;
  margin: -16px -16px 0;
}

.body {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

/* 1920 的屏上铺满的话，领奖台在最左、「你的成绩」在最右，榜单只占左半边。
   内容限宽 1400 居中；顶栏的分隔线照旧通栏，所以限宽用内边距做而不是 max-width */
.bar {
  min-height: 68px;
  box-sizing: border-box;
  padding: 12px max(var(--oj-pad-x), calc((100% - 1400px) / 2 + var(--oj-pad-x)));
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  min-width: 0;
}

.spacer {
  flex-grow: 1;
}

.countdown {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: v-bind("theme.warningColorPressed");
}

.countdown-label {
  font-size: var(--oj-fs-sec);
}

.countdown-num {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.countdown-num.small {
  font-size: 16px;
}

.range {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: v-bind("theme.dividerColor");
}

.tabs {
  display: flex;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.tab {
  height: var(--oj-ctrl-h);
  padding: 0 16px;
  display: flex;
  align-items: center;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor2");
  text-decoration: none;
}

.tab + .tab {
  border-left: 1px solid v-bind("theme.borderColor");
}

.tab.on {
  background: v-bind("success.background");
  color: v-bind("success.color");
  font-weight: 600;
}

.gate {
  padding: 80px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-size: 16px;
}

.gate-sub {
  font-size: 14px;
  color: v-bind("theme.textColor3");
}

.gate-count {
  font-size: 40px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.warningColorPressed");
}
</style>
