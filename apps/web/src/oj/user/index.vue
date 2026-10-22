<script setup lang="ts">
import type { ProfileOverview } from "@oj2/contract"
import { getProfileOverview } from "oj/api"
import { getProfile } from "shared/api"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useUserStore } from "shared/store/user"
import type { Profile } from "utils/types"
import AchievementCard from "./components/AchievementCard.vue"
import KnowledgeMap from "./components/KnowledgeMap.vue"
import ProfileCard from "./components/ProfileCard.vue"
import SolvedCard from "./components/SolvedCard.vue"
import VersusCard from "./components/VersusCard.vue"

/**
 * 个人主页（设计稿「我的主页与设置」定稿）。排名、提交列表点名字也是到这里（?name=），
 * 所以同一页有三种人看：本人、同学、老师。看的人不同，后端给的东西不同（见
 * /profiles/:username/overview），这里只管摆。原来的「我的设置」并进了名片。
 */
const route = useRoute()
const userStore = useUserStore()
const { isDesktop } = useBreakpoints()

const username = computed(
  () => (route.query.name as string | undefined) || userStore.user?.username || "",
)
const isSelf = computed(() => username.value === userStore.user?.username)
const teacherView = computed(() => !isSelf.value && userStore.isTeacherOrAbove)

const profile = ref<Profile | null>(null)
const overview = ref<ProfileOverview | null>(null)
const loading = ref(true)
const notFound = ref(false)
const tab = ref("solved")

async function load() {
  const name = username.value
  if (!name) return
  try {
    const [p, o] = await Promise.all([getProfile(name), getProfileOverview(name)])
    if (name !== username.value) return
    profile.value = p
    overview.value = o
    notFound.value = !p
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

watch(username, load, { immediate: true })
</script>

<template>
  <div class="oj-page profile-page">
    <n-spin :show="loading" :delay="150">
      <n-empty v-if="notFound" description="没有这个用户" class="blank">
        <template #extra>
          <n-button @click="$router.push('/')">回首页</n-button>
        </template>
      </n-empty>

      <div v-else-if="profile && overview" class="body">
        <ProfileCard
          :profile="profile"
          :overview="overview"
          :is-self="isSelf"
          :teacher-view="teacherView"
          :compact="!isDesktop"
          @changed="load"
        />

        <div v-if="isDesktop" class="main">
          <SolvedCard
            :solved="overview.solved"
            :unsolved="overview.unsolved"
            title="做对的题"
            :username="teacherView ? profile.user.username : undefined"
          />
          <div class="column">
            <KnowledgeMap
              v-if="overview.knowledge"
              :map="overview.knowledge"
              :teacher="teacherView"
            />
            <AchievementCard
              :achievements="overview.achievements"
              :username="profile.user.username"
              :other="!isSelf"
            />
            <VersusCard
              v-if="overview.versus"
              :versus="overview.versus"
              :theirs="overview.solved.length"
            />
          </div>
        </div>

        <template v-else>
          <VersusCard
            v-if="overview.versus"
            :versus="overview.versus"
            :theirs="overview.solved.length"
          />
          <n-tabs v-model:value="tab" type="line" animated>
            <n-tab-pane name="solved" :tab="`做对的题 ${overview.solved.length}`">
              <SolvedCard
                :solved="overview.solved"
                :unsolved="overview.unsolved"
                title="做对的题"
                :username="teacherView ? profile.user.username : undefined"
                compact
              />
            </n-tab-pane>
            <n-tab-pane v-if="overview.knowledge" name="knowledge" tab="知识点">
              <KnowledgeMap :map="overview.knowledge" :teacher="teacherView" compact />
            </n-tab-pane>
            <n-tab-pane name="achievements" :tab="`成就 ${overview.achievements.unlocked.length}`">
              <AchievementCard
                :achievements="overview.achievements"
                :username="profile.user.username"
                :other="!isSelf"
                compact
              />
            </n-tab-pane>
          </n-tabs>
        </template>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.profile-page {
  padding-bottom: 40px;
}

.body,
.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}

.blank {
  padding: 80px 0;
}
</style>
