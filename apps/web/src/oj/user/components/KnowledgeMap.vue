<script setup lang="ts">
import { getKnowledgeMap } from "oj/api"
import { levelName, MAX_LEVEL, remainingToNext, tagLink } from "oj/user/knowledge"
import type { KnowledgeLevel, KnowledgeMap } from "utils/types"

/**
 * 个人主页上的知识点地图：「我学会了什么」，只和自己比。
 *
 * 只在看**自己的**主页时挂（index.vue 判断），不开放给别人看 —— 开放了它就成了
 * 另一张排行榜，基础弱的学生最不想被看到的就是这个。
 */
const map = ref<KnowledgeMap | null>(null)

onMounted(async () => {
  map.value = await getKnowledgeMap().catch(() => null)
})

const learned = computed(() =>
  (map.value?.tags ?? [])
    .filter((tag) => tag.level >= 1)
    .sort((a, b) => b.level - a.level || b.solved - a.solved),
)

/** 班里同学在学、自己还没碰过的。别的（比如 Python 班的「C 语言」）不列 */
const untouched = computed(() => {
  const touched = new Set(map.value?.classTouched ?? [])
  return (map.value?.tags ?? []).filter((tag) => tag.level === 0 && touched.has(tag.name))
})

function progress(tag: KnowledgeLevel) {
  if (tag.nextAt === null) return 100
  return Math.min(100, Math.round((tag.solved / tag.nextAt) * 100))
}

function hint(tag: KnowledgeLevel) {
  const left = remainingToNext(tag)
  if (left === null) return `做对了 ${tag.solved} 道，已经精通了`
  return `做对 ${tag.solved} 道 · 再做 ${left} 道到「${levelName(tag.level + 1)}」`
}
</script>

<template>
  <n-card v-if="map && (learned.length || untouched.length)" class="knowledge" title="我的知识点">
    <template #header-extra>
      <n-text depth="3" class="meta">入门 → 会了 → 熟练 → 精通</n-text>
    </template>
    <n-flex vertical :size="14">
      <router-link v-for="tag in learned" :key="tag.name" :to="tagLink(tag.name)" class="row">
        <div class="head">
          <span class="name">{{ tag.name }}</span>
          <span class="dots" :title="levelName(tag.level)">
            <span v-for="i in MAX_LEVEL" :key="i" class="dot" :class="{ on: i <= tag.level }" />
          </span>
          <span class="level">{{ levelName(tag.level) }}</span>
          <n-tag
            v-if="tag.level > tag.levelAtWeekStart"
            size="small"
            type="success"
            :bordered="false"
          >
            本周升级
          </n-tag>
        </div>
        <n-progress
          type="line"
          :percentage="progress(tag)"
          :show-indicator="false"
          :height="6"
          status="success"
        />
        <n-text depth="3" class="meta">{{ hint(tag) }}</n-text>
      </router-link>

      <div v-if="untouched.length">
        <n-text depth="3" class="meta">班里同学在学、你还没碰过：</n-text>
        <n-flex :size="8" style="margin-top: 6px">
          <router-link v-for="tag in untouched" :key="tag.name" :to="tagLink(tag.name)">
            <n-tag size="small">{{ tag.name }}</n-tag>
          </router-link>
        </n-flex>
      </div>
    </n-flex>
  </n-card>
</template>

<style scoped>
.knowledge {
  max-width: 760px;
  margin: var(--oj-gap) auto 0;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: inherit;
  text-decoration: none;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  font-weight: 500;
  min-width: 5em;
}

.dots {
  display: inline-flex;
  gap: 3px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgba(128, 128, 128, 0.25);
}

.dot.on {
  background-color: #18a058;
}

.level {
  font-size: var(--oj-fs-sec);
  color: #18a058;
}

.meta {
  font-size: var(--oj-fs-meta);
}
</style>
