<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import { getProblemSetList } from "../api"
import type { ProblemSet } from "utils/types"
import Pagination from "shared/components/Pagination.vue"
import { usePagination } from "shared/composables/pagination"

const router = useRouter()

const total = ref(0)
const problemSets = ref<ProblemSet[]>([])

interface ProblemSetQuery {
  keyword: string
}

// 使用分页 composable
const { query, clearQuery } = usePagination<ProblemSetQuery>(
  {
    keyword: useRouteQuery("keyword", "").value,
  },
  {
    defaultLimit: 30,
  },
)

async function listProblemSets() {
  if (query.page < 1) query.page = 1
  const offset = (query.page - 1) * query.limit
  const res = await getProblemSetList(offset, query.limit, query.keyword)
  total.value = res.total
  problemSets.value = res.results
}

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

function goToProblemSet(problemSetId: number) {
  router.push(`/problemset/${problemSetId}`)
}

function getConditionText(conditionType: string, conditionValue: number): string {
  const conditionMap: Record<string, string> = {
    all_problems: "完成所有题目",
    problem_count: `完成 ${conditionValue} 道题目`,
    score: `达到 ${conditionValue} 分`,
  }
  return conditionMap[conditionType] || "未知条件"
}

onMounted(listProblemSets)

// 监听搜索关键词变化（防抖）
watchDebounced(() => query.keyword, listProblemSets, {
  debounce: 500,
  maxWait: 1000,
})

// 监听其他查询条件变化
watch(() => [query.page, query.limit], listProblemSets)
</script>

<template>
  <n-flex vertical size="large">
    <!-- 难度和状态两个筛选器撤了：线上 16 个题单全是 Easy / active，选「中等」「困难」
         「已归档」永远是空列表。接口那两个 query 参数还在，哪天真的用起这两个字段，
         把 select 加回来即可。 -->
    <n-space>
      <n-input
        v-model:value="query.keyword"
        placeholder="搜索题单..."
        clearable
        @clear="clearQuery"
        style="width: 200px"
      />
    </n-space>

    <div v-if="problemSets.length > 0" class="set-grid">
      <div
        v-for="problemSet in problemSets"
        :key="problemSet.id"
        class="set-card"
        :class="{ completed: problemSet.userProgress?.isCompleted }"
        @click="goToProblemSet(problemSet.id)"
      >
        <n-flex justify="space-between" align="center" :wrap="false" :size="8">
          <span class="set-title">{{ problemSet.title }}</span>
          <n-tag v-if="problemSet.userProgress?.isCompleted" type="success" size="small" round>
            已完成
          </n-tag>
          <n-tag v-else-if="problemSet.userProgress?.isJoined" type="info" size="small" round>
            进行中
          </n-tag>
        </n-flex>

        <!-- 简介大多就是把标题再抄一遍，一样的就不重复显示 -->
        <n-text
          v-if="problemSet.description && problemSet.description !== problemSet.title"
          depth="3"
          class="set-desc"
        >
          {{ problemSet.description }}
        </n-text>

        <div class="set-progress">
          <n-flex justify="space-between" align="center" class="set-progress-text">
            <n-text depth="3">
              <!-- 进度是加入/完成时存下的快照，分母用快照自己的 totalCount：题单后来
                   加了题的话，拿现在的 problemsCount 去除，就会出现「已完成」却是 5 / 6 -->
              <template v-if="problemSet.userProgress?.isJoined">
                已完成 {{ problemSet.userProgress.completedCount }} /
                {{ problemSet.userProgress.totalCount }} 题
                <template v-if="problemSet.problemsCount > problemSet.userProgress.totalCount">
                  · 新加了
                  {{ problemSet.problemsCount - problemSet.userProgress.totalCount }} 题
                </template>
              </template>
              <template v-else>共 {{ problemSet.problemsCount }} 题 · 还没开始</template>
            </n-text>
            <!-- 线上题单全是简单难度，只有不是简单时才值得标出来 -->
            <n-tag
              v-if="problemSet.difficulty !== 'Easy'"
              :type="getDifficultyTag(problemSet.difficulty).type"
              size="small"
              :bordered="false"
            >
              {{ getDifficultyTag(problemSet.difficulty).text }}
            </n-tag>
            <n-tag v-if="problemSet.status === 'archived'" size="small" :bordered="false">
              已归档
            </n-tag>
          </n-flex>
          <n-progress
            type="line"
            :percentage="Math.round(problemSet.userProgress?.progressPercentage ?? 0)"
            :show-indicator="false"
            :height="6"
            status="success"
          />
        </div>

        <n-flex v-if="problemSet.badges?.length" align="center" :size="6" class="set-badges">
          <n-text depth="3" class="set-badges-label">
            徽章 {{ problemSet.badges.filter((b) => b.isEarned).length }} /
            {{ problemSet.badges.length }}
          </n-text>
          <n-tooltip v-for="badge in problemSet.badges" :key="badge.id" trigger="hover">
            <template #trigger>
              <n-image
                :src="badge.icon"
                :alt="badge.name"
                width="24"
                height="24"
                object-fit="cover"
                preview-disabled
                :class="badge.isEarned ? 'earned-badge' : 'locked-badge'"
              />
            </template>
            <n-flex vertical size="small">
              <span style="font-weight: bold"> 徽章: {{ badge.name }} </span>
              <span>
                获取条件:
                {{ getConditionText(badge.conditionType, badge.conditionValue) }}
              </span>
              <n-text type="primary" v-if="badge.isEarned"> ✓ 已获得 </n-text>
            </n-flex>
          </n-tooltip>
        </n-flex>
      </div>
    </div>

    <Pagination
      v-if="problemSets.length > 0"
      :total="total"
      v-model:limit="query.limit"
      v-model:page="query.page"
    />
  </n-flex>
  <n-empty v-if="problemSets.length === 0"></n-empty>
</template>

<style scoped>
.set-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.set-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.set-card:hover {
  border-color: #18a058;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.set-card.completed {
  background-color: rgba(24, 160, 88, 0.05);
}

.set-title {
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.set-desc {
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.set-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}

.set-progress-text {
  font-size: 13px;
}

.set-badges-label {
  font-size: 12px;
  margin-right: 2px;
}

.earned-badge {
  border: 2px solid #ffd700;
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.4);
}

/* 没拿到的徽章压成灰色：原来拿没拿到只差一圈金边，一排看下去分不清 */
.locked-badge {
  filter: grayscale(1);
  opacity: 0.45;
}
</style>
