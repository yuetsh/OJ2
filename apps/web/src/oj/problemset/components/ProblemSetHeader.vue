<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { ProblemSet, UserBadge as UserBadgeType } from "utils/types"
import { parseTime } from "utils/functions"
import UserBadge from "shared/components/UserBadge.vue"
import { useUserStore } from "shared/store/user"

interface Props {
  problemSet: ProblemSet
  isJoined: boolean
  isJoining: boolean
  userBadges: UserBadgeType[]
}

interface Emits {
  (e: "join"): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const userStore = useUserStore()

function getDifficultyTag(difficulty: string) {
  const difficultyMap: Record<
    string,
    { type: "success" | "warning" | "error" | "default"; text: string }
  > = {
    Easy: { type: "success", text: "简单" },
    Medium: { type: "warning", text: "中等" },
    Hard: { type: "error", text: "困难" },
  }
  return difficultyMap[difficulty] || { type: "default", text: "未知" }
}

// 进度一律读 userProgress：它的分母是**必做题数**，而 problemsCount 是总题数。
// 拿总题数当分母的话，做完全部必做题的人会看到「9 / 10、90%」，而同一张卡片上
// 又标着「已完成」—— 题单 6 那 10 个人正是这种。
function getProgressPercentage() {
  return Math.round(props.problemSet?.userProgress?.progressPercentage ?? 0)
}

// 有选做题时把「必做 N 题」标出来，否则「共 10 道题目」和「9 / 9」对不上
const optionalCount = computed(
  () => props.problemSet.problemsCount - (props.problemSet.userProgress?.totalCount ?? 0),
)

const endTimeText = computed(() =>
  props.problemSet.endTime ? parseTime(props.problemSet.endTime, "YYYY-MM-DD HH:mm") : "",
)

function handleJoin() {
  emit("join")
}
</script>

<template>
  <n-card style="margin-bottom: 24px">
    <n-flex justify="space-between" align="center">
      <n-flex align="center">
        <n-tag type="warning" v-if="problemSet.status === 'archived'">
          已归档
        </n-tag>
        <n-tag :type="getDifficultyTag(problemSet.difficulty).type">
          {{ getDifficultyTag(problemSet.difficulty).text }}
        </n-tag>
        <!-- 截止时间不是「到点不能做了」，是「到点之前看不到自己加入题单之前的旧代码」，
             所以这里要连着解释一句，否则学生只看到一个日期，不知道它管什么 -->
        <n-tooltip trigger="hover" v-if="endTimeText">
          <template #trigger>
            <n-tag type="info">截止 {{ endTimeText }}</n-tag>
          </template>
          这个时间之前，你在加入题单之前提交过的代码是看不到的；在题单里做出该题即可解锁。
        </n-tooltip>
        <n-h2 style="margin: 0">{{ problemSet.title }}</n-h2>
        <n-tooltip trigger="hover" v-if="problemSet.description">
          <template #trigger>
            <Icon width="20" icon="fluent-emoji:information" />
          </template>
          {{ problemSet.description }}
        </n-tooltip>
      </n-flex>

      <n-flex align="center" v-if="userStore.isAuthed">
        <!-- 用户徽章显示区域 - 只在已加入且有徽章时显示 -->
        <n-flex v-if="isJoined && userBadges.length > 0" align="center">
          <n-text>已获徽章</n-text>
          <UserBadge
            v-for="badge in userBadges"
            :key="badge.id"
            :badge="badge"
          />
        </n-flex>

        <!-- 完成进度 - 只在已加入时显示 -->
        <n-flex align="center" v-if="isJoined">
          <n-text strong>完成进度</n-text>
          <n-text>
            {{ problemSet.userProgress?.completedCount ?? 0 }} /
            {{ problemSet.userProgress?.totalCount ?? 0 }}
          </n-text>
          <n-text depth="3" v-if="optionalCount > 0">
            （另有 {{ optionalCount }} 道选做）
          </n-text>
        </n-flex>
        <n-progress
          v-if="isJoined"
          :percentage="getProgressPercentage()"
          :height="8"
          :border-radius="4"
          style="width: 200px"
        />
        <n-button
          v-if="!isJoined"
          type="primary"
          size="large"
          :loading="isJoining"
          @click="handleJoin"
        >
          加入题单
        </n-button>
        <n-tag v-else type="success" size="large">
          <template #icon>
            <Icon icon="ph:check-circle-fill" />
          </template>
          已加入
        </n-tag>
      </n-flex>
    </n-flex>
  </n-card>
</template>
