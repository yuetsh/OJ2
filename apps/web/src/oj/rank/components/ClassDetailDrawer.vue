<script setup lang="ts">
import type { ClassDetail } from "@oj2/contract"
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"
import { useThemeVars } from "naive-ui"
import { getClassDetail } from "oj/api"
import { classLabel } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { useAIStream } from "shared/composables/aiStream"
import { useBreakpoints } from "shared/composables/breakpoints"
import { parseTime } from "utils/functions"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/**
 * 班级详情（设计稿「班级详情 · 老师 / 学生」）：从右边滑出的抽屉，代替原来那个满是
 * 四分位数、标准差、综合分的弹框。谁都能看；「要多关心的同学」和 AI 分析只给老师，
 * AI 报告直接在抽屉里出，不再关掉再弹第二个框。
 */
const props = defineProps<{ className: string | null; teacher: boolean; pk: boolean }>()
const show = defineModel<boolean>("show", { required: true })

const router = useRouter()
const message = useMessage()
const theme = useThemeVars()
const palette = useRankPalette()
const { isDesktop } = useBreakpoints()

const detail = ref<ClassDetail | null>(null)
const loading = ref(false)
const report = ref("")
const ai = useAIStream()

watch(
  () => [show.value, props.className] as const,
  async ([open, className]) => {
    if (!open || !className) return
    if (detail.value?.className !== className) {
      report.value = ""
      ai.abort()
    }
    loading.value = true
    try {
      detail.value = await getClassDetail(className)
    } catch {
      detail.value = null
    } finally {
      loading.value = false
    }
  },
)

/** 分布点阵：每个做对数一列，一列里一个点一个同学；做对不到 3 道的老师那边标红 */
const columns = computed(() => {
  const counts = new Map<number, number>()
  for (const n of detail.value?.distribution ?? []) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].sort((a, b) => a[0] - b[0]).map(([solved, people]) => ({ solved, people }))
})
const dot = computed(() => {
  const tallest = Math.max(1, ...columns.value.map((column) => column.people))
  return Math.max(4, Math.min(10, Math.floor(172 / tallest) - 2))
})

const weekMax = computed(() =>
  Math.max(
    1,
    ...(detail.value?.weeks ?? []).flatMap((week) => [week.perCapita, week.gradeAvg ?? 0]),
  ),
)

async function analyze() {
  if (!props.className) return
  report.value = ""
  try {
    await ai.run(
      "ai/class-analysis",
      { className: props.className },
      { onDelta: (content) => (report.value += content) },
    )
  } catch (error) {
    message.error((error as Error).message)
  }
}

function go(path: string, query: Record<string, string>) {
  show.value = false
  router.push({ path, query })
}
</script>

