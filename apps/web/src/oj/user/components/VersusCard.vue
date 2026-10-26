<script setup lang="ts">
import type { ProfileOverview } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'

/** 同学看别人的主页时的「和你比」：两根条比做对几道，下面一句你们重合多少、你在本班第几 */
const props = defineProps<{
  versus: NonNullable<ProfileOverview['versus']>
  /** 他做对几道 */
  theirs: number
}>()

const theme = useThemeVars()

const top = computed(() => Math.max(props.theirs, props.versus.solved, 1))

const line = computed(() => {
  const { solved, both, classRank } = props.versus
  const parts = []
  if (solved) parts.push(both === solved ? `你做对的 ${solved} 道对方都做对了` : `你做对的 ${solved} 道里对方做对了 ${both} 道`)
  if (classRank) parts.push(`你在本班第 ${classRank.rank} 名`)
  return parts.join(' · ')
})
</script>

<template>
  <section class="card">
    <h3>和你比</h3>
    <div class="bar-row">
      <span class="who">对方</span>
      <span class="lane"><span class="bar his" :style="{ width: `${(theirs / top) * 100}%` }"></span></span>
      <b>{{ theirs }}</b>
    </div>
    <div class="bar-row">
      <span class="who">你</span>
      <span class="lane">
        <span class="bar mine" :style="{ width: `${(versus.solved / top) * 100}%` }"></span>
      </span>
      <b>{{ versus.solved }}</b>
    </div>
    <div v-if="line" class="meta">{{ line }}</div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid v-bind('theme.borderColor');
  border-radius: var(--oj-radius);
  background: v-bind('theme.cardColor');
}

h3 {
  margin: 0;
  font-size: var(--oj-fs-h2);
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--oj-fs-sec);
}

.who {
  width: 28px;
  color: v-bind('theme.textColor3');
}

.lane {
  flex: 1;
  display: flex;
}

.bar {
  height: 10px;
  min-width: 2px;
  border-radius: 2px 5px 5px 2px;
}

.his {
  background: #2f6fd0;
}

.mine {
  background: #18a058;
}

b {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.meta {
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
}
</style>
