<script setup lang="ts">
import { useRouteQuery } from "@vueuse/router"
import StatisticsView from "./components/StatisticsView.vue"
import { DEFAULT_PERIOD } from "./period"

/**
 * 数据统计的页面形态：课堂看板「回头看」、题目页统计页签、今日统计从别处进来时用。
 * 提交列表里是弹框（用户定的），两边是同一个 StatisticsView。
 *
 * 查询条件都在地址栏里：带过来、刷新、转发给别的老师都还是这一份。
 */
const router = useRouter()

const tab = useRouteQuery<string>("tab", "code", { mode: "replace" })
const className = useRouteQuery<string>("className", "", { mode: "replace" })
const username = useRouteQuery<string>("username", "", { mode: "replace" })
const problem = useRouteQuery<string>("problem", "", { mode: "replace" })
const period = useRouteQuery<string>("period", DEFAULT_PERIOD, { mode: "replace" })
const from = useRouteQuery<string>("from", "", { mode: "replace" })
const to = useRouteQuery<string>("to", "", { mode: "replace" })

function openList(query: Record<string, string>) {
  window.open(router.resolve({ name: "submissions", query }).href, "_blank")
}
</script>

<template>
  <div class="page">
    <StatisticsView
      v-model:tab="tab"
      v-model:class-name="className"
      v-model:username="username"
      v-model:problem="problem"
      v-model:period="period"
      v-model:from="from"
      v-model:to="to"
      @list="openList"
    />
  </div>
</template>

<style scoped>
/* 铺满顶栏以下，和提交列表同一个做法（负边距吃掉外层 16px） */
.page {
  margin: -16px;
  height: calc(100vh - 56px);
}

/* 手机：老师很少在手机上看统计，只保证不坏 —— 整页自然滚动 */
@media (max-width: 767px) {
  .page {
    height: auto;
    min-height: calc(100vh - 56px);
  }
}
</style>
