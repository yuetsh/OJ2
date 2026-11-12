<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import type { LabOutput } from '@oj2/contract'
import LabTable from './LabTable.vue'

/** 一步运行出来的东西，按出现的顺序排：print 的文字、表、图。学生页和出题页的预览共用 */
const { outputs, truncated = false } = defineProps<{ outputs: LabOutput[]; truncated?: boolean }>()

const theme = useThemeVars()
</script>

<template>
  <div class="labOutputs">
    <template v-for="(out, i) in outputs" :key="i">
      <pre v-if="out.kind === 'text'" class="text">{{ out.text }}</pre>
      <LabTable v-else-if="out.kind === 'table'" :table="out" />
      <img v-else :src="`data:image/png;base64,${out.png}`" alt="运行画出来的图" class="image" />
    </template>
    <n-text v-if="truncated" depth="3" class="note">打印的东西太多，后面的没显示</n-text>
  </div>
</template>

<style scoped>
.labOutputs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.text {
  margin: 0;
  font-family: Consolas, Monaco, 'Microsoft YaHei', monospace;
  font-size: 15px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 480px;
  overflow: auto;
}

.image {
  display: block;
  max-width: 100%;
  height: auto;
  align-self: flex-start;
  /* 图是白底的，暗色模式下也给它留白底，别让坐标轴的黑字糊进背景 */
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid v-bind('theme.dividerColor');
}

.note {
  font-size: 13px;
}
</style>
