<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { ProjectGroup } from '../lesson'

/** 项目的小方块图标：智能家居一个房子、智慧农业一片叶子…… */
defineProps<{ icon: string; tone: ProjectGroup['tone']; size?: number }>()
</script>

<template>
  <span class="tile" :class="tone" :style="{ width: `${size ?? 36}px`, height: `${size ?? 36}px` }" aria-hidden="true">
    <Icon :icon="icon" :width="Math.round((size ?? 36) * 0.55)" />
  </span>
</template>

<style scoped>
.tile {
  flex-shrink: 0;
  border-radius: 8px;
  display: grid;
  place-items: center;
}
.blue {
  background: rgba(32, 128, 240, 0.12);
  color: #1d5bb5;
}
.purple {
  background: rgba(114, 46, 209, 0.1);
  color: #5b3fa8;
}
.green {
  background: rgba(24, 160, 88, 0.12);
  color: #0c6b3b;
}
.orange {
  background: rgba(240, 160, 32, 0.16);
  color: #8a5200;
}
.gray {
  background: rgba(128, 128, 128, 0.12);
  color: inherit;
}
html.dark .blue {
  color: #70c0e8;
}
html.dark .purple {
  color: #b9a2f0;
}
html.dark .green {
  color: #63e2b7;
}
html.dark .orange {
  color: #f2c97d;
}
</style>
