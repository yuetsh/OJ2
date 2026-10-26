<script setup lang="ts">
/** 挑战的标记：一枚筹码（借的是小丑牌的赌注筹码），设计稿「做对后再挑战」 */
withDefaults(defineProps<{ size?: number }>(), { size: 14 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke-linecap="round" />
  </svg>
</template>
