<script setup lang="ts">
import { copyToClipboard } from "utils/functions"
import { useMermaid } from "shared/composables/useMermaid"

const modelValue = defineModel<string>({ default: "" })
const mermaidContainer = useTemplateRef<HTMLElement>("mermaidContainer")

const { renderFlowchart, renderError, renderSuccess } = useMermaid()

// 上报渲染结果而不是只上报成功：调用方拿它做保存前校验，只进不出的话，
// 「先写对再改坏」照样能存进库
const emit = defineEmits<{
  renderState: [ok: boolean]
}>()

const renderMermaid = async () => {
  await renderFlowchart(mermaidContainer.value, modelValue.value)
  emit("renderState", renderSuccess.value)
}

onMounted(() => {
  nextTick(renderMermaid)
})

// 一改动就立刻把状态打回「未验证」，等防抖后的渲染真跑完再报结果。
// 只挂防抖那一支的话，改完 300ms 内点保存，读到的还是上一次渲染的结论 ——
// 刚改坏的代码会被当成校验通过。宁可让用户多等一下，也不能放脏数据进库。
watch(modelValue, () => emit("renderState", false))

// 出题页是边敲边预览，不防抖的话每个字符都会触发一次完整的 mermaid 渲染，
// 而中间态几乎全是语法错误
watchDebounced(modelValue, renderMermaid, { debounce: 300, maxWait: 1000 })

const clearCode = () => {
  modelValue.value = ""
}

const copyCode = () => {
  copyToClipboard(modelValue.value)
}

onBeforeUnmount(() => {
  if (mermaidContainer.value) {
    mermaidContainer.value.innerHTML = ""
  }
})
</script>

<template>
  <n-flex>
    <n-flex vertical>
      <n-flex align="center">
        <span>Mermaid 代码</span>
        <n-flex align="center">
          <n-button text @click="copyCode" size="small" type="primary">
            复制
          </n-button>
          <n-button text @click="clearCode" type="error" size="small">
            清空
          </n-button>
        </n-flex>
      </n-flex>
      <n-input
        class="code-editor"
        v-model:value="modelValue"
        type="textarea"
        :autosize="{ minRows: 10, maxRows: 20 }"
      />
    </n-flex>
    <n-flex vertical>
      <n-flex align="center" justify="space-between">
        <span>图表预览</span>
        <n-tag v-if="modelValue && renderSuccess" type="success" size="small">
          ✓ 渲染成功
        </n-tag>
      </n-flex>
      <n-alert
        v-if="renderError"
        type="error"
        title="Mermaid 语法错误"
        style="margin-bottom: 8px"
      >
        <n-text style="font-size: 12px">{{ renderError }}</n-text>
      </n-alert>
      <div ref="mermaidContainer" class="mermaid-container"></div>
    </n-flex>
  </n-flex>
</template>

<style scoped>
.code-editor {
  flex: 1;
  width: 400px;
}
.mermaid-container {
  width: 400px;
  min-height: 400px;
  border: 1px solid #d9d9d9;
  border-radius: 3px;
  padding: 16px;
}
</style>
