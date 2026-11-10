<script setup lang="ts">
import { TIME_ZONE_OFFSET_MINUTES, type MascotVisit } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { getMascotVisit } from 'oj/api'
import { MASCOT_POSES, poseUrl, type MascotPose } from 'shared/mascot/poses'

/**
 * 串门：看同学的主页时，对方的小鲸鱼今天穿着什么、认识多久、见过几个样子。
 * 衣服是拿小鱼干换的，穿了要有人看得到才有意思。互动次数、听过的话不给别人看（后端就没给）。
 * 对方从没碰过她（或者是老师）就不显示。
 */
const props = defineProps<{ username: string }>()
const theme = useThemeVars()
const visit = ref<MascotVisit | null>(null)

watch(
  () => props.username,
  async (name) => {
    visit.value = null
    try {
      const data = await getMascotVisit(name)
      if (name === props.username) visit.value = data
    } catch {
      // 拉不到就不显示
    }
  },
  { immediate: true },
)

const DAY_MS = 86_400_000
const dayIndex = (ms: number) => Math.floor((ms + TIME_ZONE_OFFSET_MINUTES * 60_000) / DAY_MS)
const knownDays = computed(() => (visit.value?.firstAt ? dayIndex(Date.now()) - dayIndex(Date.parse(visit.value.firstAt)) + 1 : 0))
/** 后端给的衣服名不在图里（以后下架了）就按平时那身 */
const pose = computed<MascotPose>(() => {
  const outfit = visit.value?.outfit
  return outfit && (MASCOT_POSES as readonly string[]).includes(outfit) ? (outfit as MascotPose) : 'idle'
})
</script>

<template>
  <section v-if="visit?.firstAt" class="card">
    <img :src="poseUrl(pose)" width="72" height="89" alt="" draggable="false" />
    <div class="text">
      <h3>小鲸鱼</h3>
      <p>认识第 {{ knownDays }} 天</p>
      <p>见过 {{ visit.poses }} / {{ MASCOT_POSES.length }} 个样子</p>
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 18px 0;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

img {
  display: block;
  object-fit: contain;
  object-position: 50% 100%;
  user-select: none;
}

.text {
  padding-bottom: 14px;
}

h3 {
  margin: 0 0 4px;
  font-size: var(--oj-fs-h2);
}

p {
  margin: 0;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor3');
}
</style>
