<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getProblemSetClassView } from "oj/api"
import { useTone } from "oj/submission/composables/tone"
import { classLabel, groupClassOptions } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { parseTime } from "utils/functions"
import type { ProblemSetClassView } from "utils/types"

/**
 * 老师看一个班在题单里的情况（设计稿「题单重设计」老师 · 全班情况）：真名 × 每道题，
 * 格子里写几点做对 / 错了几次；紫色角 = 加入之前就做对过（可能是凭记忆默写的）。
 * 没加入的人在上面点名。班级默认是服务端推断的（最近在做的那个班），可以换。
 * 点格子到提交列表看这个学生这道题的代码。
 */
const props = defineProps<{ problemSetId: number }>()
const theme = useThemeVars()
const tone = useTone()

const data = ref<ProblemSetClassView | null>(null)
const className = ref("")
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    data.value = await getProblemSetClassView(props.problemSetId, className.value)
    className.value = data.value.className ?? ""
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(className, (value, old) => {
  if (old && value !== data.value?.className) load()
})

const classOptions = computed(() => {
  const classes = new Map((data.value?.classes ?? []).map((item) => [item.className, item]))
  return groupClassOptions([...classes.keys()], (name) => {
    const item = classes.get(name)!
    return { value: name, label: `${classLabel(name)}（${item.joined}/${item.size} 人加入）` }
  })
})

const joined = computed(() => data.value?.students.filter((s) => s.joinTime) ?? [])
const absent = computed(() => data.value?.students.filter((s) => !s.joinTime) ?? [])
const average = computed(() =>
  joined.value.length
    ? joined.value.reduce((sum, s) => sum + s.completedCount, 0) / joined.value.length
    : 0,
)
const finished = computed(
  () => joined.value.filter((s) => data.value && s.completedCount >= data.value.totalCount).length,
)
const beforeCount = computed(() =>
  joined.value.reduce((sum, s) => sum + s.cells.filter((cell) => cell.solvedBefore).length, 0),
)

const columns = computed(
  () => `22px 110px 44px repeat(${data.value?.problems.length ?? 1}, minmax(72px, 1fr))`,
)

function cellLink(username: string, problemId: string) {
  return `/submission?username=${encodeURIComponent(username)}&problem=${encodeURIComponent(problemId)}`
}

function cellTime(time: string) {
  const today = parseTime(new Date(), "YYYY-MM-DD") === parseTime(time, "YYYY-MM-DD")
  return parseTime(time, today ? "HH:mm" : "M/D")
}

const success = computed(() => tone("success"))
const warning = computed(() => tone("warning"))
const error = computed(() => tone("error"))
</script>

<template>
  <section class="card">
    <div v-if="data && !data.className" class="empty muted">还没有学生加入这个题单</div>
    <template v-else-if="data">
      <div class="summary">
        <n-select
          v-model:value="className"
          :options="classOptions"
          size="small"
          class="pick"
          :consistent-menu-width="false"
        />
        <span
          ><b class="num big">{{ joined.length }}</b
          ><span class="muted"> / {{ data.students.length }} 人加入</span></span
        >
        <span
          ><span class="muted">平均做对</span> <b class="num big">{{ average.toFixed(1) }}</b
          ><span class="muted"> / {{ data.totalCount }} 道</span></span
        >
        <span
          ><span class="muted">做完</span> <b class="num big">{{ finished }}</b
          ><span class="muted"> 人</span></span
        >
        <span
          v-if="absent.length"
          class="absent ell"
          :title="absent.map((s) => s.username).join('、')"
          >没加入：{{ absent.map((s) => s.username).join("、") }}</span
        >
        <div class="spacer"></div>
        <span v-if="beforeCount" class="legend-before"
          ><span class="corner"></span>加入前就做对过（{{ beforeCount }} 格）</span
        >
      </div>

      <div class="scroll">
        <div class="grid" :style="{ gridTemplateColumns: columns }">
          <div class="head"></div>
          <div class="head">学生</div>
          <div class="head right">做对</div>
          <div v-for="(p, i) in data.problems" :key="p.id" class="head col" :title="p.title">
            <b class="ell">{{ i + 1 }} {{ p.title }}</b>
            <span class="num"
              >{{ p.solved }} 人对<template v-if="!p.isRequired"> · 选做</template></span
            >
          </div>

          <template v-for="(s, idx) in joined" :key="s.userId">
            <div class="cell muted num tiny">{{ idx + 1 }}</div>
            <div class="cell ell">
              <UserName :username="s.username" />
            </div>
            <div class="cell right num">
              <b>{{ s.completedCount }}</b>
            </div>
            <a
              v-for="(c, i) in s.cells"
              :key="i"
              :href="cellLink(s.username, data.problems[i]!._id)"
              target="_blank"
              class="box"
              :class="{ ok: c.solvedTime, bad: !c.solvedTime && c.wrongCount }"
              :title="`${s.username} · ${data.problems[i]!.title}${c.solvedBefore ? ' · 加入前就做对过' : ''}`"
            >
              <template v-if="c.solvedTime"
                >✓ <span class="num">{{ cellTime(c.solvedTime) }}</span></template
              >
              <template v-else-if="c.wrongCount">错 {{ c.wrongCount }} 次</template>
              <span v-if="c.solvedBefore" class="corner"></span>
            </a>
          </template>
        </div>
      </div>
    </template>
    <div v-else class="empty"><n-spin size="small" /></div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
  overflow: hidden;
}

.empty {
  padding: 40px;
  text-align: center;
}

.summary {
  min-height: 60px;
  box-sizing: border-box;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
  font-size: var(--oj-fs-sec);
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.pick {
  width: 240px;
}

.big {
  font-size: 20px;
}

.absent {
  max-width: 420px;
  color: v-bind("error.color");
}

.legend-before {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5b3fa8;
}

.legend-before .corner {
  position: static;
}

.scroll {
  overflow-x: auto;
}

.grid {
  display: grid;
  column-gap: 6px;
  padding: 0 20px 10px;
}

.head {
  position: sticky;
  top: 0;
  height: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
  background: v-bind("theme.cardColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
  margin-bottom: 4px;
}

.head.col {
  align-items: center;
  line-height: 16px;
  min-width: 0;
  overflow: hidden;
}

.head.col b {
  max-width: 100%;
  color: v-bind("theme.textColor2");
}

.right {
  text-align: right;
  align-items: flex-end;
  padding-right: 8px;
}

.cell {
  height: 38px;
  display: flex;
  align-items: center;
  font-size: var(--oj-fs-body);
  min-width: 0;
}

.cell.right {
  justify-content: flex-end;
}

.box {
  position: relative;
  height: 30px;
  margin: 4px 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: var(--oj-fs-meta);
  text-decoration: none;
  background: v-bind("theme.actionColor");
  color: v-bind("theme.textColor3");
}

.box.ok {
  background: v-bind("success.background");
  color: v-bind("success.color");
}

.box.bad {
  background: v-bind("warning.background");
  color: v-bind("warning.color");
}

.box:hover {
  outline: 1px solid v-bind("theme.primaryColor");
}

.corner {
  position: absolute;
  top: 2px;
  right: 3px;
  width: 0;
  height: 0;
  border-top: 8px solid #7a5fd0;
  border-left: 8px solid transparent;
}

.spacer {
  flex-grow: 1;
}

.muted {
  color: v-bind("theme.textColor3");
}

.tiny {
  font-size: 12px;
}

.num {
  font-variant-numeric: tabular-nums;
}

.ell {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
