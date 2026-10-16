<script setup lang="ts">
import { MOOD_MAX, STUDENT_ROLES, type ProfileOverview } from "@oj2/contract"
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { clearMood, setRankHidden, updateProfile } from "oj/api"
import RankAvatar from "oj/rank/components/RankAvatar.vue"
import { classLabel } from "utils/classes"
import UserName from "shared/components/UserName.vue"
import { useUserStore } from "shared/store/user"
import { durationToDays, parseTime } from "utils/functions"
import type { Profile } from "utils/types"
import AvatarCropModal from "./AvatarCropModal.vue"

/**
 * 个人主页顶上那张名片（设计稿「我的主页与设置」定稿）：头像、名字、班级、签名、三个数，
 * 底下一排四个时间。设置并进了这里 —— 自己的主页上点头像换头像、点笔改签名，
 * 没有单独的设置页了。
 */
const props = defineProps<{
  profile: Profile
  overview: ProfileOverview
  isSelf: boolean
  /** 老师在看学生：三个数的最后一格换成「交过还没做对」，按钮换成看他的… */
  teacherView: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ changed: [] }>()

const theme = useThemeVars()
const message = useMessage()
const dialog = useDialog()
const userStore = useUserStore()

const username = computed(() => props.profile.user.username)
const avatar = computed(() =>
  props.profile.avatar.endsWith("/default.png") ? null : props.profile.avatar,
)
const isStudent = computed(() =>
  (STUDENT_ROLES as readonly string[]).includes(props.profile.user.adminType),
)

interface Stat {
  big: string | number
  unit: string
  sub: string
  warn?: boolean
  link?: { text: string; to: string }
}

const stats = computed(() => {
  const o = props.overview
  const list: Stat[] = [{ big: o.solved.length, unit: "道", sub: "做对" }]
  if (o.classRank)
    list.push({
      big: `第 ${o.classRank.rank}`,
      unit: "名",
      sub: props.compact ? `本班 ${o.classRank.total} 人` : `本班 · 这学期 ${o.classRank.total} 人`,
      link: props.isSelf ? { text: "看排名 ›", to: "/rank" } : undefined,
    })
  else if (o.rankHidden) list.push({ big: "不计入", unit: "排名", sub: "本班 · 这学期" })
  if (props.teacherView)
    list.push({ big: o.unsolved?.length ?? 0, unit: "道", sub: "交过还没做对", warn: true })
  else
    list.push({
      big: o.achievements.unlocked.length,
      unit: "个",
      sub: `成就 · 一共 ${o.achievements.total} 个`,
    })
  return list
})

const times = computed(() => {
  const o = props.overview
  if (!o.firstSubmissionAt || !o.latestSubmissionAt) return []
  return [
    { label: "第一次提交", value: parseTime(o.firstSubmissionAt) },
    { label: "最近一次提交", value: parseTime(o.latestSubmissionAt) },
    {
      label: "距上次提交",
      // durationToDays 给的是「13天」「1月2天」，和旁边「13 天」对齐，数字和单位之间空一格
      value: durationToDays(o.latestSubmissionAt, o.now).replace(/(\d)(?=[年月天])/g, "$1 "),
    },
    { label: "学习天数", value: `${o.activeDays} 天` },
  ]
})

// ---------- 改签名（就地） ----------
const editing = ref(false)
const draft = ref("")
const saving = ref(false)

function startEdit() {
  draft.value = props.profile.mood ?? ""
  editing.value = true
}

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
    editing.value = false
    message.success(mood ? "签名改好了" : "签名清空了")
    emit("changed")
  } catch {
    message.error("没保存上，再试一次")
  } finally {
    saving.value = false
  }
}

// ---------- 换头像 ----------
const cropping = ref(false)

// ---------- 老师的「⋯」 ----------
const menu = computed(() => {
  const items = []
  if (isStudent.value) {
    items.push({
      key: "hidden",
      label: props.overview.rankHidden ? "恢复计入排名" : "不计入排名",
    })
    items.push({ key: "mood", label: "清空个性签名", disabled: !props.profile.mood })
  }
  if (userStore.isSuperAdmin) items.push({ key: "admin", label: "在后台找这个人" })
  return items
})

const router = useRouter()

