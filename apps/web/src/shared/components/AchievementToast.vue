<script setup lang="ts">
import AchievementIcon from 'shared/components/AchievementIcon.vue'
import { mascotBox } from 'shared/mascot/guide'
import { useAchievementStore } from 'shared/store/achievement'
import { RARITY_COLOR } from 'utils/constants'

const store = useAchievementStore()
const { current, queue } = storeToRefs(store)
const visible = ref(false)
const toastEl = ref<HTMLElement>()

const RIGHT = 24
const TOP = 72
const GAP = 12

/**
 * 默认在右上角。看板娘被拖到和它重叠的地方（多半是右上角）时，挪到她左边 ——
 * 补发成就时一次会连着弹好几个，一直压在她头上不好看。尺寸按弹出来以后量到的算，
 * 还没量到时按最小宽度和大致高度估。
 */
const placement = computed(() => {
  if (!mascotBox.shown || !visible.value) return {}
  const vw = document.documentElement.clientWidth
  const width = toastEl.value?.offsetWidth ?? 300
  const height = toastEl.value?.offsetHeight ?? 90
  const left = vw - RIGHT - width
  const overlaps = mascotBox.x < vw - RIGHT && mascotBox.x + mascotBox.width > left && mascotBox.y < TOP + height && mascotBox.y + mascotBox.height > TOP
  return overlaps ? { right: `${vw - mascotBox.x + GAP}px` } : {}
})

let timer: ReturnType<typeof setTimeout> | null = null
let gapTimer: ReturnType<typeof setTimeout> | null = null

// 多个同时解锁时排队依次弹出，不重叠堆积
function playNext() {
  const item = store.next()
  if (!item) return
  visible.value = true
  timer = setTimeout(async () => {
    visible.value = false
    await store.markRead(item)
    gapTimer = setTimeout(playNext, 400)
  }, 3000)
}

watch(
  () => queue.value.length,
  (len) => {
    if (len > 0 && !visible.value) playNext()
  },
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  if (gapTimer) clearTimeout(gapTimer)
})
</script>

<template>
  <Transition name="slide">
    <div v-if="visible && current" ref="toastEl" class="toast" :style="{ borderColor: RARITY_COLOR[current.rarity], ...placement }">
      <div class="icon">
        <AchievementIcon :icon="current.icon" :size="34" />
      </div>
      <div class="body">
        <div class="label">
          {{ current.kind === 'badge' ? '获得奖章' : '成就解锁' }}
        </div>
        <div class="name">{{ current.name }}</div>
        <div class="desc">{{ current.description }}</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  /* 右上角、顶栏下面。原来在右下角，题目页上正好和结果、点评弹窗叠在一起 */
  right: 24px; /* 和脚本里的 RIGHT / TOP 一致 */
  top: 72px;
  z-index: 3000;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 18px;
  border-radius: 10px;
  border: 2px solid;
  background: var(--n-color, rgba(24, 24, 28, 0.95));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  min-width: 260px;
}
.icon {
  font-size: 34px;
}
.label {
  font-size: 11px;
  letter-spacing: 2px;
  opacity: 0.6;
}
.name {
  font-weight: 700;
  margin-top: 2px;
}
.desc {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 2px;
}
.slide-enter-active,
.slide-leave-active {
  transition: all 0.35s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
