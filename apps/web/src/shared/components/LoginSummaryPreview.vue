<script setup lang="ts">
import { MdPreview } from "md-editor-v3"
import "md-editor-v3/lib/preview.css"

defineProps<{ modelValue: string }>()
</script>

<template>
  <MdPreview :model-value="modelValue" />
</template>
