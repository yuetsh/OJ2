<script setup lang="ts">
import { useBreakpoints } from "shared/composables/breakpoints"

interface Props {
  total: number
  limit: number
  page: number
  /** 只要「‹ 页码 / 总页数 ›」：提交列表收窄以后底栏放不下一串页码 */
  simple?: boolean
}

const {
  total,
  limit: initialLimit = 10,
  page: initialPage = 1,
  simple = false,
} = defineProps<Props>()

const emit = defineEmits(["update:limit", "update:page"])

const { isDesktop } = useBreakpoints()

const limit = ref(initialLimit)
const page = ref(initialPage)
const sizes = [10, 30, 50]

// 必须 emit 数值：emit ref 对象时，父组件用普通 ref 接会拿不到数字，
// 而且每次 emit 的都是同一个对象，父组件那边察觉不到变化
watch(limit, (value) => emit("update:limit", value))
watch(page, (value) => emit("update:page", value))

// 父组件改页码 / 每页条数（比如换搜索条件后重置到第一页）时同步回来
watch(
  () => initialLimit,
  (value) => (limit.value = value),
)
watch(
  () => initialPage,
  (value) => (page.value = value),
)
</script>

<template>
  <n-pagination
    v-if="total"
    class="right margin"
    :item-count="total"
    v-model:page="page"
    v-model:page-size="limit"
    :page-sizes="sizes"
    :page-slot="isDesktop ? 7 : 5"
    :show-size-picker="isDesktop && !simple"
    :simple="simple"
  />
</template>
<style scoped>
.margin {
  margin: 20px 0;
}
.right {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}
</style>
