<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import { levelName, MAX_LEVEL, remainingToNext, tagLink } from "oj/user/knowledge"
import type { KnowledgeLevel, KnowledgeMap } from "utils/types"

/**
 * 个人主页上的知识点地图：「学会了什么」，只和自己比。
 *
 * 本人和老师看得到，同学看不到（后端 /profiles/:username/overview 裁）—— 开放给同学
 * 它就成了另一张排行榜，基础弱的学生最不想被看到的就是这个。
 */
const props = defineProps<{
  map: KnowledgeMap
  /** 老师在看：标题不带「我的」，称呼用「他」 */
  teacher?: boolean
  compact?: boolean
}>()

const theme = useThemeVars()

const learned = computed(() =>
  props.map.tags
    .filter((tag) => tag.level >= 1)
    .sort((a, b) => b.level - a.level || b.solved - a.solved),
)

/** 班里同学在学、他还没碰过的。别的（比如 Python 班的「C 语言」）不列 */
const untouched = computed(() => {
  const touched = new Set(props.map.classTouched)
  return props.map.tags.filter((tag) => tag.level === 0 && touched.has(tag.name))
})

function progress(tag: KnowledgeLevel) {
  if (tag.nextAt === null) return 100
  return Math.min(100, Math.round((tag.solved / tag.nextAt) * 100))
}

function hint(tag: KnowledgeLevel) {
  const left = remainingToNext(tag)
  if (left === null) return `做对 ${tag.solved} 道 · 已经精通`
  return `做对 ${tag.solved} 道 · 再做 ${left} 道到「${levelName(tag.level + 1)}」`
}
</script>

<template>
  <section class="card" :class="{ compact }">
    <h3 v-if="!compact">
      {{ teacher ? "知识点" : "我的知识点" }}
      <small v-if="!teacher">只有你和老师看得到</small>
    </h3>
    <router-link v-for="tag in learned" :key="tag.name" :to="tagLink(tag.name)" class="row">
      <span class="head">
        <span class="name">{{ tag.name }}</span>
        <span class="dots" :title="levelName(tag.level)">
          <i v-for="i in MAX_LEVEL" :key="i" :class="{ on: i <= tag.level }"></i>
        </span>
        <span class="level">{{ levelName(tag.level) }}</span>
        <span v-if="tag.level > tag.levelAtWeekStart" class="up">这周升了</span>
      </span>
      <span class="track"><b :style="{ width: `${progress(tag)}%` }"></b></span>
      <span class="meta">{{ hint(tag) }}</span>
    </router-link>
    <div v-if="!learned.length && !untouched.length" class="meta empty">还没做对带知识点的题</div>

    <div v-if="untouched.length" class="untouched">
      <span class="meta">班里在学、{{ teacher ? "" : "你" }}还没碰过</span>
      <div class="tags">
        <router-link v-for="tag in untouched" :key="tag.name" :to="tagLink(tag.name)" class="tag">
          {{ tag.name }}
        </router-link>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

h3 {
  margin: 0 0 4px;
  font-size: var(--oj-fs-h2);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

h3 small {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 0;
  color: inherit;
  text-decoration: none;
}

.row:hover .name {
  text-decoration: underline;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  width: 72px;
  color: v-bind("theme.primaryColor");
  font-size: var(--oj-fs-sec);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dots {
  display: inline-flex;
  gap: 3px;
}

.dots i {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: v-bind("theme.dividerColor");
}

.dots i.on {
  background: #18a058;
}

.level {
  font-size: var(--oj-fs-meta);
  color: #18a058;
}

.up {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  font-size: 12px;
}

.track {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: v-bind("theme.dividerColor");
  overflow: hidden;
}

.track b {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: #18a058;
}

.meta {
  font-size: 12px;
  color: v-bind("theme.textColor3");
}

.empty {
  padding: 12px 0;
  font-size: var(--oj-fs-sec);
}

.untouched {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid v-bind("theme.dividerColor");
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px dashed v-bind("theme.borderColor");
  border-radius: 13px;
  font-size: var(--oj-fs-meta);
  color: v-bind("theme.textColor2");
  text-decoration: none;
}

.compact {
  padding: 4px 0 0;
  border: 0;
  border-radius: 0;
  background: none;
}
</style>
