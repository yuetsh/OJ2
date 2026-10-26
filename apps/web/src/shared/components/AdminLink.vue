<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * 前台页面上直达后台对应功能的按钮（「编辑这一课」「新建比赛」……），和题单页的
 * 「编辑题单」、比赛页的「比赛设置」同一种样子。渲染成真的 <a>：老师常要一边看前台
 * 一边改，中键 / Ctrl 点开新标签页得能用。给谁看由调用方用 v-if 管，要和
 * routes.ts 里目标路由的 meta 对齐，否则点下去被守卫静默踢回首页。
 */
withDefaults(defineProps<{ to: RouteLocationRaw; size?: 'tiny' | 'small' | 'medium' }>(), {
  size: 'medium',
})
</script>

<template>
  <RouterLink v-slot="{ href, navigate }" :to="to" custom>
    <n-button tag="a" :href="href" :size="size" @click="navigate"><slot /></n-button>
  </RouterLink>
</template>
