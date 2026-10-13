<script lang="ts" setup>
import { bracketMatching } from "@codemirror/language"
import CodeMirror from "./CodeMirror.vue"
import type { Extension } from "@codemirror/state"
import { autocompletion, closeBrackets, completeAnyWord } from "@codemirror/autocomplete"
import type { LANGUAGE } from "utils/types"
import { darkCodeTheme, lightCodeTheme } from "../themes/codeTheme"
import { styleTheme } from "shared/extensions/baseTheme"
import { enhanceCompletion } from "shared/extensions/autocompletion"
import { languageExtension } from "shared/extensions/language"

interface Props {
  language?: LANGUAGE
  fontSize?: number
  height?: string
  readonly?: boolean
  placeholder?: string
  /** 追加的 CodeMirror 扩展。传一个稳定的数组实例，每次渲染新建会让编辑器反复重配 */
  extraExtensions?: Extension[]
}

const {
  language = "Python",
  fontSize = 20,
  height = "100%",
  readonly = false,
  placeholder = "",
  extraExtensions = [],
} = defineProps<Props>()
const code = defineModel<string>("value")

const isDark = useDark()

const langExtension = computed(() => languageExtension(language))

const extensions = computed(() => [
  styleTheme,
  langExtension.value,
  bracketMatching(),
  closeBrackets(),
  autocompletion({
    override: [enhanceCompletion(language), completeAnyWord],
  }),
  isDark.value ? darkCodeTheme : lightCodeTheme,
  ...extraExtensions,
])
</script>

<template>
  <CodeMirror
    v-model="code"
    :extensions="extensions"
    :disabled="readonly"
    :tab-size="4"
    :placeholder="placeholder"
    :height="height"
    :font-size="`${fontSize}px`"
  />
</template>
