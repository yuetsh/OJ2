<script setup lang="ts">
import { sortSpans, type LabelingSpan } from '@oj2/contract'
import { labelColor } from '../utils/colors'

/** 只读的一句话：标出来的段高亮，段后跟一个小字类别名（错题页、后台列表、全班情况都用它） */
const props = defineProps<{ text: string; spans: LabelingSpan[]; labels: string[] }>()

const isDark = useDark()

const pieces = computed(() => {
  const chars = Array.from(props.text)
  const out: { text: string; label: string | null }[] = []
  let at = 0
  for (const span of sortSpans(props.spans)) {
    if (span.start < at || span.end > chars.length) continue
    if (span.start > at) out.push({ text: chars.slice(at, span.start).join(''), label: null })
    out.push({ text: chars.slice(span.start, span.end).join(''), label: span.label })
    at = span.end
  }
  if (at < chars.length) out.push({ text: chars.slice(at).join(''), label: null })
  return out
})
</script>

<template>
  <span class="spanText"
    ><template v-for="(p, i) in pieces" :key="i"
      ><span v-if="p.label" class="mark" :style="{ background: labelColor(labels, p.label, isDark).bg, color: labelColor(labels, p.label, isDark).fg }"
        >{{ p.text }}<span class="tag" :style="{ color: labelColor(labels, p.label, isDark).tag }">{{ p.label }}</span></span
      ><template v-else>{{ p.text }}</template></template
    ></span
  >
</template>

<style scoped>
.spanText {
  line-height: 2;
  overflow-wrap: anywhere;
}

.mark {
  padding: 2px 4px;
  border-radius: 4px;
}

.tag {
  margin-left: 3px;
  font-size: 0.7em;
  font-weight: 600;
}
</style>
