<script setup lang="ts">
import type { LearningItem } from '@oj2/contract'
import { useThemeVars } from 'naive-ui'
import { statusName } from '../utils'

/** 交过还没做对的题。学生「接着做」，老师「看提交」 */
const props = defineProps<{ items: LearningItem[]; username?: string }>()

const theme = useThemeVars()
const router = useRouter()

function submissions(item: LearningItem) {
  return {
    path: '/submission',
    query: { problem: item.displayId, username: props.username, exactUsername: '1' },
  }
}
</script>

<template>
  <section class="card">
    <h3>差一点的</h3>
    <div v-for="item in items" :key="item.displayId" class="row">
      <div class="text">
        <div class="title">
          <span class="pid">{{ item.displayId }}</span
          >{{ item.title }}
        </div>
        <div class="meta">
          交了 {{ item.attempts }} 次<template v-if="statusName(item.lastResult)"> · 最后一次{{ statusName(item.lastResult) }}</template>
        </div>
      </div>
      <router-link v-if="username" :to="submissions(item)" class="link">看提交 ›</router-link>
      <n-button v-else type="primary" size="small" @click="router.push(`/problem/${item.displayId}`)"> 接着做 </n-button>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 16px 18px 8px;
  border: 1px solid rgba(240, 160, 32, 0.4);
  border-radius: var(--oj-radius);
  background: rgba(240, 160, 32, 0.06);
}

h3 {
  margin: 0 0 6px;
  font-size: var(--oj-fs-h2);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid rgba(240, 160, 32, 0.22);
}

.text {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: var(--oj-fs-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pid {
  margin-right: 6px;
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.meta {
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor3');
}

.link {
  font-size: var(--oj-fs-meta);
  color: #18a058;
  text-decoration: none;
  white-space: nowrap;
}
</style>
