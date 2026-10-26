<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import UserName from 'shared/components/UserName.vue'
import { parseTime } from 'utils/functions'
import type { Achievement, AchievementClassBoard } from 'utils/types'
import Medal from './Medal.vue'

/**
 * 「本班」：最近谁拿到了什么、成就最多的前五名（自己不在里面就钉在底下）。
 * 同一个人同一刻拿到的几个并成一行（一次提交常常连着解锁两三个）；
 * 自己还没找到的隐藏成就只说「彩蛋」，不把名字漏出来。
 */
const props = defineProps<{
  board: AchievementClassBoard
  achievements: Achievement[]
  me: string
  compact?: boolean
}>()

const theme = useThemeVars()
const byId = computed(() => new Map(props.achievements.map((item) => [item.id, item])))

const recent = computed(() => {
  const rows: { key: string; username: string; time: string; items: Achievement[] }[] = []
  for (const row of props.board.recent) {
    const item = byId.value.get(row.achievementId)
    if (!item) continue
    const last = rows.at(-1)
    if (last && last.username === row.username && last.time === row.unlockTime) last.items.push(item)
    else
      rows.push({
        key: `${row.username}-${row.unlockTime}-${row.achievementId}`,
        username: row.username,
        time: row.unlockTime,
        items: [item],
      })
  }
  return rows
})

function what(items: Achievement[]) {
  const known = items.filter((item) => item.metric !== null).map((item) => item.name)
  const eggs = items.length - known.length
  if (eggs) known.push(eggs === 1 ? '一个彩蛋' : `${eggs} 个彩蛋`)
  return known.join('、')
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3>本班</h3>
    <div class="cols">
      <div class="col">
        <span class="sub">最近拿到</span>
        <div v-for="row in recent" :key="row.key" class="line">
          <Medal :icon="row.items[0]!.icon" :rarity="row.items[0]!.rarity" :size="28" :state="row.items[0]!.metric === null ? 'unknown' : 'on'" />
          <span class="what">
            <UserName :username="row.username" />
            <span class="muted">拿到</span>
            {{ what(row.items) }}
          </span>
          <span class="date">{{ parseTime(row.time, 'M月D日') }}</span>
        </div>
        <span v-if="!recent.length" class="empty">这学期还没人拿到</span>
      </div>
      <div class="col">
        <span class="sub">成就最多</span>
        <div v-for="row in board.most" :key="row.username" class="line rank" :class="{ mine: row.username === me }">
          <span class="no">{{ row.rank }}</span>
          <UserName :username="row.username" />
          <b>{{ row.count }}</b>
        </div>
        <div v-if="board.me" class="line rank mine pinned">
          <span class="no">{{ board.me.rank }}</span>
          <UserName :username="me" />
          <b>{{ board.me.count }}</b>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 20px 12px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0;
  font-size: var(--oj-fs-h2);
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 28px;
  margin-top: 10px;
}

.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sub {
  margin-bottom: 4px;
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
}

.line {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  font-size: var(--oj-fs-sec);
}

.what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted,
.date,
.no,
.empty {
  color: v-bind('theme.textColor3');
}

.muted {
  margin: 0 4px;
}

.date {
  font-size: 12px;
  white-space: nowrap;
}

.empty {
  padding: 8px 0;
  font-size: var(--oj-fs-sec);
}

.rank .no {
  width: 16px;
  font-variant-numeric: tabular-nums;
}

.rank b {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.mine {
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 6px;
  background: v-bind("theme.primaryColor + '1a'");
}

.pinned {
  border-top: 1px dashed v-bind('theme.borderColor');
}

.compact {
  padding: 12px 14px 8px;
}

.compact .cols {
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}
</style>
