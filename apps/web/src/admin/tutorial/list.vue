<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { errorMessage } from "utils/api"
import type { TutorialListItem } from "utils/types"
import { groupByProject, splitTitle, type TutorialType } from "oj/learn/lesson"
import ProjectTile from "oj/learn/components/ProjectTile.vue"
import "oj/learn/learn.css"
import {
  getTutorialList,
  renameTutorialProject,
  reorderTutorials,
  setTutorialVisibility,
} from "../api"

/**
 * 教程列表（设计稿「后台 · 教程列表」）：按项目分组，拖动排序；每课看得到几道练一练、
 * 挑没挑相关题、多少学生打开过。整组都没公开、又没填项目的（老教程）收起来放最后。
 */
const router = useRouter()
const route = useRoute()
const message = useMessage()

const type = ref<TutorialType>(route.query.type === "c" ? "c" : "python")
const all = ref<{ [key: string]: TutorialListItem[] }>({ python: [], c: [] })
const collapsed = ref(new Set<string>())
const renaming = ref<string | null>(null)
const renameTo = ref("")
const dragId = ref<number | null>(null)
const showNewProject = ref(false)
const newProject = ref("")

const list = computed(() => all.value[type.value] ?? [])
const groups = computed(() =>
  groupByProject(list.value)
    .map((group) => {
      const items = group.lessons.map((lesson) => list.value.find((item) => item.id === lesson.id)!)
      return {
        ...group,
        items,
        key: `${group.project}:${group.lessons[0]!.id}`,
        hidden: items.every((item) => !item.isPublic),
      }
    })
    // 整组没公开、又没项目的老教程放到最后，别压在正在用的课上面
    .sort((a, b) => Number(a.hidden && !a.project) - Number(b.hidden && !b.project)),
)
/** 学生那边看到的序号：只数公开的 */
const publicStep = computed(() => {
  const steps = new Map<number, number>()
  list.value.filter((item) => item.isPublic).forEach((item, index) => steps.set(item.id, index + 1))
  return steps
})

async function load() {
  all.value = await getTutorialList()
  // 整组没公开又没项目的（老教程）默认收起
  collapsed.value = new Set(
    groups.value.filter((group) => group.hidden && !group.project).map((group) => group.key),
  )
}

function pickType(value: TutorialType) {
  type.value = value
  router.replace({ query: { type: value } })
  load()
}

