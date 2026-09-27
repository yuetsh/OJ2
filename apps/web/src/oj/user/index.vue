<script setup lang="ts">
import KnowledgeMap from "./components/KnowledgeMap.vue"
import { Icon } from "@iconify/vue"
import { getProfile } from "shared/api"
import { durationToDays, parseTime } from "utils/functions"
import type { AchievementSummary, Profile } from "utils/types"
import { getAchievementSummary } from "oj/achievement/api"
import { getMetrics } from "../api"
import AchievementIcon from "shared/components/AchievementIcon.vue"
import { useUserStore } from "shared/store/user"

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * 在看自己的主页。知识点地图只在这时候挂：它不给别人看（见 KnowledgeMap.vue），
 * 后端 /me/knowledge 也只认当前登录的人。带 ?name= 看的是别人，除非名字就是自己。
 */
const isSelf = computed(() => {
  const name = route.query.name as string | undefined
  return !name || name === userStore.user?.username
})
const profile = ref<Profile | null>(null)
const problems = ref<string[]>([])
const firstSubmissionAt = ref("")
const latestSubmissionAt = ref("")
const toLatestAt = ref("")
const learnDuration = ref("")
const achievementSummary = ref<AchievementSummary | null>(null)
const [loading, toggle] = useToggle()
const [show, toggleShow] = useToggle(false)

const isDefaultAvatar = computed(() => profile.value?.avatar.endsWith("default.png") ?? true)

const problemsFlexRef = useTemplateRef<HTMLElement>("problemsFlexRef")
const itemsPerRow = ref(8)

function updateItemsPerRow() {
  if (!problemsFlexRef.value) return
  const buttons = problemsFlexRef.value.querySelectorAll("button")
  if (!buttons.length) return
  const firstTop = buttons[0].offsetTop
  let count = 0
  for (const btn of buttons) {
    if (btn.offsetTop === firstTop) count++
    else break
  }
  if (count > 0) itemsPerRow.value = count
}

useResizeObserver(problemsFlexRef, updateItemsPerRow)
watch(problems, async () => {
  await nextTick()
  updateItemsPerRow()
})

const visibleProblems = computed(() =>
  show.value ? problems.value : problems.value.slice(0, itemsPerRow.value * 3),
)

const hasMoreProblems = computed(() => problems.value.length > itemsPerRow.value * 3)

async function init() {
  toggle(true)
  try {
    const res = await getProfile(route.query.name as string)
    profile.value = res
    // 用户不存在时后端返回 null，后面的统计全都无从算起
    if (!res) return
    const acm = res.acmProblemsStatus.problems || {}
    const ac: string[] = []
    Object.keys(acm).forEach((id) => {
      if (acm[id]["status"] === 0) {
        ac.push(acm[id]["_id"])
      }
    })
    ac.sort()
    problems.value = ac

    if (res.submissionNumber > 0) {
      const metricsRes = await getMetrics(res.user.id)
      firstSubmissionAt.value = parseTime(metricsRes.first)
      latestSubmissionAt.value = parseTime(metricsRes.latest)
      toLatestAt.value = durationToDays(metricsRes.latest, metricsRes.now)
      learnDuration.value = `${metricsRes.activeDays} 天`
    }
  } finally {
    toggle(false)
  }
}

// 单独取，不塞进上面的 promises 数组：那里是按位置取 results[0]/[1] 的，
// 插一项进去会打乱既有索引。成就摘要取不到也不该影响整个个人主页
async function loadAchievementSummary() {
  try {
    const res = await getAchievementSummary((route.query.name as string) || undefined)
    achievementSummary.value = res
  } catch {
    achievementSummary.value = null
  }
}

// 六项一格一项、三列两行。日期比数字长得多，字号单独压小一档（.stat-value.date），
// 不然「2026年9月14日」会把格子撑破
const metrics = computed(() => {
  if (loading.value) return []
  return [
    {
      icon: "fluent-emoji:candy",
      title: profile.value?.acceptedNumber ?? 0,
      content: "已解决",
      animate: true,
    },
    {
      icon: "fluent-emoji:thinking-face",
      title: profile.value?.submissionNumber ?? 0,
      content: "总提交",
      animate: true,
    },
    {
      icon: "fluent-emoji:face-with-peeking-eye",
      title: learnDuration.value,
      content: "学习天数",
    },
    {
      icon: "fluent-emoji:cheese-wedge",
      title: toLatestAt.value,
      content: "距上次提交",
    },
    {
      icon: "fluent-emoji:dog-face",
      title: latestSubmissionAt.value,
      content: "最新一次提交时间",
      date: true,
    },
    {
      icon: "fluent-emoji:cat-with-wry-smile",
      title: firstSubmissionAt.value,
      content: "第一次提交时间",
      date: true,
    },
  ]
})

