<script setup lang="ts">
import type { ProblemRow } from "utils/types"
import ProblemStatus from "oj/problem/components/ProblemStatus.vue"
import { useContestStore } from "oj/store/contest"

const props = defineProps<{ contestID: string }>()

const router = useRouter()
const contestStore = useContestStore()
const problemsColumns: DataTableColumn<ProblemRow>[] = [
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (row) => h(ProblemStatus, { status: row.status }),
  },
  {
    title: "编号",
    key: "_id",
    width: 100,
  },
  {
    title: "题目",
    key: "title",
    minWidth: 200,
  },
  {
    title: "提交数",
    key: "submissionCount",
    align: "center",
    width: 120,
  },
  {
    title: "通过率",
    key: "acRate",
    align: "center",
    width: 120,
  },
]

function rowProps(row: ProblemRow) {
  return {
    style: "cursor: pointer",
    onClick() {
      router.push(`/contest/${props.contestID}/problem/${row._id}`)
    },
  }
}
</script>

<template>
  <n-data-table
    striped
    :data="contestStore.problems"
    :columns="problemsColumns"
    :row-props="rowProps"
  />
</template>

<style scoped></style>
