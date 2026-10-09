<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { Quote } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { getHitokoto } from "../api"

/**
 * 一言（设计稿「一言重设计」A 版）：大引号 + 最多两行的句子、出处跟在第二行末尾 + 一个看得见的「换一句」。
 * 分类（动画、诗词……）不显示；接口里的 type 只用来判断出处要不要加书名号。
 * 原来只能点句子换，没人知道；出处被截成「来自 Structure and Interpretatio…」。
 * 长句（数据集 p90 44 字、最长 255 字）两行放不下时，鼠标移上去弹出全文；放得下的不弹。
 * 留着它是给学生一点「无聊的乐趣」，别去掉、别挪到看不见的地方。
 */
const theme = useThemeVars()

const quote = ref<Quote | null>(null)
const loading = ref(false)

async function receive() {
  loading.value = true
  try {
    quote.value = await getHitokoto()
  } catch {
    // 拿不到就不显示，别在这里摆一句「获取失败」
  } finally {
    loading.value = false
  }
}

onMounted(receive)

// 两行放不下（被截了省略号）才给全文弹层，鼠标移上去就出来；放得下的句子什么都不弹。
// 是否被截要等渲染完量：scrollHeight 比可见高度高就是截了。换句、窗口变宽变窄都重量一次
const sentenceRef = ref<HTMLElement | null>(null)
const clipped = ref(false)
function measure() {
  const el = sentenceRef.value
  clipped.value = !!el && el.scrollHeight > el.clientHeight + 1
}
watch(quote, () => nextTick(measure))
useResizeObserver(sentenceRef, measure)

/** 数据集里拿来充数的出处：写出来没有信息量 */
const FILLER = new Set(["佚名", "无", "原创", "网络", "其他", "互联网"])

const source = computed(() => {
  const q = quote.value
  if (!q) return ""
  const work = q.from && !FILLER.has(q.from) && q.from !== q.type ? q.from : ""
  const who = q.fromWho && !FILLER.has(q.fromWho) && q.fromWho !== work ? q.fromWho : ""
  // 内置的兜底句没有分类，出处（「判题狗」）不是作品名，不加书名号
  if (!q.type) return who || work
  if (who && work) return `${who}《${work}》`
  return work ? `《${work}》` : who
})

// 全文弹层在 body 下面，样式里的 v-bind 变量够不着，主题色就地给
const popVars = computed(() => ({
  "--pop-text": theme.value.textColor1,
  "--pop-muted": theme.value.textColor3,
}))
</script>

<template>
  <div v-if="quote" class="hitokoto">
    <Icon icon="ph:quotes-fill" class="mark" :width="22" />
    <n-popover trigger="hover" placement="bottom-end" :width="420" :disabled="!clipped">
      <template #trigger>
        <!-- 出处写在句子前面是为了浮动：它得先于文字出现，才能被 ::before 顶到第二行末尾 -->
        <div class="body">
          <div ref="sentenceRef" class="sentence">
            <span v-if="source" class="source">—— {{ source }}</span
            >{{ quote.hitokoto }}
          </div>
        </div>
      </template>
      <div class="full" :style="popVars">
        <div class="full-text">{{ quote.hitokoto }}</div>
        <div v-if="source" class="full-source">—— {{ source }}</div>
      </div>
    </n-popover>
    <button
      class="refresh"
      :class="{ spinning: loading }"
      :disabled="loading"
      aria-label="换一句"
      title="换一句"
      @click="receive"
    >
      <Icon icon="ph:arrow-clockwise-bold" :width="14" />
    </button>
  </div>
</template>

<style scoped>
/* 短句时整块靠右，别让「换一句」按钮孤零零地挂在中间 */
.hitokoto {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.mark {
  flex: none;
  color: v-bind("theme.successColor");
  opacity: 0.3;
}

/*
 * 句子最多两行，出处跟在第二行末尾、靠右（只有一行就在第一行末尾）。
 * 做法是「浮动垫片」：::before 是一根右浮动、高度 100% 再往回收一行的空柱子，
 * 出处右浮动并 clear 它，就被顶到最后一行的右边；超过两行时 line-clamp 截断的是句子，
 * 出处始终露在外面。高度 100% 要有确定的高度可依，所以外面套一层 flex（伸展的 flex 子项高度是确定的）。
 * 不用 color-mix / :has 这类新东西，Chrome 105 能跑
 */
.body {
  min-width: 0;
  display: flex;
}

.sentence {
  font-size: 13px;
  line-height: 18px;
  max-height: 36px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: v-bind("theme.textColor1");
}

.sentence::before {
  content: "";
  float: right;
  height: 100%;
  margin-bottom: -18px;
}

.source {
  float: right;
  clear: both;
  max-width: 60%;
  margin-left: 10px;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.refresh {
  width: 28px;
  height: 28px;
  flex: none;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 14px;
  background: transparent;
  color: v-bind("theme.textColor3");
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.refresh:hover {
  border-color: v-bind("theme.primaryColor");
  color: v-bind("theme.primaryColor");
}

.refresh.spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.full-text {
  font-size: 14px;
  line-height: 22px;
  color: var(--pop-text);
  white-space: pre-wrap;
}

.full-source {
  margin-top: 8px;
  font-size: 12px;
  color: var(--pop-muted);
}
</style>