onMounted(() => {
  init()
  loadAchievementSummary()
})
</script>
<template>
  <n-flex class="wrapper" vertical justify="center" align="center" v-if="!loading && profile">
    <n-image
      :width="96"
      :height="96"
      :src="profile.avatar"
      :preview-disabled="isDefaultAvatar"
      object-fit="cover"
      :style="{
        borderRadius: '50%',
        overflow: 'hidden',
        cursor: isDefaultAvatar ? 'default' : 'pointer',
      }"
    />
    <h2>{{ profile.user.username }}</h2>
    <p class="desc">{{ profile.mood }}</p>
    <n-button
      v-if="userStore.isSuperAdmin"
      type="info"
      secondary
      @click="
        router.push({
          name: 'ai',
          query: { username: profile.user.username, duration: 'months:6' },
        })
      "
    >
      智能分析
    </n-button>
  </n-flex>

  <div v-if="profile && profile.submissionNumber > 0" class="wrapper">
    <div class="stats">
      <div v-for="item in metrics" :key="item.content" class="stat">
        <Icon :icon="item.icon" :width="28" />
        <div class="stat-value" :class="{ date: item.date }">
          <n-number-animation v-if="item.animate" :to="Number(item.title)" />
          <template v-else>{{ item.title }}</template>
        </div>
        <n-text depth="3" class="stat-label">{{ item.content }}</n-text>
      </div>
    </div>
  </div>

  <!-- 成就摘要 -->
  <n-card v-if="!loading && profile && achievementSummary" class="wrapper" hoverable>
    <n-flex align="center" justify="space-between">
      <n-flex align="center" :size="12">
        <span class="achievement-title">
          成就 {{ achievementSummary.unlocked }} /
          {{ achievementSummary.total }}
        </span>
        <n-tag size="small" type="info"> {{ achievementSummary.percent }}% </n-tag>
      </n-flex>
      <n-button
        text
        type="primary"
        @click="
          router.push({
            path: '/achievement',
            query: route.query.name ? { name: route.query.name } : {},
          })
        "
      >
        查看全部
      </n-button>
    </n-flex>
    <n-flex align="center" :size="10" class="achievement-recent">
      <n-text v-if="achievementSummary.recent.length" depth="3"> 最近获得 </n-text>
      <n-tooltip v-for="a in achievementSummary.recent" :key="a.id">
        <template #trigger>
          <span class="achievement-icon">
            <AchievementIcon :icon="a.icon" :size="24" />
          </span>
        </template>
        {{ a.name }}
      </n-tooltip>
      <n-text v-if="!achievementSummary.recent.length" depth="3"> 还没有获得成就 </n-text>
    </n-flex>
  </n-card>

  <KnowledgeMap v-if="!loading && profile && isSelf" />
  <n-descriptions v-if="!loading && profile" class="wrapper" bordered>
    <n-descriptions-item v-if="!!problems.length">
      <template #label>
        <n-flex justify="space-between" align="center">
          <span>已解决的题目</span>
          <n-button text type="primary" v-if="hasMoreProblems" @click="toggleShow(!show)">
            {{ show ? "隐藏全部" : "显示全部" }}
          </n-button>
        </n-flex>
      </template>
      <div ref="problemsFlexRef">
        <n-flex>
          <n-button v-for="id in visibleProblems" :key="id" @click="router.push('/problem/' + id)">
            {{ id }}
          </n-button>
        </n-flex>
      </div>
    </n-descriptions-item>
  </n-descriptions>
  <n-empty v-if="!loading && !profile" description="该用户不存在">
    <template #extra>
      <n-button @click="router.push('/')">返回主页</n-button>
    </template>
  </n-empty>
</template>
<style scoped>
.wrapper {
  max-width: 610px;
  margin: 16px auto 0;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 600px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 8px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.2);
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
}

.stat-value.date {
  font-size: 16px;
  padding: 3px 0;
  white-space: nowrap;
}

h2 {
  margin: 0;
  font-weight: normal;
}

.desc {
  margin: 0 auto;
  word-wrap: break-word;
  max-width: 100%;
}
.achievement-title {
  font-weight: 600;
}
.achievement-recent {
  margin-top: 10px;
}
.achievement-icon {
  display: inline-flex;
  align-items: center;
  font-size: 24px;
  cursor: default;
}
</style>