function toggle(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

async function toggleVisible(item: TutorialListItem) {
  item.isPublic = !item.isPublic
  try {
    await setTutorialVisibility(item.id, item.isPublic)
  } catch (err) {
    item.isPublic = !item.isPublic
    message.error(errorMessage(err))
  }
}

function startRename(project: string) {
  renaming.value = project
  renameTo.value = project
}

async function saveRename() {
  const from = renaming.value
  const to = renameTo.value.trim()
  renaming.value = null
  if (from === null || !to || to === from) return
  try {
    await renameTutorialProject(type.value, from, to)
    await load()
  } catch (err) {
    message.error(errorMessage(err))
  }
}

/** 拖动只在同一个项目里排：换项目到编辑页里改，免得一拖把课拖进别的项目 */
async function drop(target: TutorialListItem) {
  const from = list.value.find((item) => item.id === dragId.value)
  dragId.value = null
  if (!from || from.id === target.id) return
  if (from.project !== target.project) {
    message.warning("只能在同一个项目里拖，换项目请到编辑页里改")
    return
  }
  const ids = list.value.map((item) => item.id).filter((id) => id !== from.id)
  const at = ids.indexOf(target.id)
  const fromIndex = list.value.findIndex((item) => item.id === from.id)
  const targetIndex = list.value.findIndex((item) => item.id === target.id)
  ids.splice(fromIndex < targetIndex ? at + 1 : at, 0, from.id)
  // 先在本地换好位置，拖完立刻看到
  const byId = new Map(list.value.map((item) => [item.id, item]))
  all.value = {
    ...all.value,
    [type.value]: ids.map((id, index) => ({ ...byId.get(id)!, order: index + 1 })),
  }
  try {
    await reorderTutorials(ids)
  } catch (err) {
    message.error(errorMessage(err))
    await load()
  }
}

function createIn(project: string) {
  router.push({ name: "admin tutorial create", query: { type: type.value, project } })
}

function confirmNewProject() {
  const name = newProject.value.trim()
  if (!name) return
  showNewProject.value = false
  newProject.value = ""
  createIn(name)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="top">
      <span class="title">教程</span>
      <div class="seg">
        <button type="button" :class="{ on: type === 'python' }" @click="pickType('python')">
          Python
        </button>
        <button type="button" :class="{ on: type === 'c' }" @click="pickType('c')">C 语言</button>
      </div>
      <span class="grow" />
      <n-button @click="showNewProject = true">
        <template #icon><Icon icon="ph:plus" /></template>
        新建项目
      </n-button>
      <n-button type="primary" @click="createIn('')">
        <template #icon><Icon icon="ph:plus" /></template>
        新建一课
      </n-button>
    </div>

    <section class="table">
      <div class="row headrow">
        <span class="c-drag" />
        <span class="c-no">#</span>
        <span class="c-title">知识点 · 情境</span>
        <span class="c-num c-ex">练一练</span>
        <span class="c-num">相关题</span>
        <span class="c-num wide">打开过的人</span>
        <span class="c-switch">公开</span>
        <span class="c-edit" />
      </div>
      <template v-for="group in groups" :key="group.key">
        <!-- 整行都能点开合；行里的改名、加一课自己拦住，不顺带开合 -->
        <div class="row grouprow" @click="toggle(group.key)">
          <button
            type="button"
            class="fold"
            :aria-label="collapsed.has(group.key) ? '展开' : '收起'"
          >
            <Icon
              :icon="collapsed.has(group.key) ? 'ph:caret-right-bold' : 'ph:caret-down-bold'"
              :width="13"
            />
          </button>
          <ProjectTile :icon="group.icon" :tone="group.tone" :size="26" />
          <span v-if="renaming === group.project && group.project" class="rename" @click.stop>
            <n-input
              v-model:value="renameTo"
              size="small"
              style="width: 280px"
              autofocus
              @keyup.enter="saveRename"
              @keyup.esc="renaming = null"
            />
            <n-button size="small" type="primary" @click="saveRename">保存</n-button>
            <n-button size="small" quaternary @click="renaming = null">取消</n-button>
          </span>
          <template v-else>
            <span class="group-name">{{
              group.project || (group.hidden ? "没公开" : "没有项目")
            }}</span>
            <span class="muted">{{ group.items.length }} 课</span>
            <a v-if="group.project" href="#" @click.stop.prevent="startRename(group.project)"
              >改名</a
            >
            <a href="#" @click.stop.prevent="createIn(group.project)">加一课</a>
          </template>
        </div>
        <template v-if="!collapsed.has(group.key)">
          <div
            v-for="item in group.items"
            :key="item.id"
            class="row lesson"
            :class="{ off: !item.isPublic, dragging: dragId === item.id }"
            draggable="true"
            @dragstart="dragId = item.id"
            @dragend="dragId = null"
            @dragover.prevent
            @drop="drop(item)"
          >
            <span class="c-drag handle" aria-hidden="true"
              ><Icon icon="ph:dots-six-vertical-bold" :width="16"
            /></span>
            <span class="c-no num muted">{{ publicStep.get(item.id) ?? "—" }}</span>
            <span class="c-title">
              <span class="kp">{{ splitTitle(item.title).kp }}</span>
              <span class="scene">{{ splitTitle(item.title).scene }}</span>
            </span>
            <span class="c-num c-ex num">{{ item.exerciseCount || "-" }}</span>
            <span class="c-num num">
              <template v-if="item.problemCount">{{ item.problemCount }}</template>
              <span v-else class="warn">还没挑</span>
            </span>
            <span class="c-num wide num">{{ item.readers }}</span>
            <span class="c-switch">
              <n-switch
                :value="item.isPublic"
                size="small"
                :rubber-band="false"
                @update:value="toggleVisible(item)"
              />
            </span>
            <router-link
              :to="{ name: 'admin tutorial edit', params: { tutorialID: item.id } }"
              class="c-edit"
            >
              编辑
            </router-link>
          </div>
        </template>
      </template>
    </section>

    <n-modal v-model:show="showNewProject" preset="card" title="新建项目" style="width: 420px">
      <n-input
        v-model:value="newProject"
        placeholder="项目五 · 智慧物流·仓储管理"
        maxlength="64"
        @keyup.enter="confirmNewProject"
      />
      <template #footer>
        <n-flex justify="end">
          <n-button @click="showNewProject = false">取消</n-button>
          <n-button type="primary" :disabled="!newProject.trim()" @click="confirmNewProject">
            接着写第一课
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  font-size: 20px;
  font-weight: 700;
}
.seg {
  display: flex;
  margin-left: 8px;
}
.seg button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.seg button:first-child {
  border-radius: 4px 0 0 4px;
}
.seg button:last-child {
  border-radius: 0 4px 4px 0;
  margin-left: -1px;
}
.seg button.on {
  border-color: #18a058;
  color: var(--learn-green-text);
  font-weight: 600;
  position: relative;
}
.grow {
  flex: 1;
}
.muted {
  opacity: 0.6;
  font-size: 13px;
}
.num {
  font-variant-numeric: tabular-nums;
}
.table {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 44px;
  padding: 0 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
.headrow {
  height: 38px;
  border-top: 0;
  font-size: 12px;
  opacity: 0.6;
}
.grouprow {
  gap: 10px;
  cursor: pointer;
  background: rgba(128, 128, 128, 0.06);
  border-top-color: rgba(128, 128, 128, 0.22);
}
.grouprow a {
  font-size: 13px;
  color: #18a058;
  text-decoration: none;
}
.fold {
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  padding: 2px;
  opacity: 0.55;
  cursor: pointer;
}
.rename {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: auto;
}
.group-name {
  font-weight: 700;
}
.lesson.off {
  opacity: 0.6;
}
.lesson.dragging {
  opacity: 0.35;
}
.handle {
  display: flex;
  opacity: 0.4;
  cursor: grab;
}
.c-drag {
  width: 16px;
}
.c-no {
  width: 22px;
  font-size: 13px;
}
.c-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.kp {
  font-weight: 600;
  white-space: nowrap;
}
.scene {
  font-size: 13px;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-num {
  width: 70px;
  text-align: right;
  font-size: 13px;
}
.c-num.wide {
  width: 80px;
}
.warn {
  color: var(--learn-orange-text);
}
.c-switch {
  width: 60px;
  display: flex;
  justify-content: center;
}
.c-edit {
  width: 40px;
  text-align: right;
  font-size: 13px;
  color: #18a058;
  text-decoration: none;
}

/* 手机：拖动排序（触屏拖不动）、练一练数、打开过的人、情境都不摆，留 知识点 / 相关题 / 公开 / 编辑 */
@media (max-width: 768px) {
  .top {
    flex-wrap: wrap;
    gap: 8px;
  }
  .title,
  .seg button {
    white-space: nowrap;
  }
  .row {
    gap: 8px;
    padding: 0 12px;
  }
  .grouprow {
    flex-wrap: wrap;
    height: auto;
    min-height: 44px;
    padding: 8px 12px;
  }
  .grouprow a {
    white-space: nowrap;
  }
  .c-drag,
  .c-ex,
  .c-num.wide,
  .scene {
    display: none;
  }
  .kp {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-num {
    width: 48px;
  }
  .c-switch {
    width: 44px;
  }
  .c-edit {
    width: auto;
    white-space: nowrap;
  }
}
</style>
