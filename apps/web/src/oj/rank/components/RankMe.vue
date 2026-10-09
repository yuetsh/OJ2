<script setup lang="ts">
import type { RankRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import UserName from "shared/components/UserName.vue"
import { gapText, toPass } from "../utils"
import RankAvatar from "./RankAvatar.vue"

export interface MiniRank {
  label: string
  rank: number | null
  total: number | null
  go: () => void
}

/**
 * 「你」那张卡：大字第几名、比周一升了几名，一句最能推人一把的话（离领奖台几道 / 升了几名），
 * 再是两个对手 —— 前面那个要追的、后面那个在追你的，差几秒、差几道都写出来。
 */
const props = defineProps<{
  me: RankRow
  ahead: RankRow | null
  behind: RankRow | null
  /** 领奖台第 3 名（我不在台上时用来算「再做对几道上领奖台」） */
  third: RankRow | null
  total: number
  label: string
  minis: MiniRank[]
}>()

const theme = useThemeVars()

const headline = computed(() => {
  const { me, ahead, third } = props
  if (me.rank === 1) return "你是第一名，后面的人在追你"
  if (me.rank <= 3 && ahead)
    return `你在领奖台上 · 再做对 ${toPass(me, ahead)} 道就是第 ${ahead.rank} 名`
  if (third) {
    const need = toPass(me, third)
    if (need <= 3) return `再做对 ${need} 道，你就上领奖台`
  }
  if ((me.change ?? 0) >= 3) return `比周一升了 ${me.change} 名`
  if (ahead) return `再做对 ${toPass(me, ahead)} 道就是第 ${ahead.rank} 名`
  return ""
})

function chaseNote(me: RankRow, ahead: RankRow) {
  if (ahead.solved === me.solved && ahead.reachedAt && me.reachedAt)
    return `早你 ${gapText(ahead.reachedAt, me.reachedAt)}做到 ${me.solved} 道`
  return `比你多 ${ahead.solved - me.solved} 道`
}

function threatNote(me: RankRow, behind: RankRow) {
  if (behind.solved === me.solved && behind.reachedAt && me.reachedAt)
    return `只比你晚 ${gapText(me.reachedAt, behind.reachedAt)}，再做对 1 道就超过你`
  if (!behind.solved) return "还没做对"
  return `比你少 ${me.solved - behind.solved} 道`
}
</script>

<template>
  <div class="me-card">
    <div class="head">
      <RankAvatar :username="me.user.username" :avatar="me.avatar" :size="46" me />
      <div class="place">
        <span class="label">{{ label }}</span>
        <div class="big">
          <span>第</span><b>{{ me.rank }}</b
          ><span>名</span>
          <span class="total">/ {{ total }}</span>
          <span v-if="(me.change ?? 0) > 0" class="up">↑{{ me.change }}</span>
          <span v-else-if="(me.change ?? 0) < 0" class="down">↓{{ -me.change! }}</span>
        </div>
      </div>
    </div>
    <div v-if="headline" class="headline">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
      <b>{{ headline }}</b>
    </div>
    <div v-if="ahead" class="rival">
      <span class="tag chase">要追</span>
      <RankAvatar :username="ahead.user.username" :avatar="ahead.avatar" :size="20" />
      <UserName :username="ahead.user.username" class="rival-name" />
      <span class="note">{{ chaseNote(me, ahead) }}</span>
    </div>
    <div v-if="behind" class="rival">
      <span class="tag threat">追你</span>
      <RankAvatar :username="behind.user.username" :avatar="behind.avatar" :size="20" />
      <UserName :username="behind.user.username" class="rival-name" />
      <span class="note">{{ threatNote(me, behind) }}</span>
    </div>
    <div v-if="minis.length" class="minis">
      <button v-for="mini in minis" :key="mini.label" class="mini" @click="mini.go">
        <span class="mini-label">{{ mini.label }}</span>
        <b v-if="mini.rank"
          >第 {{ mini.rank }}<small v-if="mini.total"> / {{ mini.total }}</small></b
        >
        <b v-else class="none">没上榜</b>
      </button>
    </div>
  </div>
</template>

<style scoped>
.me-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(24, 160, 88, 0.45);
  border-radius: 6px;
  background: rgba(24, 160, 88, 0.07);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.place {
  display: flex;
  flex-direction: column;
}

.label {
  font-size: 12px;
  color: v-bind("theme.textColor2");
}

.big {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: #18a058;
}

.big b {
  font-size: 44px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.total {
  font-size: 13px;
  color: v-bind("theme.textColor3");
  margin-left: 2px;
}

.up,
.down {
  margin-left: 8px;
  font-size: 15px;
  font-weight: 600;
}

.down {
  color: v-bind("theme.errorColor");
}

.headline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px dashed rgba(24, 160, 88, 0.6);
  background: v-bind("theme.cardColor");
  color: #18a058;
  font-size: 14px;
}

.rival {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
}

.rival-name {
  flex-shrink: 0;
  max-width: 120px;
}

.note {
  font-size: 12px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
  flex-shrink: 0;
}

.tag.chase {
  color: #2f6fd0;
  background: rgba(47, 111, 208, 0.12);
}

.tag.threat {
  color: #c76a12;
  background: rgba(199, 106, 18, 0.12);
}

.minis {
  display: flex;
  gap: 6px;
}

.mini {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 10px;
  border: 0;
  border-radius: 4px;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font: inherit;
  cursor: pointer;
}

.mini:hover {
  color: v-bind("theme.primaryColor");
}

.mini-label {
  font-size: 11px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.mini b {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.mini small {
  font-size: 11px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.mini .none {
  font-weight: 400;
  color: v-bind("theme.textColor3");
}
</style>
