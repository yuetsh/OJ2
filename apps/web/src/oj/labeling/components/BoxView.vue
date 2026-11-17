<script setup lang="ts">
import type { LabelingBox } from '@oj2/contract'
import { labelStroke } from '../utils/colors'
import LabelingImage from './LabelingImage.vue'

/**
 * 框选只读的一张图：图上画出框（错题页的「应该是 / 你第一次框的」、后台缩略图、全班情况都用它）。
 * `chips` 关掉时框上不写类别名，只靠颜色（缩略图太小，写了字反而挡图）。
 */
const props = withDefaults(defineProps<{ labelingId: number; itemId: number; boxes: LabelingBox[]; labels: string[]; chips?: boolean }>(), { chips: true })

/** 图加载出来再画框，不然框会画在转圈的占位上 */
const ready = ref(false)
watch(
  () => props.itemId,
  () => (ready.value = false),
)
</script>

<template>
  <div class="boxView" @load.capture="ready = true">
    <LabelingImage :labeling-id="labelingId" :item-id="itemId" />
    <template v-if="ready">
      <div
        v-for="(box, i) in boxes"
        :key="i"
        class="box"
        :class="{ thin: !chips }"
        :style="{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`,
          borderColor: labelStroke(labels, box.label),
        }"
      >
        <span v-if="chips" class="chip" :class="{ inside: box.y < 0.06 }" :style="{ background: labelStroke(labels, box.label) }">{{ box.label }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.boxView {
  position: relative;
}

.boxView :deep(.labelingImage) {
  height: auto;
  border-radius: 4px;
}

.box {
  position: absolute;
  box-sizing: border-box;
  border: 2.5px solid;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75);
  pointer-events: none;
}

.box.thin {
  border-width: 2px;
}

.chip {
  position: absolute;
  left: -2.5px;
  bottom: 100%;
  height: 17px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 600;
  color: #ffffff;
  border-radius: 3px 3px 0 0;
  white-space: nowrap;
}

.chip.inside {
  bottom: auto;
  top: 0;
  left: 0;
  border-radius: 0 0 3px 0;
}
</style>
