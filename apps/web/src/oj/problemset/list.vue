<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { getProblemSetList } from "oj/api"
import { rgba, useTone } from "oj/submission/composables/tone"
import { parseTime } from "utils/functions"
import type { ProblemSet } from "utils/types"
import { badgeCondition, ladder, nextBadge } from "./badges"

/**
 * 题单列表（设计稿「题单重设计」列表 A）：老师正在布置的题单单独一排大卡片 —— 做对几道、
 * 布置到哪天、再做对几道拿哪个奖章；其余题单一排排小卡片，加入过的在前。
 *
 * 题单一共十几个，一次全取回来在前端分组，不分页
 */
const router = useRouter()
const theme = useThemeVars()
const tone = useTone()

const sets = ref<ProblemSet[]>([])
const loaded = ref(false)
const keyword = ref("")

onMounted(async () => {
  try {
    sets.value = (await getProblemSetList(0, 250)).results
  } finally {
    loaded.value = true
  }
})

const shown = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return sets.value
  return sets.value.filter(
    (set) => set.title.toLowerCase().includes(word) || set.description.toLowerCase().includes(word),
  )
})

/** 布置中的：快到期的在前 */
const assigning = computed(() =>
  shown.value
    .filter((set) => set.assigning)
    .sort((a, b) => Date.parse(a.assignedUntil!) - Date.parse(b.assignedUntil!)),
)

/** 其他：加入过的在前（最近加入的最前），再按新建排 */
const others = computed(() =>
  shown.value
    .filter((set) => !set.assigning)
    .sort((a, b) => {
      const ja = a.userProgress.joinTime
      const jb = b.userProgress.joinTime
      if (ja && jb) return Date.parse(jb) - Date.parse(ja)
      if (ja || jb) return ja ? -1 : 1
      return Date.parse(b.createTime) - Date.parse(a.createTime)
    }),
)

function description(set: ProblemSet) {
  // 简介大多就是把标题再抄一遍，一样的就不重复显示
  return set.description && set.description !== set.title ? set.description : ""
}

function optional(set: ProblemSet) {
  return set.problemsCount - set.requiredCount
}

function percent(set: ProblemSet) {
  const progress = set.userProgress
  return progress.isJoined && set.requiredCount
    ? Math.min(100, (progress.completedCount / set.requiredCount) * 100)
    : 0
}

function open(set: ProblemSet) {
  router.push({ name: "problemset", params: { problemSetId: set.id } })
}

const info = computed(() => tone("info"))
const success = computed(() => tone("success"))
// 做完的卡片只淡淡地染一点绿（设计稿），用 success.background 那一档太抢眼
const doneBackground = computed(() => rgba(theme.value.successColor, 0.05))
</script>

