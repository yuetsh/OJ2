<script setup lang="ts">
import { TIME_ZONE_OFFSET_MINUTES, type MascotJournal } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { getMascotJournal } from 'oj/api'
import { fishLeft, mascotProfile } from 'shared/mascot/behavior'
import { MASCOT_QUESTIONS } from 'shared/mascot/chat'
import { buildCollection } from 'shared/mascot/collection'
import { MASCOT_POSES, poseUrl } from 'shared/mascot/poses'
import { parseTime } from 'utils/functions'

/**
 * 主页上「小鲸鱼」那张卡：和看板娘的相处记录，点开看全的（各种互动几次、一天里什么时候来找她、
 * 回答过她的问题、见过她的样子、台词收集）。只在自己的主页、学生、电脑上有（她只在电脑上出现）。
 * 从没碰过她就不显示。
 */
const theme = useThemeVars()
const journal = ref<MascotJournal | null>(null)
const open = ref(false)

onMounted(async () => {
  try {
    journal.value = await getMascotJournal()
  } catch {
    // 拉不到就不显示这张卡
  }
})

const DAY_MS = 86_400_000
const dayIndex = (ms: number) => Math.floor((ms + TIME_ZONE_OFFSET_MINUTES * 60_000) / DAY_MS)
/** 认识第几天（东八区日历日，认识那天是第 1 天） */
const knownDays = computed(() => (journal.value?.firstAt ? dayIndex(Date.now()) - dayIndex(Date.parse(journal.value.firstAt)) + 1 : 0))

const collection = computed(() => buildCollection(journal.value?.lines ?? []))

const tiles = computed(() => {
  const c = journal.value?.counts
  if (!c) return []
  return [
    { label: '点她说话', value: c.opens },
    { label: '她找你说话', value: c.spoken },
    { label: '点她的按钮', value: c.actions },
    { label: '摸头', value: c.pats },
    { label: '惹到背过身', value: c.sulks },
    { label: '拖着挪地方', value: c.moves },
    { label: '藏到屏幕边上', value: c.peeks },
    { label: '甩出去', value: c.flings },
    { label: '拎着摇晕', value: c.shakes },
    { label: '挠痒', value: c.tickles },
    { label: '喂小鱼干', value: c.feeds },
    { label: '换衣服', value: c.dresses },
  ]
})

const PAGE_NAMES: Record<string, string> = {
  '': '首页',
  problem: '题目',
  problemset: '题单',
  submission: '提交',
  rank: '排名',
  learn: '自学',
  user: '主页',
  achievement: '成就',
  contest: '比赛',
  pk: '班级 PK',
  announcement: '公告',
  'ai-analysis': '智能分析',
  statistics: '统计',
}
const favoritePage = computed(() => {
  const page = journal.value?.favoritePage
  return page === null || page === undefined ? null : (PAGE_NAMES[page] ?? null)
})

const hours = computed(() => {
  const list = journal.value?.byHour ?? []
  const max = Math.max(1, ...list)
  return list.map((value, hour) => ({ hour, value, height: value ? Math.max(4, Math.round((value / max) * 100)) : 0 }))
})

/** 回答过的问题：问题 → 选的那一项 */
const answers = computed(() => {
  const given = mascotProfile.value?.answers ?? {}
  return MASCOT_QUESTIONS.flatMap((question) => {
    const option = question.options.find((it) => it.key === given[question.id])
    return option ? [{ id: question.id, question: question.text, answer: option.label }] : []
  })
})

/** n-modal 传送出去了，样式里的 v-bind() 在里面不生效：颜色经 CSS 变量从这里带进去 */
const modalStyle = computed(() => ({
  width: '760px',
  maxWidth: 'calc(100vw - 32px)',
  '--j-text2': theme.value.textColor2,
  '--j-text3': theme.value.textColor3,
  '--j-fill': theme.value.actionColor,
  '--j-divider': theme.value.dividerColor,
  '--j-primary': theme.value.primaryColor,
}))

/** 见过她的样子：见过的给原图，没见过的是剪影。图在折叠里，展开才下 */
const poses = computed(() => {
  const seen = new Set(journal.value?.poses ?? [])
  return MASCOT_POSES.map((pose) => ({ pose, url: poseUrl(pose), seen: seen.has(pose) }))
})
const posesSeen = computed(() => poses.value.filter((it) => it.seen).length)

const latestLine = computed(() => journal.value?.lines[0] ?? null)
</script>

