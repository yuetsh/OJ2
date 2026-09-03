<template>
  <n-tabs animated v-if="hasSolved && flowcharts.length">
    <n-tab-pane name="代码提交">
      <n-data-table
        remote
        striped
        :data="aiStore.solvedRows"
        :columns="columns"
        :loading="aiStore.loading.solved"
        :pagination="solvedPagination"
        @update:page="aiStore.fetchSolved"
      />
    </n-tab-pane>
    <n-tab-pane name="流程图提交">
      <n-data-table
        striped
        :data="flowcharts"
        :columns="flowchartsColumns"
        :pagination="paginationFor(flowcharts)"
      />
    </n-tab-pane>
  </n-tabs>
  <n-data-table
    v-else-if="hasSolved"
    remote
    striped
    :data="aiStore.solvedRows"
    :columns="columns"
    :loading="aiStore.loading.solved"
    :pagination="solvedPagination"
    @update:page="aiStore.fetchSolved"
  />
  <n-data-table
    v-else-if="flowcharts.length"
    striped
    :data="flowcharts"
    :columns="flowchartsColumns"
    :pagination="paginationFor(flowcharts)"
  />
</template>

<script lang="ts" setup>
import { NButton, NTooltip } from "naive-ui"
import TagTitle from "./TagTitle.vue"
import type { FlowchartSummary, SolvedProblem } from "utils/types"
import { useAIStore } from "oj/store/ai"
import { parseTime } from "utils/functions"

const router = useRouter()
const aiStore = useAIStore()

const hasSolved = computed(() => aiStore.detailsData.solvedCount > 0)
const flowcharts = computed(() => aiStore.detailsData.flowcharts)

// 代码提交这张走服务端分页：翻页只拉一页，不把整年的题一次发给浏览器。
// 流程图那张仍然是全量下发的（一个 OJ 的流程图题就那么几道），本地分页即可。
// 行数不够一页时不显示分页器，和 ExerciseAttempts.vue 一致
const solvedPagination = computed(() =>
  aiStore.solvedTotal > aiStore.solvedPageSize
    ? {
        page: aiStore.solvedPage,
        pageSize: aiStore.solvedPageSize,
        itemCount: aiStore.solvedTotal,
      }
    : false,
)
function paginationFor(rows: unknown[]) {
  const pageSize = aiStore.solvedPageSize
  return rows.length > pageSize ? { pageSize } : false
}
const columns: DataTableColumn<SolvedProblem>[] = [
  {
    title: "完成的题目",
    key: "problem.title",
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          onClick: () => {
            if (row.problem.contestId) {
              router.push(
                "/contest/" +
                  row.problem.contestId +
                  "/problem/" +
                  row.problem.displayId,
              )
            } else {
              router.push("/problem/" + row.problem.displayId)
            }
          },
        },
        () => {
          if (row.problem.contestId) {
            return h(TagTitle, { problem: row.problem })
          } else {
            return row.problem.displayId + " " + row.problem.title
          }
        },
      ),
  },
  {
    // 用后端下发的 rankScope，不要看 className 有没有值：班里只有一个人时
    // 后端会回退到全服排名，那种学生原来看到的是「班级排名」配全服数据
    title: () =>
      aiStore.detailsData.rankScope === "class" ? "班级排名" : "全服排名",
    key: "rank",
    width: 100,
    align: "center",
    render: (row) => row.rank + " / " + row.acCount,
  },
  {
    title: "同期排名",
    key: "period_rank",
    width: 100,
    align: "center",
    render: (row) => row.periodRank + " / " + row.periodAcCount,
  },
  {
    title: () =>
      h(NTooltip, null, {
        trigger: () =>
          h(
            "span",
            { style: "cursor:help; border-bottom: 1px dashed" },
            "等级",
          ),
        default: () =>
          h("div", null, [
            h("div", null, "基于同时段排名的百分位："),
            h("div", null, "S — 前 10%"),
            h("div", null, "A — 前 35%"),
            h("div", null, "B — 前 75%"),
            h("div", null, "C — 其余"),
          ]),
      }),
    key: "grade",
    width: 100,
    align: "center",
  },
]

const flowchartsColumns: DataTableColumn<FlowchartSummary>[] = [
  {
    title: "完成的题目",
    key: "problem_title",
    width: 300,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          onClick: () => {
            router.push("/problem/" + row.problemId)
          },
        },
        () => `${row.problemId} ${row.problemTitle}`,
      ),
  },
  { title: "提交次数", key: "submissionCount", width: 100, align: "center" },
  {
    title: "最高分",
    key: "best",
    width: 100,
    align: "center",
    render: (row) => `${row.bestScore} (${row.bestGrade})`,
  },
  {
    title: "最新提交时间",
    key: "latest_submission_time",
    width: 200,
    align: "center",
    render: (row) => parseTime(row.latestSubmissionTime),
  },
  { title: "平均分", key: "avgScore", width: 100, align: "center" },
]
</script>
