<script setup lang="ts">
import LockNote from "oj/problemset/components/LockNote.vue"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { getSubmission } from "oj/api"
import { useUserStore } from "shared/store/user"
import {
  JUDGE_STATUS,
  LANGUAGE_FORMAT_VALUE,
  LANGUAGE_SHOW_VALUE,
  SubmissionStatus,
} from "utils/constants"
import { submissionCaseResults } from "utils/functions"
import type { Submission, SubmissionListItem } from "utils/types"
import { useCopySubmission } from "../composables/copySubmission"
import { useSubmissionExplain } from "../composables/explain"
import { useTone } from "shared/composables/tone"
import { classLabel } from "utils/classes"
import { submissionTimeText } from "../utils"
import CodeView from "./CodeView.vue"
import ExplainNote from "./ExplainNote.vue"
import StatusPill from "./StatusPill.vue"
import UserName from "shared/components/UserName.vue"

/**
 * 提交列表的右栏：选中那一条的代码和结果（设计稿「提交列表重设计 · 定稿」）。
 * 原来要点开一个弹框看，老师翻全班代码时是「点开 → 看 → 关掉 → 点下一行」。
 */
const props = defineProps<{
  row: SubmissionListItem
  /** 老师那套：重新判题、逐个测试点、复制两项收进「⋯」 */
  teacher: boolean
  /** 在比赛的提交列表里（不能重判，题目链接走比赛） */
  contest: boolean
  /** 列表现在筛的班级：已经在筛这个班时「只看这个班」换成「取消」 */
  className?: string
  /** 右下角的「本页第 i / n 条」 */
  position: { index: number; count: number } | null
  /** 手机上的整屏详情：头部折行、不提方向键 */
  narrow?: boolean
}>()

const emit = defineEmits<{
  filterUser: [username: string]
  filterClass: [className: string]
  clearClass: []
  filterProblem: [displayId: string]
  openProblem: [row: SubmissionListItem]
  rejudge: [id: string]
}>()

const userStore = useUserStore()
const theme = useThemeVars()
// 暗色下测试点方块的底色是主题色本身（浅），白字就看不清了
const isDark = useDark()
const tone = useTone()
const { copyToCat, copyToProblem } = useCopySubmission()

/**
 * 详情按提交 id 缓存：判完的代码和结果不会再变，老师在几行之间来回按方向键时不用每次都等网络。
 * 还在判的不进缓存；一条被重判（结果回到「等待评分」）就把它的缓存扔掉 —— 重判后结果
 * 可能没变（答案错误还是答案错误），但测试点和报错是新的
 */
const cache = new Map<string, Submission>()
const detail = ref<Submission | null>(null)
const loading = ref(false)
const failed = ref(false)

const judging = computed(
  () =>
    props.row.result === SubmissionStatus.pending || props.row.result === SubmissionStatus.judging,
)

// 每次加载一个序号：同一条先按「判题中」拉了一次、判完又拉一次时，晚回来的旧请求不能盖掉新的
let loadSeq = 0