<template>
  <section v-if="journal?.firstAt" class="card">
    <h3>
      小鲸鱼 <small>认识第 {{ knownDays }} 天</small>
      <span class="grow"></span>
      <n-button size="small" @click="open = true">相处记录</n-button>
    </h3>
    <div class="summary">
      <div class="num">
        <b>{{ journal.counts.opens }}</b>
        <span>点她说话</span>
      </div>
      <div class="num">
        <b
          >{{ posesSeen }}<small> / {{ poses.length }}</small></b
        >
        <span>见过的样子</span>
      </div>
      <div class="num">
        <b
          >{{ collection.heard }}<small> / {{ collection.total }}</small></b
        >
        <span>听过的话</span>
      </div>
    </div>
    <p v-if="latestLine" class="latest">「{{ latestLine }}」</p>

    <n-modal v-model:show="open" preset="card" title="和小鲸鱼的相处记录" class="mascot-journal" :style="modalStyle">
      <div class="journal">
        <p class="since">
          {{ parseTime(journal.firstAt, 'YYYY年M月D日') }}认识，来找过她 {{ journal.days }} 天<template v-if="mascotProfile"
            >，手里还有 {{ fishLeft }} 条小鱼干</template
          >
        </p>

        <div class="tiles">
          <div v-for="tile in tiles" :key="tile.label" class="tile" :class="{ zero: !tile.value }">
            <b>{{ tile.value }}</b>
            <span>{{ tile.label }}</span>
          </div>
        </div>

        <h4>
          什么时候来找她
          <small v-if="favoritePage">最常在{{ favoritePage }}页</small>
        </h4>
        <div class="hours">
          <div class="bars">
            <n-tooltip v-for="it in hours" :key="it.hour" :delay="100">
              <template #trigger>
                <span class="slot">
                  <span class="bar" :class="{ empty: !it.value }" :style="{ height: it.value ? `${it.height}%` : '2px' }"></span>
                </span>
              </template>
              {{ it.hour }} 点：{{ it.value }} 次
            </n-tooltip>
          </div>
          <div class="ticks">
            <span v-for="h in [0, 6, 12, 18]" :key="h" :style="{ left: `${(h / 24) * 100}%` }">{{ h }} 点</span>
          </div>
        </div>

        <template v-if="answers.length">
          <h4>你跟她说过</h4>
          <ul class="answers">
            <li v-for="it in answers" :key="it.id">
              <span class="q">{{ it.question }}</span>
              <span class="a">{{ it.answer }}</span>
            </li>
          </ul>
        </template>

        <h4>
          见过她的样子 <small>{{ posesSeen }} / {{ poses.length }}</small>
        </h4>
        <n-collapse :default-expanded-names="[]">
          <n-collapse-item name="poses">
            <template #header>全部样子</template>
            <div class="poses">
              <img
                v-for="it in poses"
                :key="it.pose"
                :src="it.url"
                class="pose"
                :class="{ locked: !it.seen }"
                width="64"
                height="79"
                loading="lazy"
                alt=""
                draggable="false"
              />
            </div>
          </n-collapse-item>
        </n-collapse>

        <h4>
          听过的话 <small>{{ collection.heard }} / {{ collection.total }}</small>
        </h4>
        <n-collapse :default-expanded-names="[]">
          <n-collapse-item v-for="group in collection.groups" :key="group.name" :name="group.name">
            <template #header>
              {{ group.name }}
              <small class="count">{{ group.heard }} / {{ group.lines.length }}</small>
            </template>
            <div class="chips">
              <span v-for="(line, i) in group.lines" :key="i" class="chip" :class="{ locked: !line.heard }">
                {{ line.text }}
              </span>
            </div>
          </n-collapse-item>
        </n-collapse>
      </div>
    </n-modal>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 18px 16px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--oj-fs-h2);
}

h3 small,
h4 small,
.count {
  font-size: var(--oj-fs-sec);
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.grow {
  flex: 1;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
}

.num {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.num b {
  font-size: 22px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}

.count {
  margin-left: 8px;
}

.num b small {
  line-height: 1;
  font-size: var(--oj-fs-sec);
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.num span,
.tile span {
  font-size: 12px;
  color: v-bind('theme.textColor3');
}

.latest {
  margin: 10px 0 0;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor2');
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 点开的那一页：颜色用 modalStyle 带进来的 --j-* ---- */
.journal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.since {
  margin: 0;
  color: var(--j-text2);
}

h4 {
  margin: 8px 0 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 15px;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--j-fill);
}

.tile b {
  font-size: 20px;
  line-height: 26px;
  font-variant-numeric: tabular-nums;
}

.tile.zero b {
  color: var(--j-text3);
}

.hours {
  position: relative;
  padding-bottom: 20px;
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 72px;
  border-bottom: 1px solid var(--j-divider);
}

.slot {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.bar {
  width: 100%;
  border-radius: 4px 4px 0 0;
  background: var(--j-primary);
}

.bar.empty {
  border-radius: 0;
  background: var(--j-divider);
}

.ticks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 18px;
}

.ticks span {
  position: absolute;
  font-size: 12px;
  color: var(--j-text3);
}

.answers {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.answers li {
  display: flex;
  gap: 12px;
}

.answers .q {
  color: var(--j-text2);
}

.answers .a {
  font-weight: 600;
}

.poses {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
  justify-items: center;
}

.pose {
  display: block;
  width: 64px;
  height: 79px;
  object-fit: contain;
  object-position: 50% 100%;
  user-select: none;
}

/* 没见过的只给剪影：看得出轮廓，看不出是什么样 */
.pose.locked {
  filter: brightness(0);
  opacity: 0.14;
}

html.dark .pose.locked {
  filter: brightness(0) invert(1);
  opacity: 0.16;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 20px;
  background: var(--j-fill);
}

.chip.locked {
  background: none;
  border: 1px dashed var(--j-divider);
  color: var(--j-text3);
}
</style>
