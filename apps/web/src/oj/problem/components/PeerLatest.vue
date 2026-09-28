<script setup lang="ts">
import { storeToRefs } from "pinia"
import { getSubmission, getSubmissions } from "oj/api"
import { useProblemStore } from "oj/store/problem"
import { useCollabStore } from "shared/store/collab"
import { parseTime } from "utils/functions"
import type { Submission } from "utils/types"

/**
 * 老师接单之后落在题目页，「结果」页签原来是空的 —— 学生多半是交了几次没过才举的手，
 * 老师最先想知道的就是「他交上去是什么结果」。这里摆出学生最近一次交的（设计文档第 9 节）。
 * 管理员角色本来就能看任何人的提交，不需要新接口。
 */
const SubmissionResult = defineAsyncComponent(() => import("./SubmissionResult.vue"))

const collabStore = useCollabStore()
const { problem } = storeToRefs(useProblemStore())

const loading = ref(false)
const failed = ref(false)
const latest = ref<Submission | null>(null)
const checked = ref(false)

const peer = computed(() => collabStore.room?.peerName ?? "")

async function load() {
  if (!peer.value || !problem.value) return
  loading.value = true
  failed.value = false
  try {
    const list = await getSubmissions({
      username: peer.value,
      exactUsername: "1",
      problemDisplayId: problem.value._id,
      limit: 1,
      offset: 0,
    })
    const row = list.results[0]
    latest.value = row ? await getSubmission(row.id) : null
    checked.value = true
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

watch([peer, () => problem.value?._id], load, { immediate: true })
</script>

<template>
  <div class="peer-latest">
    <n-flex align="center" justify="space-between" class="head">
      <span>
        <b>{{ peer }}</b> 最近一次交的
        <n-text v-if="latest" depth="3">· {{ parseTime(latest.createTime, "HH:mm:ss") }}</n-text>
      </span>
      <n-button size="small" :loading="loading" @click="load">刷新</n-button>
    </n-flex>

    <n-text v-if="failed" type="error">读不出他的提交，点「刷新」再试</n-text>
    <SubmissionResult v-else-if="latest" :submission="latest" peer />
    <n-empty v-else-if="checked" class="empty" description="他还没交过这道题" />
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 12px;
}

.empty {
  margin-top: 32px;
}
</style>
