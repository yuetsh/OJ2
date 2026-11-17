<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { MASCOT_POSES, poseUrl, type MascotPose } from 'shared/mascot/poses'

// 成就图标统一走 iconify（noto 彩色 emoji 图标集），渲染出来是 SVG，
// 老浏览器缺 emoji 字体也能正常显示。
//
// 四种形态按顺序判断，顺序不能换：专题奖章的 icon 是图片 URL，
// 而 https:// 里也带冒号，先判 iconify 会把 URL 当成图标名。
// 「小鲸鱼」那一组是 `mascot:<姿势名>`，画看板娘那张立绘的上半身（也带冒号，要排在 iconify 前面）。
// 存量成就的 icon 还可能是 emoji 字符，最后原样当文本兜底。
const props = withDefaults(defineProps<{ icon: string; size?: number }>(), {
  size: 32,
})

const mascotPose = computed(() => {
  const pose = props.icon?.startsWith('mascot:') ? props.icon.slice(7) : null
  return pose && (MASCOT_POSES as readonly string[]).includes(pose) ? (pose as MascotPose) : null
})

const kind = computed(() => {
  const v = props.icon ?? ''
  if (/^(https?:\/\/|\/|data:)/.test(v)) return 'image'
  if (mascotPose.value) return 'mascot'
  if (v.includes(':')) return 'iconify'
  return 'text'
})
</script>

<template>
  <img v-if="kind === 'image'" :src="icon" :width="size" :height="size" class="image" alt="" />
  <span v-else-if="kind === 'mascot'" class="mascot" :style="{ width: `${size * 1.45}px`, height: `${size * 1.45}px` }">
    <img :src="poseUrl(mascotPose!)" alt="" loading="lazy" />
  </span>
  <Icon v-else-if="kind === 'iconify'" :icon="icon" :width="size" :height="size" />
  <span v-else class="fallback" :style="{ fontSize: `${size}px` }">
    {{ icon }}
  </span>
</template>

<style scoped>
.image {
  object-fit: contain;
  border-radius: 4px;
}
.mascot {
  display: block;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 50%;
}
/* 立绘是全身像（288×354、脚底对齐），宽度撑满、只露上面一截：拿着的东西（锅、奖杯、睡衣、圣诞帽）都在里面，
   放大到只剩头的话几十张看着都一样 */
.mascot img {
  display: block;
  width: 100%;
  height: auto;
}
.fallback {
  line-height: 1;
}
</style>
