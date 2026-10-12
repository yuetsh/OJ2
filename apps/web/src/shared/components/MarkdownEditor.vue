<template>
  <MdEditor
    ref="editor"
    :theme="isDark ? 'dark' : 'light'"
    v-model="modelValue"
    :preview="preview"
    :style="height ? { height } : undefined"
    @onUploadImg="onUploadImg"
  />
</template>

<script setup lang="ts">
import { MdEditor, type ExposeParam } from "md-editor-v3"
import "md-editor-v3/lib/style.css"
import { uploadImage } from "../../admin/api"

/**
 * `preview` 关掉自带的预览：教程编辑页右边要用学生端同一套组件预览（练一练、能运行的
 * 代码块），md-editor 自己那份预览认不出 `[[exercise:N]]`。
 */
const { preview = true, height } = defineProps<{ preview?: boolean; height?: string }>()

const isDark = useDark()
const editor = useTemplateRef<ExposeParam>("editor")

const modelValue = defineModel<string>("value")

const message = useMessage()

/** 在光标处插一段文字（教程编辑页插练一练占位符用），自成一行 */
function insert(text: string) {
  editor.value?.insert(() => ({
    targetValue: `\n${text}\n`,
    select: false,
    deviationStart: 0,
    deviationEnd: 0,
  }))
}

defineExpose({ insert })

const onUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  try {
    const res = await Promise.all(
      files.map(async (file) => {
        const path = await uploadImage(file)
        if (!path) {
          message.error("图片上传失败")
          return ""
        }
        return path
      }),
    )
    callback(res.filter((url) => url !== ""))
  } catch (err) {
    message.error("图片上传失败")
    callback([])
  }
}
</script>
