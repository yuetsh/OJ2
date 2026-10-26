<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { caseRevealStep } from "../utils/caseReveal"

/**
 * 每组测试点一个方块：对的绿、错的红并写上第几组（设计稿「测试点亮起来」）。
 * `animate` 时从左往右一格一格亮，亮完发 done；不播就一下全亮、马上发 done。
 * 只在挂上的那一刻看 animate —— 播到一半它变了也不打断。
 */
const props = defineProps<{
  results: boolean[]
  animate: boolean
}>()
const emit = defineEmits<{ (e: "done"): void }>()

const theme = useThemeVars()
const shown = ref(props.animate ? 0 : props.results.length)
const playing = ref(props.animate)

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (!props.animate) {
    emit("done")
    return
  }
  timer = setInterval(() => {
    shown.value++
    if (shown.value >= props.results.length) {
      stop()
      emit("done")
    }
  }, caseRevealStep(props.results.length))
})
function stop() {
  if (timer) clearInterval(timer)
  timer = null
  playing.value = false
}
onBeforeUnmount(stop)

const failed = computed(() => props.results.flatMap((passed, i) => (passed ? [] : [i + 1])))
const label = computed(() => {
  const passed = props.results.length - failed.value.length
  const wrong = failed.value.length ? `，第 ${failed.value.join("、")} 组错了` : ""
  return `${props.results.length} 组测试点通过 ${passed} 组${wrong}`
})
</script>

<template>
  <div class="blocks" role="img" :aria-label="label">
    <span
      v-for="(passed, i) in results"
      :key="i"
      class="block"
      :class="{
        wait: i >= shown,
        ok: i < shown && passed,
        bad: i < shown && !passed,
        now: playing && i === shown - 1,
      }"
      >{{ i < shown && !passed ? i + 1 : "" }}</span
    >
  </div>
</template>

<style scoped>
.blocks {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.block {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.block.wait {
  background-color: v-bind("theme.dividerColor");
}

.block.ok {
  background-color: v-bind("theme.successColor");
}

.block.bad {
  background-color: v-bind("theme.errorColor");
  color: #fff;
}

/* 刚亮的那格外面一圈，看得出「亮到哪了」 */
.block.now {
  box-shadow:
    0 0 0 2px v-bind("theme.cardColor"),
    0 0 0 4px v-bind("theme.successColorSuppl");
}

.block.now.bad {
  box-shadow:
    0 0 0 2px v-bind("theme.cardColor"),
    0 0 0 4px v-bind("theme.errorColorSuppl");
}
</style>
