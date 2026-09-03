<template>
  <n-spin :show="aiStore.loading.fetching" :delay="50">
    <n-flex vertical size="large">
      <n-flex align="center" justify="space-between">
        <n-h3 style="margin: 0">请选择时间范围，智能分析学习情况</n-h3>
        <n-flex align="center">
          <n-input
            v-if="userStore.isSuperAdmin"
            v-model:value="urlUsername"
            placeholder="查看指定用户"
            clearable
            style="width: 140px"
            @change="onUsernameChange"
            @clear="onUsernameChange"
          />
          <n-select
            style="width: 140px"
            :options="options"
            v-model:value="urlDuration"
          />
        </n-flex>
      </n-flex>

      <Overview />
      <Heatmap />
      <DurationChart />
      <!-- 用弹性排布而不是两列网格：知识点分布在没有标签时整张卡不渲染，
           固定两列会空掉一半；flex 下剩的那张自动占满整行 -->
      <n-flex class="pair" :size="20">
        <DifficultyGradeChart />
        <TagsChart />
      </n-flex>
      <n-flex class="pair" :size="20">
        <ErrorTypeChart />
        <AttemptsChart />
      </n-flex>
      <n-flex class="pair" :size="20">
        <TimeActivityHeatmap />
        <FlowchartScoreChart />
      </n-flex>
      <SolvedTable />
      <AI />
    </n-flex>
  </n-spin>
</template>
<script setup lang="ts">
import { formatISO, sub, type Duration } from "date-fns"
import { useRouteQuery } from "@vueuse/router"
import DifficultyGradeChart from "./components/DifficultyGradeChart.vue"
import TagsChart from "./components/TagsChart.vue"
import ErrorTypeChart from "./components/ErrorTypeChart.vue"
import AttemptsChart from "./components/AttemptsChart.vue"
import FlowchartScoreChart from "./components/FlowchartScoreChart.vue"
import TimeActivityHeatmap from "./components/TimeActivityHeatmap.vue"
import Overview from "./components/Overview.vue"
import Heatmap from "./components/Heatmap.vue"
import DurationChart from "./components/DurationChart.vue"
import AI from "./components/AI.vue"
import SolvedTable from "./components/SolvedTable.vue"
import { useAIStore } from "../store/ai"
import { useUserStore } from "shared/store/user"
import { DURATION_OPTIONS } from "utils/constants"

const aiStore = useAIStore()
const userStore = useUserStore()
const options = [...DURATION_OPTIONS]

const urlUsername = useRouteQuery<string>("username", "")
const urlDuration = useRouteQuery<string>("duration", "months:6")

// Initialize store synchronously from URL params before watch fires
aiStore.targetUsername = urlUsername.value
aiStore.duration = urlDuration.value

const subOptions = computed<Duration>(() => {
  let dur = options.find((it) => it.value === aiStore.duration) ?? options[0]
  const x = dur.value!.toString().split(":")
  return { [x[0]]: parseInt(x[1]) } as Duration
})

const start = computed(() => formatISO(sub(new Date(), subOptions.value)))
const end = computed(() => formatISO(new Date()))

function onUsernameChange() {
  aiStore.targetUsername = urlUsername.value
  aiStore.fetchHeatmapData()
  aiStore.fetchAnalysisData(start.value, end.value, aiStore.duration)
}

onMounted(() => {
  aiStore.fetchHeatmapData()
})

watch(
  () => urlDuration.value,
  (val) => {
    aiStore.duration = val
    aiStore.fetchAnalysisData(start.value, end.value, val)
  },
  { immediate: true },
)
</script>
<style scoped>
.pair > :deep(.n-card) {
  flex: 1 1 320px;
}
</style>
