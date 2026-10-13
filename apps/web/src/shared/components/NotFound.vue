<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import type { RouteLocationRaw } from "vue-router"

/**
 * 「找不到」的整页提示：地址打错、题目 / 比赛 / 题单不存在或没公开、比赛还没开始。
 * 原来各页各写各的 —— 打错地址是一整页空白、题号不对只有一个「无数据」，学生看不出出了什么事。
 * 样子跟提交详情的「这条提交不存在」一致：图标、一句话、一句为什么、一个回去的按钮。
 */
const props = withDefaults(
  defineProps<{
    title: string
    hint?: string
    icon?: string
    to?: RouteLocationRaw
    toLabel?: string
  }>(),
  { hint: "", icon: "ph:magnifying-glass", to: "/", toLabel: "回首页" },
)

const theme = useThemeVars()
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <Icon :icon="props.icon" :width="40" class="icon" />
    <span class="title">{{ props.title }}</span>
    <span v-if="props.hint" class="hint">{{ props.hint }}</span>
    <div class="actions">
      <slot>
        <n-button type="primary" @click="router.push(props.to)">{{ props.toLabel }}</n-button>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 16px;
  text-align: center;
}

.icon {
  color: v-bind("theme.textColor3");
  opacity: 0.7;
}

.title {
  font-size: 18px;
  font-weight: 600;
}

.hint {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
</style>
