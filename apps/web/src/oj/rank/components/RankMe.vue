<script setup lang="ts">
import { MOOD_MAX, type RankRow } from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { updateProfile } from "oj/api"
import { useUserStore } from "shared/store/user"
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
 * 再是前一名、后一名，差几秒、差几道都写出来。
 *
 * 用词只说位置（前一名 / 后一名 / 进步最大），不用「追」「对手」「冲」：用户指出
 * 「要追的」「追你」会被中学生读成追求谁，「冲得最猛」也容易误会。
 *
 * 个性签名（设计稿「签名 A」）：自己的签名挂在大字下面，「改」就地改，不用跳去设置页；
 * 没写的给一句「写一句个性签名」。前一名、后一名的签名挂在他们名字下面。
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
  /** 手机：前后一名的说明换到名字下面一行，别被截断 */
  compact?: boolean
}>()
const emit = defineEmits<{ moodSaved: [mood: string | null] }>()

const theme = useThemeVars()
const message = useMessage()
const userStore = useUserStore()

const editing = ref(false)
const draft = ref("")
const saving = ref(false)

watch(editing, (open) => {
  if (open) draft.value = props.me.mood ?? ""
})

async function saveMood() {
  const mood = draft.value.trim()
  if (mood.length > MOOD_MAX) {
    message.warning(`个性签名最多 ${MOOD_MAX} 个字`)
    return
  }
  saving.value = true
  try {
    await updateProfile({ mood })
    if (userStore.profile) userStore.profile.mood = mood || null
    emit("moodSaved", mood || null)
    editing.value = false
    message.success(mood ? "签名改好了" : "签名清空了")
  } catch {
    message.error("没保存上，再试一次")
  } finally {
    saving.value = false
  }
}

const headline = computed(() => {
  const { me, ahead, third } = props
  if (me.rank === 1) return "你是第一名"
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
    return `比你早 ${gapText(ahead.reachedAt, me.reachedAt)}做到 ${me.solved} 道`
  return `比你多 ${ahead.solved - me.solved} 道`
}

function threatNote(me: RankRow, behind: RankRow) {
  if (behind.solved === me.solved && behind.reachedAt && me.reachedAt)
    return `比你晚 ${gapText(me.reachedAt, behind.reachedAt)}做到 ${me.solved} 道`
  if (!behind.solved) return "还没做对"
  return `比你少 ${me.solved - behind.solved} 道`
}
</script>

<template>
  <div class="me-card" :class="{ compact }">
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
    <n-popover
      v-model:show="editing"
      trigger="click"
      placement="bottom-start"
      :style="{ width: '300px' }"
    >
      <template #trigger>
        <button v-if="me.mood" class="mood" aria-label="改个性签名">
          <span class="quote-mark" aria-hidden="true">“</span>
          <n-ellipsis class="mood-text" :line-clamp="2" :tooltip="false">{{ me.mood }}</n-ellipsis>
          <span class="mood-edit">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            改
          </span>
        </button>
        <button v-else class="mood empty">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 20h4L19 9l-4-4L4 16z" />
          </svg>
          写一句个性签名，上了领奖台全班都看得到
        </button>
      </template>
      <form class="mood-form" @submit.prevent="saveMood">
        <label class="mood-label" for="rank-mood-input">个性签名</label>
        <n-input
          v-model:value="draft"
          :input-props="{ id: 'rank-mood-input' }"
          :maxlength="MOOD_MAX"
          show-count
          clearable
          placeholder="写点什么，让大家认识你"
          autofocus
        />
        <span class="mood-hint">排名、个人主页上都会显示</span>
        <div class="mood-actions">
          <n-button size="small" @click="editing = false">取消</n-button>
          <n-button size="small" type="primary" attr-type="submit" :loading="saving">
            保存
          </n-button>
        </div>
      </form>
    </n-popover>
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
      <span class="tag chase">前一名</span>
      <RankAvatar :username="ahead.user.username" :avatar="ahead.avatar" :size="20" />
      <div class="rival-body">
        <div class="rival-line">
          <UserName :username="ahead.user.username" class="rival-name" />
          <span class="note">{{ chaseNote(me, ahead) }}</span>
        </div>
        <span v-if="ahead.mood" class="rival-mood" :title="ahead.mood">“{{ ahead.mood }}”</span>
      </div>
    </div>
    <div v-if="behind" class="rival">
      <span class="tag threat">后一名</span>
      <RankAvatar :username="behind.user.username" :avatar="behind.avatar" :size="20" />
      <div class="rival-body">
        <div class="rival-line">
          <UserName :username="behind.user.username" class="rival-name" />
          <span class="note">{{ threatNote(me, behind) }}</span>
        </div>
        <span v-if="behind.mood" class="rival-mood" :title="behind.mood">“{{ behind.mood }}”</span>
      </div>
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
    <router-link to="/ai-analysis" class="analysis">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      </svg>
      看我的智能分析：哪类题卡得多、哪段时间最常做题 ›
    </router-link>
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
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
}

.rival > .tag {
  margin-top: 2px;
}

.rival-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rival-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.compact .rival-line {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.compact .note {
  white-space: normal;
}

.rival-mood {
  font-size: 12px;
  color: v-bind("theme.textColor3");
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mood {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(24, 160, 88, 0.3);
  border-radius: 6px;
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
}

.mood.empty {
  align-items: center;
  border-style: dashed;
  color: #18a058;
}

.mood:hover {
  border-color: #18a058;
}

.quote-mark {
  color: rgba(24, 160, 88, 0.55);
  font-family: Georgia, serif;
  font-size: 22px;
  line-height: 18px;
}

.mood-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.mood-edit {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding-top: 1px;
  font-size: 12px;
  color: #18a058;
  white-space: nowrap;
}

.mood-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mood-label {
  font-size: 13px;
  font-weight: 600;
}

.mood-hint {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.mood-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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

.analysis {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(24, 160, 88, 0.3);
  font-size: 13px;
  color: #2f6fd0;
  text-decoration: none;
}

.analysis:hover {
  text-decoration: underline;
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
