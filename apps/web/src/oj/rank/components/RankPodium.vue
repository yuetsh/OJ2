<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { useBreakpoints } from "shared/composables/breakpoints"
import UserName from "shared/components/UserName.vue"
import { useRankPalette } from "../palette"
import RankAvatar from "./RankAvatar.vue"

/**
 * 领奖台：前三名站在台阶上，第一名戴皇冠。赛道从第 4 名接着排，前三不再出现第二遍。
 * 你的前一名站在台上时台阶描蓝边、挂「前一名」，和赛道里的蓝条是一回事。
 *
 * 个性签名挂在台上（设计稿「签名 A」）：桌面是头像旁边一个气泡，像在说一句话；手机台阶窄，
 * 气泡放到头像上面。只露两行，长的指上去（手机点一下）看全文。老师能在气泡上清空它。
 */
const props = defineProps<{
  rows: RankRow[]
  meId?: number
  chaseId?: number
  threatId?: number
  teacher?: boolean
}>()
defineEmits<{ open: [username: string]; clearMood: [row: RankRow] }>()

const theme = useThemeVars()
const palette = useRankPalette()
const { isDesktop } = useBreakpoints()

/** 台阶从左到右是 2、1、3 */
const steps = computed(() =>
  [2, 1, 3]
    .map((place) => ({ place, row: props.rows[place - 1] }))
    .filter((step): step is { place: number; row: RankRow } => !!step.row),
)

const HEIGHTS: Record<number, number> = { 1: 50, 2: 38, 3: 30 }
</script>

<template>
  <div class="podium" :class="{ phone: !isDesktop }">
    <div v-for="{ place, row } in steps" :key="place" class="step" :class="`p${place}`">
      <div class="who">
        <span class="face">
          <svg
            v-if="place === 1"
            class="crown"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="#f2c94c"
            stroke="#9a6700"
            stroke-width="1.6"
            stroke-linejoin="round"
            role="img"
            aria-label="第一名"
          >
            <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
          </svg>
          <RankAvatar
            :username="row.user.username"
            :avatar="row.avatar"
            :size="place === 1 ? 34 : 28"
            :me="row.user.id === meId"
          />
        </span>
        <div class="words">
          <div class="name-line">
            <button class="name" @click="$emit('open', row.user.username)">
              <UserName :username="row.user.username" />
            </button>
            <span v-if="row.user.id === chaseId" class="tag chase">前一名</span>
            <span v-else-if="row.user.id === threatId" class="tag threat">后一名</span>
            <span v-else-if="row.user.id === meId" class="tag me">你</span>
          </div>
          <div v-if="row.mood" class="bubble">
            <n-ellipsis
              :line-clamp="2"
              :expand-trigger="isDesktop ? undefined : 'click'"
              :tooltip="isDesktop ? { contentStyle: { maxWidth: '300px' } } : false"
            >
              {{ row.mood }}
            </n-ellipsis>
            <button
              v-if="teacher"
              class="clear"
              aria-label="清空他的签名"
              title="清空他的签名"
              @click="$emit('clearMood', row)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
      <div
        class="block"
        :style="{
          height: `${HEIGHTS[place]}px`,
          background: palette.medal[place - 1]!.background,
          boxShadow:
            row.user.id === chaseId
              ? `inset 0 0 0 2px ${palette.chase}`
              : row.user.id === meId
                ? `inset 0 0 0 2px ${palette.me}`
                : undefined,
        }"
      >
        <span class="place" :style="{ color: palette.medal[place - 1]!.color }">{{ place }}</span>
        <span class="solved"
          ><b>{{ row.solved }}</b
          ><small>道</small></span
        >
      </div>
    </div>
    <span v-if="!steps.length" class="empty">还没有人做对，现在做对 1 道就是第一名</span>
  </div>
</template>

<style scoped>
.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  margin: 0 16px;
  border-bottom: 2px solid v-bind("theme.dividerColor");
  min-height: 60px;
}

.step {
  flex: 0 1 272px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 桌面：头像在左，右边名字一行、签名气泡一行，像一句聊天 */
.who {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 0 4px;
  min-width: 0;
}

.face {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.crown {
  position: absolute;
  left: -7px;
  top: -11px;
  transform: rotate(-18deg);
}

.words {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.bubble {
  position: relative;
  padding: 3px 9px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 8px;
  background: v-bind("theme.actionColor");
  font-size: 12px;
  line-height: 16px;
  color: v-bind("theme.textColor2");
  word-break: break-all;
}

.clear {
  position: absolute;
  right: -7px;
  top: -7px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 8px;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor3");
  font-size: 12px;
  line-height: 13px;
  cursor: pointer;
  display: none;
}

.bubble:hover .clear,
.clear:focus-visible {
  display: block;
}

.clear:hover {
  color: v-bind("theme.errorColor");
  border-color: v-bind("theme.errorColor");
}

/* 手机：台阶窄，气泡挪到头像上面，下面依次头像、名字 */
.phone .step {
  flex: 1 1 0;
  gap: 3px;
}

.phone .who {
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0;
}

.phone .words {
  display: contents;
}

.phone .name-line {
  max-width: 100%;
  flex-direction: column;
  gap: 1px;
}

.phone .face {
  order: -1;
  margin-top: 14px;
}

.phone .crown {
  left: 50%;
  top: -17px;
  margin-left: -9px;
  transform: none;
}

.phone .bubble {
  order: -2;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 4px;
  padding: 3px 6px;
  font-size: 11.5px;
  line-height: 15px;
}

.phone .bubble::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  background: v-bind("theme.actionColor");
  border-right: 1px solid v-bind("theme.dividerColor");
  border-bottom: 1px solid v-bind("theme.dividerColor");
  transform: rotate(45deg);
}

.tag {
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
}

.tag.chase {
  color: v-bind("palette.chase");
  background: rgba(47, 111, 208, 0.12);
}

.tag.threat {
  color: v-bind("palette.threat");
  background: rgba(199, 106, 18, 0.12);
}

.tag.me {
  color: v-bind("palette.me");
  background: rgba(24, 160, 88, 0.12);
}

.name {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  min-width: 0;
}

.block {
  width: 100%;
  box-sizing: border-box;
  border-radius: 6px 6px 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  padding-top: 5px;
}

.place {
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}

.solved {
  font-variant-numeric: tabular-nums;
}

.solved b {
  font-size: 16px;
}

.solved small {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  margin-left: 1px;
}

.empty {
  padding: 18px 0;
  color: v-bind("theme.textColor3");
  font-size: 13px;
}
</style>