<template>
  <div class="page oj-page">
    <div class="top">
      <h2>题单</h2>
      <div class="spacer"></div>
      <n-input v-model:value="keyword" placeholder="搜题单" clearable class="search" />
    </div>

    <template v-if="assigning.length">
      <div class="sect">
        布置中<span class="muted">{{ assigning.length }} 个</span>
      </div>
      <div class="big-grid">
        <a
          v-for="set in assigning"
          :key="set.id"
          :href="`/problemset/${set.id}`"
          class="card big"
          :class="{ done: set.userProgress.isCompleted }"
          @click.prevent="open(set)"
        >
          <div class="row">
            <b class="ell title">{{ set.title }}</b>
            <span v-if="set.userProgress.isCompleted" class="pill done-pill">✓ 做完了</span>
          </div>
          <div class="muted ell desc">{{ description(set) }}</div>
          <div class="row baseline">
            <template v-if="set.userProgress.isJoined">
              <span class="num count">{{ set.userProgress.completedCount }}</span>
              <span class="muted num">/ {{ set.requiredCount }}</span>
            </template>
            <span v-else class="muted small">还没加入 · {{ set.requiredCount }} 道</span>
            <span v-if="optional(set) > 0" class="muted tiny">另有 {{ optional(set) }} 道选做</span>
            <div class="spacer"></div>
            <span class="pill assign">布置到 {{ parseTime(set.assignedUntil!, "M月D日") }}</span>
          </div>
          <div class="bar"><div class="fill" :style="{ width: `${percent(set)}%` }"></div></div>
          <div v-if="nextBadge(set)" class="row hint">
            <img :src="nextBadge(set)!.badge.icon" alt="" class="icon locked" />
            <span>
              再做对 <b class="num">{{ nextBadge(set)!.left }}</b> 道拿「{{
                nextBadge(set)!.badge.name
              }}」
            </span>
          </div>
          <div v-else-if="set.badges.length" class="row hint got">
            <img
              v-for="badge in ladder(set)"
              :key="badge.id"
              :src="badge.icon"
              :alt="badge.name"
              :title="badge.name"
              class="icon"
            />
            <span>奖章全拿到了</span>
          </div>
          <div v-else class="muted hint">这个题单没有奖章</div>
        </a>
      </div>
    </template>

    <div v-if="others.length" class="sect">
      {{ assigning.length ? "其他题单" : "题单" }}
      <span class="muted">{{ others.length }} 个</span>
    </div>
    <div class="small-grid">
      <a
        v-for="set in others"
        :key="set.id"
        :href="`/problemset/${set.id}`"
        class="card small-card"
        :class="{ done: set.userProgress.isCompleted }"
        @click.prevent="open(set)"
      >
        <div class="row">
          <b class="ell">{{ set.title }}</b>
          <span v-if="set.userProgress.isCompleted" class="green tiny">✓</span>
        </div>
        <div class="row tiny">
          <span v-if="set.userProgress.isJoined" class="num">
            做对 <b>{{ set.userProgress.completedCount }}</b> / {{ set.requiredCount }}
          </span>
          <span v-else class="muted num"
            >{{ set.problemsCount }} 道 · {{ set.joinedCount }} 人做过</span
          >
          <div class="spacer"></div>
          <img
            v-for="badge in ladder(set)"
            :key="badge.id"
            :src="badge.icon"
            :alt="badge.name"
            :title="`${badge.name} · ${badgeCondition(badge)}${badge.isEarned ? ' · 已拿到' : ''}`"
            class="mini"
            :class="{ locked: !badge.isEarned }"
          />
        </div>
      </a>
    </div>

    <n-empty
      v-if="loaded && !shown.length"
      :description="keyword ? '没有找到这样的题单' : '还没有题单'"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--oj-gap);
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.top h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.search {
  width: 220px;
}

.spacer {
  flex-grow: 1;
}

.sect {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: -6px;
  font-size: var(--oj-fs-h2);
  font-weight: 700;
  color: v-bind("theme.textColor1");
}

.sect .muted {
  font-size: var(--oj-fs-sec);
  font-weight: 400;
}

.muted {
  color: v-bind("theme.textColor3");
}

.green {
  color: v-bind("success.color");
}

.small {
  font-size: var(--oj-fs-sec);
  white-space: nowrap;
}

.tiny {
  font-size: var(--oj-fs-meta);
  white-space: nowrap;
}

.num {
  font-variant-numeric: tabular-nums;
}

.ell {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row.baseline {
  align-items: baseline;
}

/* 1200 限宽下布置中是一行三张、其他题单一行四张；原来一行四张的大卡只有 280 宽，
   「还没加入 · 9 道」和「另有 1 道选做」都被挤成两行 */
.big-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.small-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 14px;
}

.card {
  box-sizing: border-box;
  min-width: 0;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
  color: v-bind("theme.textColor1");
  text-decoration: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.card:hover {
  border-color: v-bind("theme.primaryColor");
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.card.done {
  background: v-bind("doneBackground");
}

.big {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  flex-grow: 1;
  font-size: 18px;
}

.desc {
  height: 20px;
  font-size: var(--oj-fs-meta);
}

.count {
  font-size: 26px;
  font-weight: 700;
}

.pill {
  height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.assign {
  color: v-bind("info.color");
  background: v-bind("info.background");
}

.done-pill {
  color: v-bind("success.color");
  background: v-bind("success.background");
  font-weight: 600;
}

.bar {
  height: 6px;
  border-radius: 3px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.fill {
  height: 100%;
  background: v-bind("theme.successColor");
}

.hint {
  height: 22px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor2");
}

.hint.got {
  gap: 4px;
  color: v-bind("success.color");
}

.hint.got span {
  margin-left: 4px;
}

.icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.mini {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.locked {
  filter: grayscale(1);
  opacity: 0.4;
}

.small-card {
  height: 88px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.small-card b {
  font-size: var(--oj-fs-body);
}
</style>
