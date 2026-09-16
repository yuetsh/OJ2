<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getTodaySubmissionStatistics } from "oj/api"
import { LANGUAGE_SHOW_VALUE } from "utils/constants"
import { zonedParts } from "utils/functions"
import SubmissionResultTag from "shared/components/SubmissionResultTag.vue"
import type { TodaySubmissionStatistics } from "@oj2/contract"

const emit = defineEmits<{ openProblem: [problem: string] }>()

const themeVars = useThemeVars()

const stats = ref<TodaySubmissionStatistics | null>(null)
const loading = ref(true)

// 柱子高度用的像素上限。CSS 里 .hour-bars 的高度跟着它
const BAR_MAX_HEIGHT = 72

// 「现在是几点」按东八区取，不跟浏览器时区走 —— 高亮错一格比不高亮更糟
const currentHour = zonedParts(new Date())!.hour

const maxHour = computed(() => Math.max(1, ...(stats.value?.hours ?? [])))
const maxLanguage = computed(() =>
  Math.max(1, ...(stats.value?.languages ?? []).map((row) => row.count)),
)

/** 0 条的钟点不画柱子，横轴那条基线本身就代表「这个钟点没人交」 */
function barHeight(value: number) {
  if (value <= 0) return "0px"
  return `${Math.max(4, Math.round((value / maxHour.value) * BAR_MAX_HEIGHT))}px`
}

onMounted(async () => {
  try {
    stats.value = await getTodaySubmissionStatistics()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <n-spin :show="loading">
    <n-empty
      v-if="stats && stats.total === 0"
      description="今天还没有人提交"
      style="margin: 40px 0"
    />
    <template v-else-if="stats">
      <n-flex justify="space-around">
        <div class="stat-item">
          <n-text>总提交</n-text>
          <n-gradient-text type="info" font-size="28">
            {{ stats.total }}
          </n-gradient-text>
        </div>
        <div class="stat-item">
          <n-text>正确提交</n-text>
          <n-gradient-text type="primary" font-size="28">
            {{ stats.accepted }}
          </n-gradient-text>
        </div>
        <div class="stat-item" v-if="stats.judging > 0">
          <n-text>判题中</n-text>
          <n-gradient-text type="info" font-size="28">
            {{ stats.judging }}
          </n-gradient-text>
        </div>
        <div class="stat-item">
          <n-text>正确率</n-text>
          <n-gradient-text type="warning" font-size="28">
            {{ stats.correctRate }}%
          </n-gradient-text>
        </div>
        <div class="stat-item">
          <n-text>参与人数</n-text>
          <n-gradient-text type="error" font-size="28">
            {{ stats.userCount }}
          </n-gradient-text>
        </div>
      </n-flex>

      <n-divider style="margin: 16px 0">按小时</n-divider>
      <div class="hours">
        <div class="hour" v-for="(value, hour) in stats.hours" :key="hour">
          <n-tooltip>
            <template #trigger>
              <!--
                基线是每一格自己的下边框拼出来的（整条横轴一根 border 也行，但那样
                「现在」这一格就没法单独加粗）。**现在这一格加粗成主色**，
                原来是给整格垫一层底色，结果那块浅灰看着就像一根柱子。
              -->
              <div
                class="hour-bars"
                :style="{
                  borderBottomColor:
                    hour === currentHour
                      ? themeVars.primaryColor
                      : themeVars.dividerColor,
                }"
              >
                <div
                  class="bar"
                  :style="{
                    height: barHeight(value),
                    backgroundColor: themeVars.primaryColor,
                  }"
                ></div>
              </div>
            </template>
            {{ hour }}:00 - {{ hour }}:59 共 {{ value }} 条
          </n-tooltip>
          <!-- 每 3 小时标一个刻度。标签占位始终留着，柱子才对得齐 -->
          <div class="hour-label">{{ hour % 3 === 0 ? hour : "" }}</div>
        </div>
      </div>

      <n-divider style="margin: 16px 0">按语言</n-divider>
      <div class="rows">
        <div class="row" v-for="row in stats.languages" :key="row.language">
          <n-text class="row-name">{{
            LANGUAGE_SHOW_VALUE[row.language]
          }}</n-text>
          <n-progress
            class="row-bar"
            type="line"
            :percentage="(row.count / maxLanguage) * 100"
            :show-indicator="false"
            :height="10"
          />
          <n-text class="row-count">{{ row.count }}</n-text>
        </div>
      </div>

      <n-divider style="margin: 16px 0">按状态</n-divider>
      <n-flex align="center">
        <n-flex
          align="center"
          :size="4"
          v-for="row in stats.results"
          :key="row.result"
        >
          <SubmissionResultTag :result="row.result" />
          <n-text>{{ row.count }}</n-text>
        </n-flex>
      </n-flex>

      <template v-if="stats.problems.length">
        <n-divider style="margin: 16px 0">今天最热的题</n-divider>
        <div class="rows">
          <div class="row" v-for="row in stats.problems" :key="row.problem">
            <n-button
              class="problem"
              text
              type="info"
              @click="emit('openProblem', row.problem)"
            >
              {{ row.problem }} {{ row.problemTitle }}
            </n-button>
            <n-text class="row-count" depth="3">
              {{ row.count }} 条 / 正确 {{ row.acceptedCount }}
            </n-text>
          </div>
        </div>
      </template>
    </template>
    <!-- 请求失败时 stats 还是 null，转圈停下来总得留句话 -->
    <n-empty
      v-else-if="!loading"
      description="统计拉取失败"
      style="margin: 40px 0"
    />
    <div v-else style="height: 200px"></div>
  </n-spin>
</template>

<style scoped>
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.hours {
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.hour {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.hour-bars {
  height: 72px;
  width: 100%;
  display: flex;
  align-items: flex-end;
  cursor: default;
  /* 每格一段，拼成整条横轴。「现在」那一格换主色，粗细不动 —— 变粗会让那一格的
     柱子底比别人高 1px */
  border-bottom: 2px solid;
}

.bar {
  width: 100%;
  border-radius: 2px 2px 0 0;
  transition: height 0.2s;
}

.hour-label {
  font-size: 11px;
  line-height: 14px;
  opacity: 0.6;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-name {
  width: 72px;
  flex-shrink: 0;
}

.row-bar {
  flex: 1;
}

.row-count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.problem {
  flex: 1;
  justify-content: flex-start;
  overflow: hidden;
}
</style>
