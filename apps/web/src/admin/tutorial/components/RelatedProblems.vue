<script setup lang="ts">
import { Icon } from "@iconify/vue"
import {
  TUTORIAL_PROBLEM_MAX,
  type AdminTutorialProblem,
  type TutorialProblemCandidate,
} from "@oj2/contract"
import { errorMessage } from "utils/api"
import { getTutorialProblemCandidates, setTutorialProblems } from "admin/api"

/**
 * 一课结尾「去做几道题」挑哪几道（设计稿「后台 · 编辑一课」右栏）。
 * 不搜的时候列出必会题，搜的时候必会题排在前面。改了就存，不等页面上的「保存」。
 */
const props = defineProps<{ tutorialId: number; problems: AdminTutorialProblem[] }>()
const emit = defineEmits<{ update: [problems: AdminTutorialProblem[]] }>()
const message = useMessage()

const keyword = ref("")
const candidates = ref<TutorialProblemCandidate[]>([])
const dragIndex = ref<number | null>(null)

const suggestions = computed(() => {
  const picked = new Set(props.problems.map((item) => item.id))
  return candidates.value.filter((item) => !picked.has(item.id)).slice(0, 8)
})

async function search() {
  try {
    candidates.value = await getTutorialProblemCandidates(keyword.value.trim())
  } catch {
    candidates.value = []
  }
}
const searchLater = useDebounceFn(search, 300)
watch(keyword, searchLater)
onMounted(search)

async function save(next: AdminTutorialProblem[]) {
  const before = props.problems
  emit("update", next)
  try {
    await setTutorialProblems(
      props.tutorialId,
      next.map((item) => item.id),
    )
  } catch (err) {
    emit("update", before)
    message.error(errorMessage(err))
  }
}

function add(item: TutorialProblemCandidate) {
  if (props.problems.length >= TUTORIAL_PROBLEM_MAX) {
    message.warning(`一课最多挂 ${TUTORIAL_PROBLEM_MAX} 道`)
    return
  }
  const { tags: _, ...problem } = item
  save([...props.problems, problem])
}

function remove(id: number) {
  save(props.problems.filter((item) => item.id !== id))
}

function drop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === target) return
  const next = [...props.problems]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved!)
  save(next)
}
</script>

<template>
  <div>
    <div class="head">
      <span class="title">相关题</span>
      <span class="muted">{{ problems.length }} 道</span>
    </div>
    <div
      v-for="(problem, index) in problems"
      :key="problem.id"
      class="row"
      draggable="true"
      @dragstart="dragIndex = index"
      @dragover.prevent
      @drop="drop(index)"
    >
      <span class="handle" aria-hidden="true"
        ><Icon icon="ph:dots-six-vertical-bold" :width="14"
      /></span>
      <span class="pid">{{ problem.displayId }}</span>
      <span class="name">{{ problem.title }}</span>
      <span v-if="problem.mustDo" class="must">必会</span>
      <button type="button" class="x" aria-label="移除" @click="remove(problem.id)">
        <Icon icon="ph:x" :width="13" />
      </button>
    </div>
    <n-input v-model:value="keyword" size="small" clearable placeholder="题号或标题" class="search">
      <template #prefix><Icon icon="ph:magnifying-glass" /></template>
    </n-input>
    <div v-if="!keyword.trim()" class="muted hint">必会题</div>
    <div v-for="item in suggestions" :key="item.id" class="row">
      <span class="pid">{{ item.displayId }}</span>
      <span class="name">{{ item.title }}</span>
      <span v-if="item.mustDo" class="must">必会</span>
      <span v-else class="tags">{{ item.tags.join(" · ") }}</span>
      <n-button size="tiny" @click="add(item)">
        <template #icon><Icon icon="ph:plus" /></template>
        加
      </n-button>
    </div>
    <div v-if="keyword.trim() && !suggestions.length" class="muted hint">没找到</div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.title {
  font-weight: 700;
}
.muted {
  opacity: 0.6;
  font-size: 13px;
}
.row {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}
.handle {
  display: flex;
  opacity: 0.45;
  cursor: grab;
}
.pid {
  width: 34px;
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.must {
  height: 20px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  background: rgba(240, 160, 32, 0.16);
  color: #8a5200;
}
html.dark .must {
  color: #f2c97d;
}
.tags {
  font-size: 12px;
  opacity: 0.55;
  white-space: nowrap;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.x {
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  display: flex;
  padding: 4px;
  cursor: pointer;
}
.x:hover {
  opacity: 1;
}
.search {
  margin: 10px 0 4px;
}
.hint {
  font-size: 12px;
  margin: 8px 0 2px;
}
</style>
