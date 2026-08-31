<script setup lang="ts">
import {
  getProblemSetDetail,
  getProblemSetProblems,
  joinProblemSet,
  getUserBadges,
} from "../api"
import type {
  ProblemSet,
  ProblemSetProblem,
  UserBadge as UserBadgeType,
} from "utils/types"
import { useFireworks } from "../problem/composables/useFireworks"
import ProblemSetHeader from "./components/ProblemSetHeader.vue"
import ProblemSetProblemsList from "./components/ProblemSetProblemsList.vue"
import UserProgressView from "./components/UserProgressView.vue"
import { useUserStore } from "shared/store/user"

const route = useRoute()
const router = useRouter()
const message = useMessage()

const { celebrate } = useFireworks()
const userStore = useUserStore()

const problemSetId = computed(() => Number(route.params.problemSetId))

const problemSet = ref<ProblemSet | null>(null)
const problems = ref<ProblemSetProblem[]>([])
const isJoined = ref(false)
const isJoining = ref(false)
const userBadges = ref<UserBadgeType[]>([])
const activeTab = ref("problems")

async function loadProblemSetDetail() {
  const res = await getProblemSetDetail(problemSetId.value)
  problemSet.value = res
  isJoined.value = res.userProgress?.isJoined || false
}

async function loadProblems() {
  const res = await getProblemSetProblems(problemSetId.value)
  problems.value = res
}

async function loadUserBadges() {
  if (!isJoined.value) return

  const res = await getUserBadges()
  userBadges.value = res.filter(
    (badge: UserBadgeType) => badge.badge.problemsetId === problemSetId.value,
  )
}

async function init() {
  await Promise.all([loadProblemSetDetail(), loadProblems()])
  if (isJoined.value) {
    if (problemSet.value?.userProgress?.isCompleted) {
      celebrate()
    }
    loadUserBadges()
  }
}

async function handleProblemClick(problemId: string) {
  if (!userStore.isAuthed) {
    message.warning("请先登录！")
    return
  }
  if (!isJoined.value) {
    message.warning("请先点击【加入题单】按钮！")
    return
  }
  router.push({
    name: "problemset problem",
    params: {
      problemSetId: problemSetId.value,
      problemID: problemId,
    },
  })
}

async function handleJoinProblemSet() {
  if (isJoining.value) return

  isJoining.value = true
  try {
    await joinProblemSet(problemSetId.value)
    isJoined.value = true
    message.success("成功加入题单！")
    // 加入题单后加载用户徽章
    await loadUserBadges()
  } catch (err: any) {
    message.error("加入题单失败：" + (err.data || "未知错误"))
  } finally {
    isJoining.value = false
  }
}

// 「用户进度」那一栏调的是 requireTeacher 的接口（Teacher Admin | Super Admin），
// 所以这里的条件必须跟它一致。以前写的是「超管 或 自己完成了题单」，两边正好错开：
// 学生做完题单会看到这一栏、点进去 403；而真正该用它的 Teacher Admin 反倒看不到。
const showTabs = computed(() => userStore.isTeacherOrAbove)

onMounted(init)
</script>

<template>
  <div v-if="problemSet">
    <ProblemSetHeader
      :problem-set="problemSet"
      :is-joined="isJoined"
      :is-joining="isJoining"
      :user-badges="userBadges"
      @join="handleJoinProblemSet"
    />
    <n-tabs v-if="showTabs" v-model:value="activeTab" animated>
      <n-tab-pane name="problems" tab="题目列表">
        <ProblemSetProblemsList
          :problems="problems"
          :is-joined="isJoined"
          @problem-click="handleProblemClick"
        />
      </n-tab-pane>
      <n-tab-pane name="progress" tab="用户进度">
        <UserProgressView />
      </n-tab-pane>
    </n-tabs>
    <ProblemSetProblemsList
      v-else
      :problems="problems"
      :is-joined="isJoined"
      @problem-click="handleProblemClick"
    />
  </div>
</template>

<style scoped></style>
