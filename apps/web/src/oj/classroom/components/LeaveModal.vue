<script setup lang="ts">
import type { ClassBoardStudent } from "utils/types"

/**
 * 看板的「请假」框：勾今天不在的人。规则在看板那边（只有今天还没交过的人能算请假、
 * 交了题或举手就自动算到，见 board.vue 的 canLeave），这里只管勾。
 */
const props = defineProps<{
  /** 能勾的人：今天还没交过的（刚上课时就是全班），按名字排好 */
  candidates: ClassBoardStudent[]
  /** 打开时已经标着请假的 */
  current: string[]
}>()
const emit = defineEmits<{ save: [usernames: string[]] }>()
const show = defineModel<boolean>("show", { required: true })

const selected = ref<string[]>([])
watch(show, (open) => {
  if (open) selected.value = [...props.current]
})

/**
 * 今天一次都没上过线。机房有两人共用一台电脑的，同桌只有一个登着，所以「谁没来」
 * 看今天上没上过线，不看此刻在不在线（见契约 seenAt）
 */
const unseen = (student: ClassBoardStudent | undefined) => !!student && !student.seenAt

/** 今天没上过线的分在前面一堆：请假的人基本在这里面，剩下的是和同桌共用电脑的 */
const sections = computed(() =>
  [
    { label: "今天没上线", students: props.candidates.filter(unseen) },
    {
      label: "今天上过线",
      students: props.candidates.filter((student) => !unseen(student)),
    },
  ].filter((section) => section.students.length),
)

function selectAll(list: ClassBoardStudent[]) {
  selected.value = [...new Set([...selected.value, ...list.map((student) => student.username)])]
}

function save() {
  emit("save", selected.value)
  show.value = false
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="
      candidates.length
        ? `今天还没交过的 ${candidates.length} 人里，谁请假了？`
        : '今天全班都交过题了'
    "
    style="width: 640px; max-width: calc(100vw - 32px)"
  >
    <n-checkbox-group v-if="candidates.length" v-model:value="selected">
      <div v-for="section in sections" :key="section.label" class="leave-section">
        <div v-if="sections.length > 1 || unseen(section.students[0])" class="leave-head">
          {{ section.label }} {{ section.students.length }} 人
          <n-button
            v-if="unseen(section.students[0])"
            text
            type="primary"
            :disabled="section.students.every((student) => selected.includes(student.username))"
            @click="selectAll(section.students)"
          >
            全勾上
          </n-button>
        </div>
        <div class="leave-grid">
          <n-checkbox
            v-for="student in section.students"
            :key="student.userId"
            :value="student.username"
            :label="student.username"
            class="leave-option"
          />
        </div>
      </div>
    </n-checkbox-group>
    <n-text v-else depth="3">请假的人一定是没交过题的，现在没有人可以标。</n-text>
    <template #footer>
      <n-flex align="center" :wrap="false">
        <n-text depth="3" class="meta" style="flex-grow: 1">
          已选 {{ selected.length }} 人 · 只记在这台电脑上，今天有效
        </n-text>
        <n-button :disabled="!selected.length" @click="selected = []">全部取消</n-button>
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" @click="save">确定</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.leave-section + .leave-section {
  margin-top: 18px;
}

.leave-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-weight: 600;
}

.leave-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px 8px;
}

.leave-option {
  font-size: 15px;
}

.meta {
  font-size: var(--oj-fs-sec);
}
</style>
