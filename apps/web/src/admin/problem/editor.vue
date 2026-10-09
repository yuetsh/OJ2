<script setup lang="ts">
import { isSqlProblem } from "@oj2/contract"
import type { AdminProblem } from "utils/types"
import { getProblem } from "../api"
import ProblemDetail from "./detail.vue"
import SqlDetail from "./SqlDetail.vue"

/**
 * 出题 / 改题的入口：编程题和 SQL 题是两张不同的页。
 * 新建看地址上的 `?type=sql`（后台题目列表「新建题目」下拉里选的），
 * 编辑看题目本身 —— 题型建好之后不能改，所以没有「切换题型」这回事。
 */
const props = defineProps<{
  problemID?: string
  contestID?: string
}>()

const route = useRoute()
const router = useRouter()
const message = useMessage()

const loaded = shallowRef<AdminProblem | null>(null)
const kind = ref<"code" | "sql" | null>(null)

async function resolve() {
  kind.value = null
  loaded.value = null
  if (!props.problemID) {
    kind.value = route.query.type === "sql" ? "sql" : "code"
    return
  }
  try {
    loaded.value = await getProblem(props.problemID)
    kind.value = isSqlProblem(loaded.value) ? "sql" : "code"
  } catch {
    message.error("获取题目失败")
    router.push(
      props.contestID
        ? { name: "admin contest problem list", params: { contestID: props.contestID } }
        : { name: "admin problem list" },
    )
  }
}

watch(() => [props.problemID, route.query.type], resolve, { immediate: true })
</script>

<template>
  <SqlDetail
    v-if="kind === 'sql'"
    :key="`sql-${problemID ?? 'new'}`"
    :problem-i-d="problemID"
    :contest-i-d="contestID"
    :initial="loaded"
  />
  <ProblemDetail
    v-else-if="kind === 'code'"
    :key="`code-${problemID ?? 'new'}`"
    :problem-i-d="problemID"
    :contest-i-d="contestID"
    :initial="loaded"
  />
</template>