async function load() {
  const row = props.row
  const seq = ++loadSeq
  failed.value = false
  if (judging.value) cache.delete(row.id)
  if (!row.showLink) {
    detail.value = null
    return
  }
  const hit = cache.get(row.id)
  if (hit && hit.result === row.result) {
    detail.value = hit
    return
  }
  loading.value = true
  try {
    const res = await getSubmission(row.id)
    if (seq !== loadSeq) return
    // 列表那边还在判、详情这边已经判完了（或反过来）都不缓存，等两边对上
    if (!judging.value && res.result === props.row.result) cache.set(row.id, res)
    detail.value = res
  } catch {
    if (seq === loadSeq) failed.value = true
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

// 分开写三个来源：列表每次轮询都换一批新的行对象，一个 getter 返回数组的话回调次次都跑
watch([() => props.row.id, () => props.row.result, () => props.row.showLink], load, {
  immediate: true,
})

const shown = computed(() => (detail.value?.id === props.row.id ? detail.value : null))

const locked = computed(() => {
  if (props.row.showLink) return null
  if (!userStore.isAuthed) return "anon" as const
  if (props.row.userId === userStore.user?.id) return "problemset" as const
  return "others" as const
})

/** 逐个测试点。只有管理员拿得到 info（每个点带 output_md5），学生只有 caseSummary 两个数 */
const cases = computed(() => submissionCaseResults(shown.value?.info))

const { explain, explainTone } = useSubmissionExplain(shown)

function caseColor(result: number) {
  if (result === SubmissionStatus.accepted) return tone("success").solid
  if (result === SubmissionStatus.runtime_error) return tone("warning").solid
  return tone("error").solid
}

const canRejudge = computed(() => props.teacher && !props.contest)
function openStandalone() {
  window.open("/submission/" + props.row.id, "_blank")
}
</script>

<template>
  <section class="pane" :class="{ narrow }">
    <div class="head">
      <div class="who">
        <!-- 点名字开个人主页（原来列表里的用户名就是这个链接） -->
        <a
          class="user-link"
          :href="`/user?name=${encodeURIComponent(row.username)}`"
          target="_blank"
        >
          <UserName :username="row.username" :muted="!!locked && locked !== 'problemset'" />
        </a>
        <button
          class="filter-pill"
          title="只看他的提交"
          aria-label="只看他的提交"
          @click="emit('filterUser', row.username)"
        >
          <Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
        <!-- 班级下拉只有网站配置里在读的班，摘掉的老班从这里筛。已经在筛这个班时原地变成「取消」，
             不用再挪到上面班级下拉去点 × -->
        <button
          v-if="teacher && !contest && row.className && row.className === className"
          class="filter-pill wide active"
          :title="`不再只看${classLabel(row.className)}，看全部班级`"
          :aria-label="`不再只看${classLabel(row.className)}，看全部班级`"
          @click="emit('clearClass')"
        >
          {{ classLabel(row.className) }}<Icon icon="ph:x-bold" :width="11" />
        </button>
        <button
          v-else-if="teacher && !contest && row.className"
          class="filter-pill wide"
          :title="`只看${classLabel(row.className)}的提交`"
          :aria-label="`只看${classLabel(row.className)}的提交`"
          @click="emit('filterClass', row.className)"
        >
          {{ classLabel(row.className) }}<Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
      </div>
      <span v-if="!narrow" class="dot">·</span>
      <!-- 两层 display: contents 的壳：桌面上照旧排成一行，手机上题目整行另起、按钮挪到名字右边 -->
      <span class="problem-group">
        <a
          class="problem"
          href="#"
          :title="`${row.problemDisplayId} ${row.problemTitle}`"
          @click.prevent="emit('openProblem', row)"
        >
          <span class="problem-id">{{ row.problemDisplayId }}</span>
          {{ row.problemTitle }}
        </a>
        <button
          class="filter-pill"
          title="只看这道题的提交"
          aria-label="只看这道题的提交"
          @click="emit('filterProblem', row.problemDisplayId)"
        >
          <Icon icon="ph:funnel-simple-bold" :width="12" />
        </button>
        <a
          v-if="row.problemSet"
          class="problemset"
          :href="'/problemset/' + row.problemSet.id"
          target="_blank"
          :title="'从题单「' + row.problemSet.title + '」交的'"
        >
          题单 {{ row.problemSet.title }}
        </a>
      </span>
      <div class="spacer"></div>
      <span class="actions">
        <!-- 桌面上复制两项在底栏：顶上这一行再塞两个按钮，1280 的屏上老师的题目名一个字都不剩、
             学生的也只剩六七个字（第二行测试点一多也排不下，底栏还空 250px 以上） -->
        <template v-if="shown && narrow">
          <n-button
            size="small"
            :type="teacher ? 'default' : 'primary'"
            @click="copyToProblem(shown)"
          >
            <template #icon><Icon icon="ph:arrow-u-up-left" /></template>
            复制回到题目
          </n-button>
          <n-button v-if="shown.language !== 'SQL'" size="small" @click="copyToCat(shown)">
            复制到自测猫
          </n-button>
        </template>
        <template v-if="teacher">
          <n-button
            v-if="shown"
            size="small"
            quaternary
            title="新页面打开（看他这道题交的每一次）"
            aria-label="新页面打开"
            @click="openStandalone"
          >
            <template #icon><Icon icon="ph:arrow-square-out" /></template>
          </n-button>
          <!-- 原来收在「⋯」里，菜单里就剩这一项了，直接摆出来。和旁边「新页面打开」一样只给图标：
               顶行再宽一点，1280 的屏上题目名就又被挤没了（现在只剩 124px） -->
          <n-button
            v-if="canRejudge"
            size="small"
            quaternary
            :disabled="judging"
            :title="judging ? '还在判，判完才能重新判题' : '重新判题'"
            aria-label="重新判题"
            @click="emit('rejudge', row.id)"
          >
            <template #icon><Icon icon="ph:arrow-clockwise" /></template>
          </n-button>
        </template>
        <template v-else-if="shown">
          <n-button
            size="small"
            quaternary
            title="新页面打开"
            aria-label="新页面打开"
            @click="openStandalone"
          >
            <template #icon><Icon icon="ph:arrow-square-out" /></template>
          </n-button>
        </template>
      </span>
    </div>

    <div class="meta">
      <StatusPill :result="row.result" />
      <span v-if="teacher && cases.length" class="cases">
        <span
          v-for="(item, index) in cases"
          :key="index"
          class="case"
          :style="{ background: caseColor(item.result), color: isDark ? '#18181c' : '#ffffff' }"
          :title="`测试点 ${index + 1}：${JUDGE_STATUS[item.result]?.name ?? ''}`"
        >
          {{ index + 1 }}
        </span>
      </span>
      <span
        v-else-if="row.caseSummary && row.caseSummary.passed < row.caseSummary.total"
        class="partial"
        :style="{ color: tone('error').color }"
      >
        通过 {{ row.caseSummary.passed }}/{{ row.caseSummary.total }} 个测试点
      </span>
      <span>{{ LANGUAGE_SHOW_VALUE[row.language] }}</span>
      <span>{{ submissionTimeText(row.createTime, true) }}</span>
    </div>

    <!-- 看不到代码的三种情况 -->
    <div v-if="locked" class="locked">
      <Icon icon="ph:lock-simple" :width="30" class="lock-icon" />
      <template v-if="locked === 'others'">
        <span class="locked-title">别人的代码看不到</span>
        <span class="muted">自己动手做出来，才是自己的。</span>
        <n-button type="primary" @click="emit('openProblem', row)">
          去做 {{ row.problemDisplayId }} {{ row.problemTitle }}
        </n-button>
      </template>
      <template v-else-if="locked === 'problemset'">
        <span class="locked-title">这份代码在题单布置期内先藏着</span>
        <span class="muted"><LockNote :problem="{ displayId: row.problemDisplayId }" /></span>
      </template>
      <template v-else>
        <span class="locked-title">登录之后才能看代码</span>
      </template>
    </div>

    <template v-else>
      <ExplainNote v-if="explain" :explain="explain" :tone="explainTone" />
      <CodeView
        v-if="shown"
        :code="shown.code"
        :language="LANGUAGE_FORMAT_VALUE[shown.language]"
        :mark-line="explain?.line ?? null"
        :font-size="narrow ? 14 : 20"
        :line-height="narrow ? 24 : 32"
        class="code"
      />
      <div v-else class="placeholder">
        <n-spin v-if="loading" size="small" />
        <span v-else-if="failed" class="muted">
          代码没拉下来，
          <a href="#" @click.prevent="load">再试一次</a>
        </span>
      </div>
    </template>

    <div v-if="!narrow" class="foot">
      <span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span>
      <span class="hint">
        {{ teacher ? "换上一条 / 下一条，到本页头尾自动翻页" : "换上一条 / 下一条，锁着的会跳过" }}
      </span>
      <div class="spacer"></div>
      <template v-if="shown">
        <n-button
          size="small"
          :type="teacher ? 'default' : 'primary'"
          @click="copyToProblem(shown)"
        >
          <template #icon><Icon icon="ph:arrow-u-up-left" /></template>
          复制回到题目
        </n-button>
        <n-button v-if="shown.language !== 'SQL'" size="small" @click="copyToCat(shown)">
          复制到自测猫
        </n-button>
      </template>
      <span v-if="position" class="position"
        >本页第 {{ position.index }} / {{ position.count }} 条</span
      >
    </div>
  </section>
</template>

<style scoped>
.pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 18px var(--oj-pad-x) 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: v-bind("theme.bodyColor");
  container: pane / inline-size;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  font-size: 16px;
  min-width: 0;
}

/* 顶上固定一行：按方向键翻条时这一行高度不能变，不然下面的代码区跟着上下跳。
   名字和按钮不缩，题目名太长时省略（全名在 title 里） */
.head .who {
  flex-shrink: 0;
}

.head .problem {
  flex: 0 1 auto;
}

.problem-group,
.actions {
  display: contents;
}

/* 手机整屏详情：第一行名字（+ 班级），第二行题目，第三行按钮。
   整个面板一起滚，代码有多长画多长，不在框里再套一层上下滚 */
.narrow {
  padding: 12px 14px 16px;
  overflow-y: auto;
}

.narrow .head {
  flex-wrap: wrap;
  row-gap: 10px;
  white-space: normal;
}

.narrow .head .who {
  flex-shrink: 1;
  flex-wrap: wrap;
  row-gap: 6px;
}

.narrow .head .spacer {
  order: 1;
}

.narrow .problem-group {
  order: 3;
  flex-basis: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.narrow .problem {
  white-space: normal;
}

/* 屏再窄（320）时折到下一行，别顶出去 */
.narrow .actions {
  order: 4;
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* 手指点的：漏斗按钮放大一圈 */
.narrow .filter-pill {
  width: 32px;
  height: 28px;
  border-radius: 14px;
}

.narrow .filter-pill.wide {
  width: auto;
  padding: 0 10px;
}

.narrow .code {
  flex: none;
}

.narrow .locked {
  flex: 1 0 auto;
  min-height: 280px;
}

.user-link {
  display: flex;
  min-width: 0;
  text-decoration: none;
}

.user-link:hover :deep(.name) {
  color: v-bind("theme.primaryColor");
}

.who {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dot {
  color: v-bind("theme.textColor3");
}

.problem {
  color: v-bind("theme.textColor1");
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.problem:hover {
  color: v-bind("theme.primaryColor");
}

.problem-id {
  color: v-bind("theme.textColor3");
}

.problemset {
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: v-bind("tone('info').color");
  background: v-bind("tone('info').background");
}

/* 只留漏斗图标（右栏六百来宽，带字的话名字、题目和按钮排不进一行），字在 title 里 */
.filter-pill {
  flex: none;
  width: 24px;
  height: 22px;
  padding: 0;
  justify-content: center;
  border: 1px solid v-bind("tone('success').background");
  border-radius: 11px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("tone('success').color");
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.filter-pill.wide {
  width: auto;
  padding: 0 8px;
  white-space: nowrap;
}

.filter-pill:hover {
  background: v-bind("tone('success').background");
}

.filter-pill.active {
  border-color: v-bind("tone('success').solid");
  background: v-bind("tone('success').background");
}

.filter-pill.active:hover {
  border-color: v-bind("tone('error').solid");
  background: v-bind("tone('error').background");
  color: v-bind("tone('error').color");
}

.spacer {
  flex: 1 1 0;
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  flex-wrap: wrap;
  row-gap: 6px;
}

.cases {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.case {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cases .muted {
  margin-left: 4px;
}

.partial {
  font-weight: 600;
}

.muted {
  color: v-bind("theme.textColor3");
}

.locked,
.placeholder {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 16px;
  border-radius: 6px;
}

.locked {
  border: 1px dashed v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
}

.lock-icon {
  color: v-bind("theme.textColor3");
  opacity: 0.7;
}

.locked-title {
  font-size: 16px;
  font-weight: 600;
}

/* 高度按按钮定死：代码还在拉、按钮没出来时这一栏不变矮，代码区不跟着上下跳 */
.foot {
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

/* 1280 的屏上这一栏只剩几像素：字体宽一点的机器上让提示省略，别把按钮挤出去 */
.hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.foot > :not(.hint) {
  flex-shrink: 0;
}

.keys {
  display: inline-flex;
  gap: 3px;
}

kbd {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 3px;
  background: v-bind("theme.cardColor");
  font: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 桌面右栏窄了（屏窄、浏览器放大、列表没收窄）：顶行一行排不下就固定拆成两行 ——
   名字和按钮一行、题目一行。按宽度定、不按内容定，翻条时高度照样不变 */
@container pane (max-width: 600px) {
  .pane:not(.narrow) .head {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .pane:not(.narrow) .dot {
    display: none;
  }

  /* 名字这块占掉按钮左边的全部宽度、从 0 起算：再窄也只是名字被截，按钮不会掉到下一行 */
  .pane:not(.narrow) .head .who {
    flex: 1 1 0;
    overflow: hidden;
  }

  .pane:not(.narrow) .head .spacer {
    display: none;
  }

  /* 先截班级，名字留全 */
  .pane:not(.narrow) .user-link {
    flex-shrink: 0;
  }

  .pane:not(.narrow) .filter-pill.wide {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    justify-content: flex-start;
  }

  .pane:not(.narrow) .problem-group {
    order: 3;
    flex-basis: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pane:not(.narrow) .keys,
  .pane:not(.narrow) .hint {
    display: none;
  }
}

/* 再窄连「本页第几条」也让给两个复制按钮 */
@container pane (max-width: 440px) {
  .pane:not(.narrow) .position {
    display: none;
  }
}
</style>