<template>
  <n-drawer v-model:show="show" :width="isDesktop ? 560 : '100%'" placement="right">
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="head">
          <span class="title">{{ className ? classLabel(className) : "班级详情" }}</span>
          <span v-if="detail" class="muted">
            {{ detail.members }} 人 · 这学期（{{ parseTime(detail.start, "M月D日") }}起）
            <template v-if="detail.rank"> · 班级对抗第 {{ detail.rank }}</template>
          </span>
        </div>
      </template>

      <n-spin :show="loading">
        <div v-if="detail" class="body">
          <div class="bigs">
            <div class="big">
              <span>人均做对</span><b>{{ detail.perCapita }}</b>
              <span v-if="detail.gradeAvg !== null">年级平均 {{ detail.gradeAvg }}</span>
            </div>
            <div class="big">
              <span>中间那位同学做对</span><b>{{ detail.median }} 道</b><span>一半人比他多</span>
            </div>
            <div class="big">
              <span>做对过题的</span>
              <b
                >{{ detail.solvedMembers }} <small>/ {{ detail.members }} 人</small></b
              >
              <span>{{
                detail.members - detail.solvedMembers
                  ? `${detail.members - detail.solvedMembers} 人还没做对`
                  : "人人都做对过"
              }}</span>
            </div>
          </div>

          <section>
            <div class="sec-title">全班分布</div>
            <div class="dots">
              <div v-for="column in columns" :key="column.solved" class="dot-col">
                <div class="stack">
                  <span
                    v-for="i in column.people"
                    :key="i"
                    class="dot"
                    :style="{
                      width: `${dot}px`,
                      height: `${dot}px`,
                      background: teacher && column.solved < 3 ? '#e5484d' : '#9fb3c8',
                    }"
                  />
                </div>
                <span class="axis">{{ column.solved }}</span>
              </div>
            </div>
            <span class="line">
              前 10% 平均 <b>{{ detail.top10Avg }}</b> 道 · 后 10% 平均
              <b>{{ detail.bottom10Avg }}</b> 道
              <template v-if="detail.plateau">
                · {{ detail.plateau.count }} 个人停在 {{ detail.plateau.solved }} 道</template
              >
            </span>
          </section>

          <section v-if="detail.weeks.length">
            <div class="sec-title">
              每周人均新做对
              <span class="key"><i :style="{ background: palette.me }" />本班</span>
              <span v-if="detail.gradeAvg !== null" class="key"
                ><i :style="{ background: palette.bar }" />年级平均</span
              >
            </div>
            <div class="weeks">
              <div v-for="week in detail.weeks" :key="week.weekStart" class="week">
                <div class="pair">
                  <div class="bar-col">
                    <span class="v me">{{ week.perCapita }}</span>
                    <span
                      class="bar"
                      :style="{
                        height: `${Math.max(2, (week.perCapita / weekMax) * 90)}px`,
                        background: palette.me,
                      }"
                    />
                  </div>
                  <div v-if="week.gradeAvg !== null" class="bar-col">
                    <span class="v">{{ week.gradeAvg }}</span>
                    <span
                      class="bar"
                      :style="{
                        height: `${Math.max(2, (week.gradeAvg / weekMax) * 90)}px`,
                        background: palette.bar,
                      }"
                    />
                  </div>
                </div>
                <span class="axis">{{ parseTime(week.weekStart, "M月D日") }}那周</span>
              </div>
            </div>
          </section>

          <section v-if="detail.care">
            <div class="sec-title">要多关心的同学</div>
            <div v-for="row in detail.care" :key="row.user.id" class="care">
              <RankAvatar :username="row.user.username" :avatar="row.avatar" :size="20" />
              <UserName :username="row.user.username" />
              <span class="muted">这学期 {{ row.solved }} 道 · 交过 {{ row.submissions }} 次</span>
              <div class="spacer" />
              <a
                href="#"
                @click.prevent="
                  go('/submission', { username: row.user.username, exactUsername: '1' })
                "
                >看他的提交 ›</a
              >
              <a href="#" @click.prevent="go('/ai-analysis', { username: row.user.username })"
                >智能分析 ›</a
              >
            </div>
            <span v-if="!detail.care.length" class="muted">没有，这学期人人都做对 3 道以上</span>
          </section>

          <section v-if="teacher" class="ai">
            <div class="ai-head">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
              </svg>
              <b>AI 分析这个班</b>
              <div class="spacer" />
              <n-button
                size="small"
                :type="report ? 'default' : 'info'"
                :loading="ai.running.value"
                @click="analyze"
              >
                {{ report ? "重新分析" : "开始分析" }}
              </n-button>
            </div>
            <span v-if="ai.waiting.value" class="muted">正在看这个班的数据…</span>
            <MdPreview v-if="report" class="report" :model-value="report" />
          </section>

          <a v-if="pk" href="#" class="pk" @click.prevent="go('/class', { classes: className! })"
            >和别的班比 → 班级 PK ›</a
          >
        </div>
        <div v-else-if="!loading" class="muted">这个班的数据没取到</div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title {
  font-size: 20px;
  font-weight: 700;
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bigs {
  display: flex;
  gap: 8px;
}

.big {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: v-bind("theme.actionColor");
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.big b {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}

.big b small {
  font-size: 13px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.big span {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sec-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: v-bind("theme.textColor2");
}

.dots {
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.dot-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stack {
  height: 172px;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 2px;
  padding-bottom: 4px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
  width: 100%;
}

.dot {
  border-radius: 50%;
  flex-shrink: 0;
}

.axis {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.line {
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.key {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 400;
  font-size: 12px;
}

.key i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.weeks {
  display: flex;
  gap: 4px;
}

.week {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.pair {
  height: 110px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.bar {
  width: 16px;
  border-radius: 3px 3px 0 0;
}

.v {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  font-variant-numeric: tabular-nums;
}

.v.me {
  color: #18a058;
  font-weight: 600;
}

.care {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.care a,
.pk {
  font-size: 13px;
  color: v-bind("theme.primaryColor");
  text-decoration: none;
  white-space: nowrap;
}

.spacer {
  flex-grow: 1;
}

.ai {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(47, 111, 208, 0.3);
  background: rgba(47, 111, 208, 0.05);
}

.ai-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #2f6fd0;
}

.ai-head b {
  color: v-bind("theme.textColor1");
}

.report {
  background: transparent;
}

.report :deep(.md-editor-preview-wrapper) {
  padding: 0;
}
</style>
