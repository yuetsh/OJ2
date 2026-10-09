<script setup lang="ts">
import { Icon } from "@iconify/vue"
import type { Quote } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { getHitokoto } from "../api"

/**
 * 一言（设计稿「一言重设计」A 版）：大引号 + 一行句子 + 「—— 谁《出处》」+ 一个看得见的「换一句」。
 * 分类（动画、诗词……）不显示；接口里的 type 只用来判断出处要不要加书名号。
 * 原来只能点句子换，没人知道；出处被截成「来自 Structure and Interpretatio…」。
 * 长句（数据集 p90 44 字、最长 255 字）一行放不下，点句子弹出全文。
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
    <n-popover trigger="click" placement="bottom-end" :width="420">
      <template #trigger>
        <div class="body" title="点一下看全文">
          <span class="sentence">{{ quote.hitokoto }}</span>
          <span v-if="source" class="source">—— {{ source }}</span>
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

.body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.sentence,
.source {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sentence {
  font-size: 13px;
  line-height: 18px;
  color: v-bind("theme.textColor1");
}

.source {
  font-size: 12px;
  line-height: 16px;
  color: v-bind("theme.textColor3");
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
