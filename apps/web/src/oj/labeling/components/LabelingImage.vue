<script setup lang="ts">
import { labelingImageUrl } from 'oj/api'
import { authFetch } from 'utils/auth'

/**
 * 一条的图片。接口要带登录态（没公开的一节只有老师看得到），所以不能直接 <img src>：
 * 用 authFetch 取回来转成 blob 地址。接口按条目 id 缓存一天，翻回来不用再下。
 */
const props = defineProps<{ labelingId: number; itemId: number; alt?: string }>()

const src = ref<string | null>(null)
const failed = ref(false)

watch(
  () => [props.labelingId, props.itemId],
  async () => {
    if (src.value) URL.revokeObjectURL(src.value)
    src.value = null
    failed.value = false
    const itemId = props.itemId
    try {
      const res = await authFetch(labelingImageUrl(props.labelingId, itemId))
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      if (itemId !== props.itemId) return URL.revokeObjectURL(url)
      src.value = url
    } catch {
      failed.value = true
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (src.value) URL.revokeObjectURL(src.value)
})
</script>

<template>
  <img v-if="src" :src="src" :alt="alt ?? '图片'" class="labelingImage" />
  <div v-else class="labelingImage placeholder">
    <n-text v-if="failed" depth="3">图片没加载出来</n-text>
    <n-spin v-else size="small" />
  </div>
</template>

<style scoped>
.labelingImage {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.placeholder {
  display: grid;
  place-items: center;
  min-height: 120px;
}
</style>