function onMenu(key: string) {
  const id = props.profile.user.id
  if (key === "admin") {
    router.push({ name: "admin user list", query: { keyword: username.value } })
  } else if (key === "hidden") {
    const hide = !props.overview.rankHidden
    setRankHidden(id, hide)
      .then(() => {
        message.success(hide ? "已设成不计入排名" : "已恢复计入排名")
        emit("changed")
      })
      .catch(() => message.error("没改成，再试一次"))
  } else if (key === "mood") {
    dialog.warning({
      title: "清空个性签名",
      content: `「${props.profile.mood}」会被清掉，他之后还能重新写。`,
      positiveText: "清空",
      negativeText: "取消",
      onPositiveClick: () =>
        clearMood(id)
          .then(() => {
            message.success("签名清空了")
            emit("changed")
          })
          .catch(() => message.error("没清掉，再试一次")),
    })
  }
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <div class="top">
      <div class="who">
        <button
          v-if="isSelf"
          type="button"
          class="avatar-btn"
          aria-label="换头像"
          @click="cropping = true"
        >
          <RankAvatar :username="username" :avatar="avatar" :size="compact ? 64 : 96" me />
          <span class="avatar-hover"><Icon icon="ph:camera" :width="20" />换头像</span>
          <span class="avatar-badge"><Icon icon="ph:camera" :width="compact ? 14 : 16" /></span>
        </button>
        <RankAvatar v-else :username="username" :avatar="avatar" :size="compact ? 64 : 96" />

        <div class="info">
          <div class="name-line">
            <UserName :username="username" class="name" />
            <span v-if="profile.user.className" class="muted">
              {{ classLabel(profile.user.className) }}
            </span>
          </div>

          <form v-if="editing" class="mood-edit" @submit.prevent="saveMood">
            <n-input
              v-model:value="draft"
              :maxlength="MOOD_MAX"
              show-count
              clearable
              autofocus
              placeholder="写点什么，让大家认识你"
              aria-label="个性签名"
            />
            <n-button type="primary" attr-type="submit" :loading="saving">保存</n-button>
            <n-button @click="editing = false">取消</n-button>
          </form>
          <template v-else-if="isSelf">
            <span v-if="profile.mood" class="mood">
              {{ profile.mood }}
              <button type="button" class="icon-btn" aria-label="改个性签名" @click="startEdit">
                <Icon icon="ph:pencil-simple" :width="16" />
              </button>
            </span>
            <button v-else type="button" class="write-mood" @click="startEdit">
              <Icon icon="ph:pencil-simple" :width="14" />写一句个性签名
            </button>
          </template>
          <span v-else-if="profile.mood" class="mood">{{ profile.mood }}</span>
          <span v-else-if="teacherView" class="mood faint">没写个性签名</span>

          <div v-if="!compact && (isSelf || teacherView)" class="actions">
            <template v-if="isSelf">
              <n-button size="small" @click="router.push('/ai-analysis')">
                <template #icon><Icon icon="ph:sparkle" /></template>智能分析
              </n-button>
              <n-button size="small" @click="router.push('/submission?myself=1')">
                <template #icon><Icon icon="ph:list-checks" /></template>我的提交
              </n-button>
            </template>
            <template v-else>
              <n-button
                size="small"
                type="primary"
                @click="router.push({ name: 'ai', query: { username } })"
              >
                <template #icon><Icon icon="ph:sparkle" /></template>看他的智能分析
              </n-button>
              <n-button
                size="small"
                @click="
                  router.push({ path: '/submission', query: { username, exactUsername: '1' } })
                "
              >
                <template #icon><Icon icon="ph:list-checks" /></template>看他的提交
              </n-button>
              <n-dropdown v-if="menu.length" :options="menu" trigger="click" @select="onMenu">
                <n-button size="small" aria-label="更多">
                  <template #icon><Icon icon="ph:dots-three-bold" /></template>
                </n-button>
              </n-dropdown>
            </template>
          </div>
        </div>
      </div>

      <div class="stats">
        <div v-for="item in stats" :key="item.sub" class="stat">
          <div class="num">
            <b :class="{ warn: item.warn }">{{ item.big }}</b>
            <span>{{ item.unit }}</span>
          </div>
          <div class="sub">{{ item.sub }}</div>
          <router-link v-if="item.link && !compact" :to="item.link.to" class="link">
            {{ item.link.text }}
          </router-link>
        </div>
      </div>
    </div>

    <div v-if="times.length" class="times">
      <div v-for="item in times" :key="item.label" class="time">
        <span class="muted">{{ item.label }}</span>
        <b>{{ item.value }}</b>
      </div>
    </div>
    <div v-else class="times empty muted">还没交过题</div>

    <div v-if="compact && (isSelf || teacherView)" class="actions wide">
      <template v-if="isSelf">
        <n-button @click="router.push('/ai-analysis')">
          <template #icon><Icon icon="ph:sparkle" /></template>智能分析
        </n-button>
        <n-button @click="router.push('/submission?myself=1')">
          <template #icon><Icon icon="ph:list-checks" /></template>我的提交
        </n-button>
      </template>
      <template v-else>
        <n-button type="primary" @click="router.push({ name: 'ai', query: { username } })">
          看他的智能分析
        </n-button>
        <n-button
          @click="router.push({ path: '/submission', query: { username, exactUsername: '1' } })"
        >
          看他的提交
        </n-button>
      </template>
    </div>

    <AvatarCropModal
      v-if="isSelf"
      v-model:show="cropping"
      :username="username"
      :avatar="avatar"
      @changed="emit('changed')"
    />
  </section>
</template>

<style scoped>
.card {
  padding: 22px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

.top {
  display: flex;
  align-items: center;
  gap: 22px;
}

.who {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 22px;
}

.avatar-btn {
  position: relative;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  border-radius: 50%;
  cursor: pointer;
}

.avatar-hover {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: var(--oj-fs-meta);
  opacity: 0;
  transition: opacity 0.15s;
}

.avatar-btn:hover .avatar-hover,
.avatar-btn:focus-visible .avatar-hover {
  opacity: 1;
}

.avatar-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 32px;
  height: 32px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1px solid v-bind("theme.borderColor");
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor2");
  display: flex;
  align-items: center;
  justify-content: center;
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.name-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  max-width: 100%;
}

.name {
  font-size: var(--oj-fs-title);
}

.name :deep(.name) {
  font-weight: 700;
}

.muted {
  font-size: var(--oj-fs-sec);
  color: v-bind("theme.textColor3");
  white-space: nowrap;
}

.mood {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  font-size: var(--oj-fs-body);
  color: v-bind("theme.textColor2");
  word-break: break-all;
}

.mood.faint {
  color: v-bind("theme.textColor3");
}

.icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.icon-btn:hover {
  color: #18a058;
  background: rgba(24, 160, 88, 0.1);
}

.write-mood {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px dashed rgba(24, 160, 88, 0.5);
  border-radius: 15px;
  background: none;
  color: #18a058;
  font: inherit;
  font-size: var(--oj-fs-sec);
  cursor: pointer;
}

.mood-edit {
  display: flex;
  gap: 8px;
  width: 440px;
  max-width: 100%;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.stats {
  display: flex;
  align-items: flex-start;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 24px;
  border-left: 1px solid v-bind("theme.dividerColor");
  white-space: nowrap;
}

.stat:first-child {
  border-left: 0;
}

.num {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.num b {
  font-size: 30px;
  line-height: 38px;
  font-variant-numeric: tabular-nums;
}

.num b.warn {
  color: #c27c0e;
}

.num span {
  font-size: var(--oj-fs-body);
}

.sub {
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor3");
}

.link {
  font-size: var(--oj-fs-meta);
  color: #18a058;
  text-decoration: none;
}

.times {
  display: flex;
  flex-wrap: wrap;
  row-gap: 12px;
  padding: 14px 0 0 118px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.times.empty {
  font-size: var(--oj-fs-sec);
}

.time {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 20px;
  border-left: 1px solid v-bind("theme.dividerColor");
}

.time:first-child {
  padding-left: 0;
  border-left: 0;
}

.time .muted {
  font-size: var(--oj-fs-meta);
}

.time b {
  font-size: var(--oj-fs-body);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 手机：名片竖着排，三个数一排一个框，四个时间两两一排 */
.compact {
  padding: 18px 16px 16px;
  gap: 12px;
}

.compact .top {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.compact .who {
  gap: 14px;
  align-items: flex-start;
}

.compact .name-line {
  flex-direction: column;
  gap: 2px;
}

.compact .name {
  font-size: 20px;
}

.compact .mood-edit {
  flex-wrap: wrap;
}

.compact .avatar-badge {
  width: 26px;
  height: 26px;
  right: -4px;
  bottom: -4px;
}

.compact .stats {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  padding: 10px 0 8px;
}

.compact .stat {
  flex: 1;
  align-items: center;
  padding: 0 4px;
}

.compact .num b {
  font-size: 22px;
  line-height: 28px;
}

.compact .num span {
  font-size: var(--oj-fs-meta);
}

.compact .sub {
  font-size: 12px;
  white-space: normal;
  text-align: center;
}

.compact .times {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  padding: 2px 4px 0;
  border-top: 0;
}

.compact .time {
  padding: 0;
  border-left: 0;
}

.actions.wide {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-top: 0;
}
</style>
