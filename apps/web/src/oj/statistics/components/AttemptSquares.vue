<script lang="ts">
import type { Submission } from "utils/types"

/**
 * 代码按提交 id 缓存，整页共用：交了就不会再变，老师在一排方块之间来回对比时
 * 不用每次都等网络。失败的不进缓存，下次停上去再试。
 */
const codeCache = new Map<string, Submission>()
</script>

<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getSubmission } from "oj/api"
import { JUDGE_STATUS, LANGUAGE_FORMAT_VALUE, SubmissionStatus } from "utils/constants"
import { parseTime } from "utils/functions"
import type { SUBMISSION_RESULT } from "utils/types"
import { useTone, type Tone } from "oj/submission/composables/tone"

/**
 * 一个人在一道题上的每一次提交，一格一次、从早到晚（设计稿「统计重设计」）。
 * 鼠标停在一格上看那一次的代码，点一下新页面打开那条提交。
 */
const props = withDefaults(
  defineProps<{
    items: Array<{ id: string; result: SUBMISSION_RESULT; createTime: string }>
    size?: number
  }>(),
  { size: 14 },
)

const tone = useTone()
const theme = useThemeVars()

function toneOf(result: number): Tone {
  if (result === SubmissionStatus.accepted) return "success"
  if (
    result === SubmissionStatus.compile_error ||
    result === SubmissionStatus.runtime_error ||
    result === SubmissionStatus.ast_check_failed ||
    result === SubmissionStatus.partial_accepted
  ) {
    return "warning"
  }
  if (result === SubmissionStatus.pending || result === SubmissionStatus.judging) return "info"
  return "error"
}

const code = reactive<Record<string, Submission | "loading" | "failed">>({})

async function load(id: string) {
  const hit = codeCache.get(id)
  if (hit) {
    code[id] = hit
    return
  }
  if (code[id] === "loading") return
  code[id] = "loading"
  try {
    const res = await getSubmission(id)
    codeCache.set(id, res)
    code[id] = res
  } catch {
    code[id] = "failed"
  }
}

function open(id: string) {
  window.open("/submission/" + id, "_blank", "noopener")
}

const cells = computed(() =>
  props.items.map((item, index) => ({
    ...item,
    index: index + 1,
    color: tone(toneOf(item.result)).solid,
  })),
)
</script>

<template>
  <span class="squares">
    <n-popover
      v-for="cell in cells"
      :key="cell.id"
      :delay="200"
      :style="{ maxWidth: '560px' }"
      @update:show="(show: boolean) => show && load(cell.id)"
    >
      <template #trigger>
        <button
          class="square"
          :style="{ width: `${size}px`, height: `${size}px`, background: cell.color }"
          :aria-label="`第 ${cell.index} 次：${JUDGE_STATUS[cell.result]?.name ?? ''}`"
          @click.stop="open(cell.id)"
        ></button>
      </template>
      <div class="pop">
        <div class="pop-head">
          <b>{{ JUDGE_STATUS[cell.result]?.name }}</b>
          <span class="muted"
            >{{ parseTime(cell.createTime, "M月D日 HH:mm") }} · 第 {{ cell.index }} 次</span
          >
        </div>
        <n-code
          v-if="typeof code[cell.id] === 'object'"
          class="pop-code"
          :code="(code[cell.id] as Submission).code"
          :language="LANGUAGE_FORMAT_VALUE[(code[cell.id] as Submission).language]"
          show-line-numbers
        />
        <span v-else-if="code[cell.id] === 'failed'" class="muted">代码没拉下来，点方块打开看</span>
        <span v-else class="muted">代码加载中…</span>
      </div>
    </n-popover>
  </span>
</template>

<style scoped>
.squares {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.square {
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}

.square:hover {
  /* button 的 color 是浏览器默认的黑，暗色下 currentColor 描边会看不见 */
  outline: 2px solid v-bind("theme.textColor2");
  outline-offset: 1px;
}

.pop {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pop-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pop-code {
  max-height: 360px;
  overflow: auto;
  font-size: 14px;
}

.muted {
  opacity: 0.65;
}
</style>
