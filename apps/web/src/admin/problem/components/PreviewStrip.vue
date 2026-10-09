<script setup lang="ts">
import { useThemeVars } from "naive-ui"

/**
 * 出题页右栏「学生看到的样子」收起来之后剩下的那一条：竖着贴在右边，点一下展开。
 * 收不收记在本机（usePreviewCollapsed），下次打开出题页照旧
 */
defineEmits<{ expand: [] }>()

const theme = useThemeVars()
</script>

<template>
  <button class="strip" title="展开「学生看到的样子」" @click="$emit('expand')">
    <span class="arrow">‹</span>
    <span class="text">学生看到的样子</span>
  </button>
</template>

<style scoped>
.strip {
  position: sticky;
  top: 12px;
  height: 220px;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.strip:hover {
  color: v-bind("theme.primaryColor");
  border-color: v-bind("theme.primaryColor");
}

.arrow {
  font-size: 16px;
  line-height: 1;
}

.text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

/* 窄屏预览本来就在下面，收起后是横着的一条 */
@media (max-width: 1180px) {
  .strip {
    position: static;
    height: 40px;
    flex-direction: row;
    justify-content: center;
  }

  .arrow {
    transform: rotate(-90deg);
  }

  .text {
    writing-mode: horizontal-tb;
  }
}
</style>
