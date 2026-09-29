<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useCollabStore } from "shared/store/collab"

/**
 * 老师顶栏上的「N 人举手」：前台顶栏和后台顶栏共用这一个。
 *
 * **没人在等就不渲染** —— 平时看不见，冒出来本身就是提醒。人已经在等、又来一个时，
 * 按钮闪一下（约 1 秒、没声音、不挡内容），代替原来每来一个就弹一条的 toast：
 * 那条 toast 一节课能弹十几次，讲台电脑投着屏的时候还弹在全班面前。
 *
 * 求助列表另有一个入口在课堂看板上，没人等的时候真想看「谁在处理」从那边进。
 */
const props = withDefaults(defineProps<{ size?: "medium" | "small" }>(), { size: "medium" })

const collabStore = useCollabStore()
const isDark = useDark()

const count = computed(() => (collabStore.isTeacher ? collabStore.pendingCount : 0))

// 每次变大就换一个 key，让 CSS 动画从头再放一遍；从 0 冒出来那次不闪，出现本身就够显眼
const flashKey = ref(0)
watch(count, (value, previous) => {
  if (value === 0) flashKey.value = 0
  else if (previous > 0 && value > previous) flashKey.value += 1
})

// 暗色下深红底放在暗底上看不清，换一套（和课堂条的做法一样，按明暗各给一组）
const tone = computed(() =>
  isDark.value
    ? {
        bg: "#3a1d24",
        border: "#6b2d3a",
        text: "#f28b9e",
        flash: "#6b2d3a",
        ring: "rgba(242, 139, 158, 0.25)",
      }
    : {
        bg: "#fdecef",
        border: "#f3c1cb",
        text: "#b0213d",
        flash: "#f7b9c6",
        ring: "rgba(208, 48, 80, 0.18)",
      },
)
</script>

<template>
  <button
    v-if="count > 0"
    :key="flashKey"
    type="button"
    class="help"
    :class="[props.size, { flash: flashKey > 0 }]"
    title="打开求助列表"
    @click="collabStore.helpPanelOpen = true"
  >
    <Icon icon="ph:hand" :width="props.size === 'small' ? 14 : 15" />
    <span>{{ count }} 人举手</span>
  </button>
</template>

<style scoped>
.help {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px 0 9px;
  border: 1px solid v-bind("tone.border");
  border-radius: 15px;
  background: v-bind("tone.bg");
  color: v-bind("tone.text");
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.help.small {
  height: 28px;
  border-radius: 14px;
  font-size: 13px;
}

.help.flash {
  animation: flash 1s ease-out;
}

@keyframes flash {
  0%,
  40% {
    background: v-bind("tone.flash");
    box-shadow: 0 0 0 4px v-bind("tone.ring");
  }
  100% {
    background: v-bind("tone.bg");
    box-shadow: 0 0 0 0 transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help.flash {
    animation: none;
  }
}
</style>
