<script setup lang="ts">
import { getClassBoard, setClassLesson } from "oj/api"
import { useHiddenStudents } from "shared/composables/hiddenStudents"
import { useCollabStore } from "shared/store/collab"
import { useConfigStore } from "shared/store/config"
import { errorMessage } from "utils/api"
import { parseTime } from "utils/functions"
import type { ClassBoard, ClassBoardCell, ClassBoardStudent } from "utils/types"

/**
 * 课堂看板（老师）：这个班、今天、这节课的几道题 × 全班学生。
 *
 * 重点是「今天还没交过」的那批人，不是「卡住的」：2025 秋平均每节课有 14 个平时在用的
 * 学生一道都没交（占三分之一），交了 3 次以上还没过的平均不到 1 个。所以排序是
 * 没交过 → 卡住 → 在做 → 做完，没交过的名单还单独摆在最上面，老师扫一眼就能走过去。
 *
 * 班级**不记本地**，默认由后端猜最近两小时在交题的班 —— 记本地的话，上一节课的班会
 * 悄悄留在框里，老师看的整个是别人的班。（原来的提交统计弹窗是记一小时的，
 * 那边是老师自己手选的查询；这里后端本来就猜得出，没必要冒这个险。）
 */

/** 同一道题今天交了这么多次还没过，算卡住 */
const STUCK_ATTEMPTS = 3
const REFRESH_MS = 15_000

const configStore = useConfigStore()
const collabStore = useCollabStore()
const message = useMessage()

const board = ref<ClassBoard | null>(null)
const className = ref<string | null>(null)
const loading = ref(false)
const updatedAt = ref<Date | null>(null)
const projector = ref(false)

const lessonInput = ref("")
const saving = ref(false)

function classLabel(name: string) {
  return /^\d{3,}$/.test(name) ? `${name.slice(0, 2)}计算机${name.slice(2)}班` : name
}

const classOptions = computed(() => {
  const list = configStore.config?.classList ?? []
  const names =
    board.value?.className && !list.includes(board.value.className)
      ? [board.value.className, ...list]
      : list
  return names.map((name) => ({ label: classLabel(name), value: name }))
})

