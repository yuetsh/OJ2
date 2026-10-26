import { parseLanguage } from '@oj2/contract'
import { defineStore } from 'pinia'
import { STORAGE_KEY } from 'utils/constants'
import storage from 'utils/storage'
import type { Code, LANGUAGE } from 'utils/types'

/**
 * 代码编辑器状态管理 Store
 * 管理全局的代码、输入、输出状态
 */
function savedCodeLanguage() {
  const saved = parseLanguage(storage.get(STORAGE_KEY.LANGUAGE))
  return saved && saved !== 'Flowchart' ? saved : null
}

export const useCodeStore = defineStore('code', () => {
  // ==================== 状态 ====================
  const code = reactive<Code>({
    value: '',
    language: savedCodeLanguage() ?? 'Python',
  })

  const input = ref('')
  const output = ref('')

  // ==================== 计算属性 ====================
  const isEmpty = computed(() => code.value.trim() === '')

  // ==================== 操作 ====================
  /**
   * 设置代码内容
   */
  function setCode(value: string) {
    code.value = value
  }

  /**
   * 设置编程语言
   */
  function setLanguage(language: LANGUAGE) {
    code.language = language
  }

  /**
   * 设置输入
   */
  function setInput(value: string) {
    input.value = value
  }

  /**
   * 设置输出
   */
  function setOutput(value: string) {
    output.value = value
  }

  /**
   * 重置所有状态
   */
  function reset() {
    code.value = ''
    input.value = ''
    output.value = ''
  }

  /**
   * 清空输出
   */
  function clearOutput() {
    output.value = ''
  }

  /**
   * 语言变了就记下来，下一道题默认用它。**不记 Flowchart**：那是「画流程图」这种作业，
   * 不是编程语言偏好 —— 记下来的话，画完一道流程图题，下一道能画的题一打开就是画布，
   * 而学生这节课要写的是代码。切回「写代码」时用的也是这份偏好。
   */
  watch(
    () => code.language,
    (newLanguage) => {
      if (newLanguage !== 'Flowchart') storage.set(STORAGE_KEY.LANGUAGE, newLanguage)
    },
  )

  /** 学生习惯用的编程语言（从来不会是 Flowchart） */
  function preferredLanguage(): LANGUAGE {
    return savedCodeLanguage() ?? 'Python'
  }

  return {
    // 状态
    code,
    input,
    output,

    // 计算属性
    isEmpty,

    // 操作
    setCode,
    setLanguage,
    preferredLanguage,
    setInput,
    setOutput,
    reset,
    clearOutput,
  }
})
