<script setup lang="ts">
import ExerciseResult from "./ExerciseResult.vue"
import type { Exercise, ExerciseGroupData } from "utils/types"
import { shuffle } from "../composables/useShuffle"

const props = defineProps<{ exercise: Exercise; lang?: string }>()
const emit = defineEmits<{
  attempt: [payload: { correct: boolean; answer?: string }]
}>()

const data = computed(() => props.exercise.data as ExerciseGroupData)

const order = ref<number[]>([]) // item 的稳定展示顺序（初始乱序）
const placement = ref<number[]>([]) // placement[itemIdx] = 桶下标，-1 表示在池中
const dragIdx = ref<number | null>(null)
// 手机上没有 HTML5 拖放（触屏不触发 dragstart），所以再给一条点选的路：先点项目、再点分组
const pickedIdx = ref<number | null>(null)
const submitted = ref(false)

function init() {
  order.value = shuffle(data.value.items.map((_, i) => i))
  placement.value = Array(data.value.items.length).fill(-1)
  dragIdx.value = null
  pickedIdx.value = null
  submitted.value = false
}

onMounted(init)
watch(() => props.exercise.id, init)

const allPlaced = computed(() => placement.value.every((p) => p !== -1))
const allCorrect = computed(() => placement.value.every((p, i) => p === data.value.answer[i]))
const locked = computed(() => submitted.value && allCorrect.value)

function onDragStart(i: number) {
  if (locked.value) return
  dragIdx.value = i
  pickedIdx.value = null
}

function dropTo(bucket: number) {
  if (locked.value || dragIdx.value === null) return
  placement.value[dragIdx.value] = bucket
  dragIdx.value = null
  submitted.value = false
}

// 手机上分组框不大，点分组时多半点在框里已有的项目上 —— 这时算「放进它所在的分组」，
// 只有点同一区域里的另一项才是换选
function onItemClick(i: number) {
  if (locked.value) return
  const picked = pickedIdx.value
  if (picked !== null && picked !== i && placement.value[picked] !== placement.value[i]) {
    onAreaClick(placement.value[i])
    return
  }
  pickedIdx.value = picked === i ? null : i
}

function onAreaClick(bucket: number) {
  if (locked.value || pickedIdx.value === null) return
  placement.value[pickedIdx.value] = bucket
  pickedIdx.value = null
  submitted.value = false
}

const poolItems = computed(() => order.value.filter((i) => placement.value[i] === -1))
function itemsIn(bucket: number): number[] {
  return order.value.filter((i) => placement.value[i] === bucket)
}

function itemStatus(i: number): "correct" | "wrong" | "default" {
  if (!submitted.value || placement.value[i] === -1) return "default"
  return placement.value[i] === data.value.answer[i] ? "correct" : "wrong"
}

function chipStyle(i: number): Record<string, string> {
  const status = itemStatus(i)
  const color =
    status === "correct" ? "#18a058" : status === "wrong" ? "#d03050" : "var(--learn-control-line)"
  const plain = color === "var(--learn-control-line)"
  if (pickedIdx.value === i) {
    return {
      padding: "5.5px 11.5px",
      borderRadius: "6px",
      border: "2px solid #2080f0",
      background: "rgba(32,128,240,0.08)",
      cursor: "pointer",
      userSelect: "none",
      fontSize: "15px",
    }
  }
  return {
    padding: "6px 12px",
    borderRadius: "6px",
    border: `1.5px solid ${color}`,
    background: plain ? "var(--learn-pane)" : color + "14",
    cursor: locked.value ? "default" : "grab",
    userSelect: "none",
    fontSize: "15px",
  }
}

function submit() {
  submitted.value = true
  emit("attempt", {
    correct: allCorrect.value,
    answer: `分组 ${placement.value.map((b, i) => `${i + 1}→${b === -1 ? "?" : b + 1}`).join("、")}`,
  })
}

function reset() {
  init()
}
</script>

<template>
  <div>
    <p style="font-weight: 500; font-size: 16px; margin-bottom: 8px">
      {{ data.question }}
    </p>
    <p style="color: var(--learn-muted); font-size: 13px; margin: 0 0 12px">
      把下面的项目拖到对应的分组里，也可以先点项目、再点分组。
    </p>

    <div
      :style="{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        minHeight: '48px',
        padding: '10px',
        border: '1.5px dashed var(--learn-control-line)',
        borderRadius: '8px',
        marginBottom: '14px',
      }"
      @dragover.prevent
      @drop="dropTo(-1)"
      @click="onAreaClick(-1)"
    >
      <span v-if="poolItems.length === 0" style="color: var(--learn-muted); font-size: 13px">
        （已全部归类）
      </span>
      <div
        v-for="i in poolItems"
        :key="i"
        draggable="true"
        :style="chipStyle(i)"
        @dragstart="onDragStart(i)"
        @click.stop="onItemClick(i)"
      >
        {{ data.items[i] }}
      </div>
    </div>

    <div
      :style="{
        display: 'grid',
        gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
        gap: '12px',
      }"
    >
      <div
        v-for="(bucket, b) in data.buckets"
        :key="b"
        :style="{
          minHeight: '88px',
          padding: '10px',
          border: '1.5px solid var(--learn-control-line)',
          borderRadius: '8px',
        }"
        @dragover.prevent
        @drop="dropTo(b)"
        @click="onAreaClick(b)"
      >
        <p style="font-weight: 600; margin: 0 0 8px; text-align: center; font-size: 14px">
          {{ bucket }}
        </p>
        <n-space :size="8">
          <div
            v-for="i in itemsIn(b)"
            :key="i"
            draggable="true"
            :style="chipStyle(i)"
            @dragstart="onDragStart(i)"
            @click.stop="onItemClick(i)"
          >
            {{ data.items[i] }}
          </div>
        </n-space>
      </div>
    </div>

    <ExerciseResult
      v-if="submitted"
      :type="allCorrect ? 'success' : 'error'"
      :title="allCorrect ? '归类全部正确！' : '有归类错误，红色项需要调整'"
    />

    <n-space style="margin-top: 12px" :size="8">
      <n-button type="primary" :disabled="!allPlaced || locked" @click="submit"> 提交 </n-button>
      <n-button @click="reset">重置</n-button>
    </n-space>
  </div>
</template>