async function load() {
  if (document.hidden) return
  loading.value = true
  try {
    const data = await getClassBoard(className.value ?? undefined)
    board.value = data
    // 第一次由后端猜，之后就固定在这个班上，别每次刷新都换
    className.value = data.className
    updatedAt.value = new Date()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

// 换了班要把输入框换成那个班今天布置的题
watch(
  () => [board.value?.className, board.value?.source] as const,
  () => {
    lessonInput.value =
      board.value?.source === "teacher"
        ? board.value.problems.map((problem) => problem.problemDisplayId).join(" ")
        : ""
  },
)

function changeClass(value: string) {
  className.value = value
  load()
}

async function saveLesson() {
  if (!className.value) return
  const ids = lessonInput.value.split(/[\s,，、;；]+/).filter(Boolean)
  saving.value = true
  try {
    await setClassLesson(className.value, ids)
    message.success(ids.length ? "已布置，学生首页会显示这几道题" : "已清掉，学生那边改回自动推断")
    await load()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(load)
const { pause } = useIntervalFn(load, REFRESH_MS)
onUnmounted(pause)

// ---------- 分组与排序 ----------

type Group = "help" | "idle" | "stuck" | "working" | "done"

/**
 * 正在课堂求助的学生。列表是老师端 WebSocket 实时推的（collabStore，全局常驻连接），
 * 不经看板接口 —— 求助只在 serve 进程的内存里，本来就不落库。所以也只看得到连着
 * **本站**的学生：服务器和机房各有各的求助队列，和课堂求助本身一样。
 */
function helpOf(student: ClassBoardStudent) {
  return collabStore.requests.find((request) => request.studentId === student.userId) ?? null
}

/**
 * 经常不动手：最近几节课里最多只交过一节。至少有 3 节课可比才下结论，
 * 开学头两节谁都一样。只给老师看，投影模式里不出现。
 */
function oftenIdle(student: ClassBoardStudent) {
  const total = board.value?.recentLessons ?? 0
  return total >= 3 && student.recentAttended <= 1
}

function groupOf(student: ClassBoardStudent): Group {
  if (helpOf(student)) return "help"
  const cells = student.cells
  if (cells.length && cells.every((cell) => cell.status === "accepted")) return "done"
  if (!student.lastSubmitAt) return "idle"
  if (cells.some((cell) => cell.status === "tried" && cell.attempts >= STUCK_ATTEMPTS))
    return "stuck"
  return "working"
}

const GROUP_ORDER: Record<Group, number> = { help: 0, idle: 1, stuck: 2, working: 3, done: 4 }

function nameOf(student: ClassBoardStudent) {
  return student.realName || student.username
}

/**
 * 请假隐藏（原来在「数据统计」弹框里，统计改成回头看之后挪到这儿 —— 盯这节课的是看板）。
 * 请假、转班、学号错了的那几个一直挂在「还没交过」里，会盖住真正要去看的人。
 * 藏两个小时（够一节课），下节课自动回来；只记在这台电脑上，换人换机器都不继承。
 * 键沿用统计弹框那份，老师上午藏的人这里接着藏着。
 *
 * **只藏「还没交过」的人**：一个学生只要今天交过、或者正在举手，就不算请假，照常显示、
 * 照常算进人数。迟到的学生后来交了题、卡住了、举手了，老师得看得见
 */
const { hideMode, hideStudent, unhide, isHidden } = useHiddenStudents("oj_hidden_students")
function hiddenNow(student: ClassBoardStudent) {
  return !student.lastSubmitAt && !helpOf(student) && isHidden(student.username)
}
const hiddenStudents = computed(() => (board.value?.students ?? []).filter(hiddenNow))
function restoreHidden() {
  unhide(hiddenStudents.value.map((student) => student.username))
}

const students = computed(() =>
  [...(board.value?.students ?? [])]
    .filter((student) => !isHidden(student.username))
    .sort(
      (a, b) =>
        GROUP_ORDER[groupOf(a)] - GROUP_ORDER[groupOf(b)] ||
        // 同样是没交过，经常不动手的排前面
        Number(oftenIdle(b)) - Number(oftenIdle(a)) ||
        nameOf(a).localeCompare(nameOf(b), "zh-CN"),
    ),
)

const idle = computed(() => students.value.filter((student) => groupOf(student) === "idle"))
const idleOften = computed(() => idle.value.filter(oftenIdle))
const idleOthers = computed(() => idle.value.filter((student) => !oftenIdle(student)))
const helpNames = computed(() =>
  students.value
    .filter((student) => groupOf(student) === "help")
    .map(nameOf)
    .join("、"),
)
const helpCount = computed(
  () => students.value.filter((student) => groupOf(student) === "help").length,
)
const stuckCount = computed(
  () => students.value.filter((student) => groupOf(student) === "stuck").length,
)

const summary = computed(() => {
  // 分母也减掉请假的，不然「做完 30/38」永远到不了头
  const all = students.value
  return (board.value?.problems ?? []).map((problem, i) => ({
    ...problem,
    done: all.filter((student) => student.cells[i]?.status === "accepted").length,
    total: all.length,
  }))
})

/** 今天之前就通过了的，显示「之前」而不是一个日期 */
function cellText(cell: ClassBoardCell) {
  if (cell.status === "accepted") {
    const day = cell.acceptedAt ? parseTime(cell.acceptedAt, "YYYY-MM-DD") : ""
    return day === board.value?.day ? `✓ ${parseTime(cell.acceptedAt!, "HH:mm")}` : "✓ 之前"
  }
  if (cell.status === "tried") return cell.attempts ? `✗ ${cell.attempts} 次` : "✗ 之前"
  return "·"
}

function cellClass(cell: ClassBoardCell) {
  if (cell.status === "accepted") return "cell-done"
  if (cell.status === "tried") return cell.attempts >= STUCK_ATTEMPTS ? "cell-stuck" : "cell-tried"
  return "cell-none"
}

const GROUP_LABEL: Record<
  Group,
  { text: string; type: "default" | "error" | "warning" | "info" | "success" }
> = {
  help: { text: "在求助", type: "warning" },
  idle: { text: "没交过", type: "default" },
  stuck: { text: "卡住了", type: "error" },
  working: { text: "在做", type: "info" },
  done: { text: "做完了", type: "success" },
}

const router = useRouter()

/**
 * 点格子 / 名字到提交列表看他今天交的。新标签打开：看板多半正投在屏幕上，别把它顶掉。
 * 用户名按整名匹配（学号互相包含是常态，ks24a1 会混进 ks24a10）。
 *
 * 今天只画了流程图、没写代码的，跳到列表的「流程图」那边 —— 不然这节课整班在画流程图时，
 * 点进去是一片「没有符合条件的提交」
 */
function submissionsHref(
  student: ClassBoardStudent,
  problemDisplayId: string | undefined,
  flowchart: boolean,
) {
  return router.resolve({
    name: "submissions",
    query: {
      username: student.username,
      exactUsername: "1",
      today: "1",
      ...(flowchart ? { language: "Flowchart" } : {}),
      ...(problemDisplayId ? { problem: problemDisplayId } : {}),
    },
  }).href
}
</script>

<template>
  <div class="board" :class="{ projector }">
    <n-flex align="center" justify="space-between" class="toolbar">
      <n-flex align="center">
        <h2 class="title">课堂看板</h2>
        <n-select
          :value="className"
          :options="classOptions"
          placeholder="选择班级"
          filterable
          style="width: 180px"
          @update:value="changeClass"
        />
      </n-flex>
      <n-flex align="center">
        <n-text depth="3" class="meta">
          每 15 秒刷新<template v-if="updatedAt">
            · {{ parseTime(updatedAt, "HH:mm:ss") }}</template
          >
        </n-text>
        <n-button :loading="loading" @click="load">刷新</n-button>
        <!-- 看板只管今天；以前几节课的、任意时间段的去数据统计（带上这个班） -->
        <n-button
          v-if="!projector"
          @click="router.push({ name: 'statistics', query: className ? { className } : {} })"
        >
          回头看 →
        </n-button>
        <n-button :type="projector ? 'primary' : 'default'" @click="projector = !projector">
          {{ projector ? "退出投影" : "投影模式" }}
        </n-button>
      </n-flex>
    </n-flex>

    <n-empty
      v-if="board && !board.className"
      description="最近两小时没有哪个班在交题，先在上面选一个班"
      style="margin: 60px 0"
    />

    <template v-else-if="board">
      <!-- 布置题目：投影时收起来 -->
      <n-card v-if="!projector" size="small" class="section">
        <n-flex align="center" :wrap="false">
          <n-text strong style="flex-shrink: 0">这节课的题</n-text>
          <n-input
            v-model:value="lessonInput"
            placeholder="输入题号，用空格隔开，比如 8019 8020 8021"
            clearable
            @keyup.enter="saveLesson"
          />
          <n-button type="primary" :loading="saving" @click="saveLesson">布置</n-button>
        </n-flex>
        <n-text depth="3" class="meta">
          <template v-if="board.source === 'teacher'">
            学生首页的「班里在做」显示的就是这几道。清空再点布置就改回自动推断。
          </template>
          <template v-else-if="board.source === 'inferred'">
            还没布置。下面这几道是按今天的提交记录推断的（同班 5 人以上做过的题）。
          </template>
          <template v-else>
            布置之后，学生打开首页就能看到这几道题，没听清题号的也能找到。
          </template>
        </n-text>
      </n-card>

      <!-- 求助和布没布置题无关，放在「还没有题」的判断外面；投影时不出名字，这条也收起来 -->
      <n-alert
        v-if="helpCount && !projector"
        type="info"
        :title="`有 ${helpCount} 人在求助：${helpNames}`"
        class="section"
      >
        <n-button size="small" @click="collabStore.helpPanelOpen = true">打开求助列表</n-button>
      </n-alert>

      <n-empty
        v-if="!board.problems.length"
        description="还没有题：在上面输入这节课的题号"
        style="margin: 40px 0"
      />

      <template v-else>
        <!-- 每道题的完成度。投影模式下只剩这一块，不出现名字 -->
        <div class="summary">
          <div v-for="problem in summary" :key="problem.problemId" class="summary-item">
            <div class="summary-title">{{ problem.problemDisplayId }} {{ problem.title }}</div>
            <n-progress
              type="line"
              status="success"
              :percentage="problem.total ? Math.round((problem.done / problem.total) * 100) : 0"
              :show-indicator="false"
              :height="projector ? 28 : 10"
            />
            <div class="summary-count">{{ problem.done }} / {{ problem.total }} 人做完</div>
          </div>
        </div>

        <template v-if="!projector">
          <n-alert
            v-if="idle.length || hiddenStudents.length"
            type="warning"
            :title="idle.length ? `今天还没交过（${idle.length} 人）` : '今天没交过的都隐藏了'"
            class="section"
          >
            <n-flex align="center" :size="10" class="hide-bar">
              <n-switch v-model:value="hideMode" size="small">
                <template #checked>请假隐藏中 · 点名字旁的 × 藏起来</template>
                <template #unchecked>请假隐藏</template>
              </n-switch>
              <n-button
                v-if="hiddenStudents.length"
                size="tiny"
                text
                type="primary"
                @click="restoreHidden"
              >
                隐藏了 {{ hiddenStudents.length }} 位：{{ hiddenStudents.map(nameOf).join("、") }} ·
                恢复
              </n-button>
            </n-flex>
            <n-flex v-if="hideMode" :size="8">
              <n-tag
                v-for="student in idle"
                :key="student.userId"
                closable
                @close="hideStudent(student.username)"
              >
                {{ nameOf(student) }}
              </n-tag>
            </n-flex>
            <template v-else>
              <div v-if="idleOften.length">
                <b>经常没交</b>（最近 {{ board.recentLessons }} 节课最多交过 1 节）：{{
                  idleOften.map(nameOf).join("、")
                }}
              </div>
              <div v-if="idleOthers.length">
                <template v-if="idleOften.length"><b>其他</b>：</template
                >{{ idleOthers.map(nameOf).join("、") }}
              </div>
            </template>
          </n-alert>

          <n-text v-if="stuckCount" type="error" class="meta">
            有 {{ stuckCount }} 人卡住了（同一道题今天交了
            {{ STUCK_ATTEMPTS }} 次以上还没过），有题的话排在表格最前面
          </n-text>

          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th class="name">学生</th>
                  <th>状态</th>
                  <th v-for="problem in board.problems" :key="problem.problemId">
                    <router-link :to="`/problem/${problem.problemDisplayId}`" class="plain">
                      {{ problem.problemDisplayId }}
                    </router-link>
                  </th>
                  <th>最后提交</th>
                  <th>最近 {{ board.recentLessons }} 节</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="student in students" :key="student.userId">
                  <td class="name">
                    <a
                      v-if="student.codeToday || student.drawnToday"
                      class="cell-link"
                      :href="submissionsHref(student, undefined, !student.codeToday)"
                      target="_blank"
                      :title="`看 ${nameOf(student)} 今天交的全部`"
                    >
                      {{ nameOf(student) }}
                    </a>
                    <template v-else>{{ nameOf(student) }}</template>
                  </td>
                  <td>
                    <n-tag
                      size="small"
                      :bordered="false"
                      :type="GROUP_LABEL[groupOf(student)].type"
                      :class="{ 'help-tag': helpOf(student) }"
                      @click="helpOf(student) && (collabStore.helpPanelOpen = true)"
                    >
                      {{
                        helpOf(student)
                          ? helpOf(student)!.status === "active"
                            ? "老师在帮"
                            : "举手了"
                          : GROUP_LABEL[groupOf(student)].text
                      }}
                    </n-tag>
                  </td>
                  <td v-for="(cell, i) in student.cells" :key="i" :class="cellClass(cell)">
                    <a
                      v-if="cell.attempts"
                      class="cell-link"
                      :href="
                        submissionsHref(
                          student,
                          board.problems[i]!.problemDisplayId,
                          !cell.codeAttempts,
                        )
                      "
                      target="_blank"
                      :title="
                        cell.codeAttempts
                          ? `看 ${nameOf(student)} 今天在这道题上交的 ${cell.codeAttempts} 次代码`
                          : `看 ${nameOf(student)} 今天在这道题上画的 ${cell.flowchartAttempts} 张流程图`
                      "
                    >
                      {{ cellText(cell) }}
                    </a>
                    <template v-else>{{ cellText(cell) }}</template>
                  </td>
                  <td class="meta">
                    {{ student.lastSubmitAt ? parseTime(student.lastSubmitAt, "HH:mm") : "—" }}
                  </td>
                  <td :class="{ 'cell-stuck': oftenIdle(student) }">
                    {{
                      board.recentLessons ? `${student.recentAttended}/${board.recentLessons}` : "—"
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 格子、名字能点进提交列表，但别长得像一片蓝色链接 —— 投影上一眼看的是颜色 */
.cell-link {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.cell-link:hover {
  text-decoration: underline;
}

.hide-bar {
  margin-bottom: 6px;
}

.board {
  max-width: 1400px;
  margin: 0 auto;
}

.toolbar {
  margin-bottom: 16px;
}

.title {
  margin: 0;
  font-size: 20px;
}

.section {
  margin-bottom: 16px;
}

.meta {
  font-size: 13px;
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px 24px;
  margin-bottom: 16px;
}

.summary-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.summary-count {
  font-size: 13px;
  opacity: 0.75;
  margin-top: 2px;
}

.projector .summary {
  grid-template-columns: 1fr;
  gap: 28px;
  font-size: 28px;
}

.projector .summary-count {
  font-size: 24px;
}

.table-wrap {
  overflow-x: auto;
  margin-top: 8px;
}

.grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
}

.grid th,
.grid td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
  text-align: center;
  white-space: nowrap;
}

.grid th {
  font-weight: 500;
  opacity: 0.8;
}

.grid .name {
  text-align: left;
}

.plain {
  color: inherit;
}

.cell-done {
  color: #18a058;
}

.cell-tried {
  color: #f0a020;
}

.cell-stuck {
  color: #d03050;
  font-weight: 600;
}

.help-tag {
  cursor: pointer;
}

.cell-none {
  opacity: 0.35;
}
</style>
