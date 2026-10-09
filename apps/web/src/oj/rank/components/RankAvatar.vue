<script setup lang="ts">
import { useDark } from "@vueuse/core"
import { rgba } from "oj/submission/composables/tone"
import { USERNAME_CLASS_RE } from "utils/constants"

/**
 * 排名页的头像。九成以上的学生没换过头像（1797 个号是 default.png），一排一模一样的
 * 默认图分不出人，所以默认头像画成「名字最后一个字 + 彩色圆」，颜色按用户名固定 ——
 * 同一个人在领奖台、赛道、对手卡里是同一个颜色。自己是实心绿。
 */
const props = defineProps<{
  username: string
  avatar: string | null
  size: number
  me?: boolean
}>()

const isDark = useDark()
/** 头像文件丢了（备份恢复后没拷上传目录、被删）就退回名字那个字，别露出破图 */
const broken = ref(false)
watch(
  () => props.avatar,
  () => (broken.value = false),
)

const PALETTE = ["#2f6fd0", "#c76a12", "#6a4bd8", "#0f7a6c", "#b4315f", "#4d5967", "#8a6a00"]

const letter = computed(() => {
  const name = props.username.replace(USERNAME_CLASS_RE, "") || props.username
  return Array.from(name).at(-1) ?? "?"
})

const colors = computed(() => {
  if (props.me) return { background: "#18a058", color: "#ffffff" }
  let hash = 0
  for (const char of props.username) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  const base = PALETTE[hash % PALETTE.length]!
  return { background: rgba(base, isDark.value ? 0.28 : 0.13), color: base }
})
</script>

<template>
  <img
    v-if="avatar && !broken"
    class="avatar"
    :src="avatar"
    alt=""
    @error="broken = true"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
  <span
    v-else
    class="avatar letter"
    aria-hidden="true"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.5)}px`,
      ...colors,
    }"
    >{{ letter }}</span
  >
</template>

<style scoped>
.avatar {
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  line-height: 1;
}
</style>
