<script lang="ts">
import type { ProblemRow } from 'utils/types'

type SimilarRow = ProblemRow & { sharedTags: string[] }

/**
 * 同一道题两处（题面末尾、结果页签）都挂着时只拉一次。放在模块级：写在 setup 里就成了
 * 每个实例各一份
 */
const cache = new Map<string, Promise<SimilarRow[]>>()
</script>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useThemeVars } from 'naive-ui'
import { getSimilarProblems } from 'oj/api'
import { useProblemStore } from 'oj/store/problem'
import { useTone } from 'shared/composables/tone'
import { problemTypes } from '../utils/problemType'
import ProblemStatus from './ProblemStatus.vue'
import ProblemTypeTag from './ProblemTypeTag.vue'
import SectionHead from './SectionHead.vue'

/**
 * 相似题推荐。题面末尾（做对了、或者错了 3 次以上）和结果页签（不在课堂里的题做对之后）
 * 两处用：原来只在题面最底下，学生交完不会再滚回去看。什么时候出现由调用方的 v-if 决定。
 * `place` 只管标题的样子：题面里用题面的小节标题（SectionHead），结果页签里和「还能挑战」对齐。
 *
 * 每行第二行写和这道题共同的标签：不点开就知道练的是什么。行的写法照题目列表
 * （灰题号、淡底难度、做对人数、类型标签、做过没对的红「−」）。整行可点，题目名
 * 和题目列表一样用正文色、不用主题绿：绿字细、在白底上发虚
 */
const props = defineProps<{ title: string; place: 'content' | 'result' }>()

const theme = useThemeVars()
const tone = useTone()

const { problem } = storeToRefs(useProblemStore())
const list = ref<SimilarRow[]>([])

watch(
  () => problem.value?._id,
  async (id) => {
    list.value = []
    if (!id) return
    if (!cache.has(id))
      cache.set(
        id,
        getSimilarProblems(id).catch(() => []),
      )
    const rows = await cache.get(id)!
    if (problem.value?._id === id) list.value = rows
  },
  { immediate: true },
)

// 做对了的接口已经筛掉，剩下的只有「没做过」和「做过没对」两种；一道都没做过就不留这一列
const showStatus = computed(() => list.value.some((row) => row.status === 'failed'))

const DIFFICULTY_TONE = { 简单: 'success', 中等: 'warning', 困难: 'error' } as const

function difficultyStyle(row: SimilarRow) {
  if (!row.difficulty) return {}
  const t = tone(DIFFICULTY_TONE[row.difficulty])
  return { color: t.color, background: t.background }
}
</script>

<template>
  <section v-if="list.length" class="similar" :class="props.place">
    <SectionHead v-if="props.place === 'content'" icon="similar">{{ props.title }}</SectionHead>
    <h3 v-else class="heading">{{ props.title }}</h3>
    <div class="rows">
      <router-link v-for="sp in list" :key="sp._id" :to="{ name: 'problem', params: { problemID: sp._id } }" class="row" :class="{ 'with-status': showStatus }">
        <span v-if="showStatus" class="status"><ProblemStatus :status="sp.status" /></span>
        <span class="id">{{ sp._id }}</span>
        <span class="name">
          <span class="text">{{ sp.title }}</span>
          <ProblemTypeTag v-for="kind in problemTypes(sp)" :key="kind" :kind="kind" />
        </span>
        <span v-if="sp.difficulty" class="difficulty" :style="difficultyStyle(sp)">{{ sp.difficulty }}</span>
        <span class="shared">{{ sp.sharedTags.join(' · ') }}</span>
        <span class="people"
          ><b>{{ sp.solvedUsers }}</b> 人做对</span
        >
      </router-link>
    </div>
  </section>
</template>

<style scoped>
.similar {
  margin-top: 20px;
}

.similar.result {
  margin-top: 14px;
}

.heading {
  margin: 0 0 8px;
}

/* 和结果页签里的「还能挑战」一样 */
.result .heading {
  font-size: 15px;
  font-weight: 700;
}

.rows {
  border: 1px solid v-bind('theme.dividerColor');
  border-radius: 6px;
  overflow: hidden;
}

/*
 * 两行：题号 | 题目名 + 类型标签 | 难度
 *            | 共同的标签       | 做对人数
 * 做过没对的题最前面多一列红「−」
 */
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'id name difficulty'
    '. shared people';
  align-items: center;
  gap: 4px 12px;
  padding: 10px 16px;
  color: v-bind('theme.textColor1');
  text-decoration: none;
}

.row.with-status {
  grid-template-columns: 16px auto minmax(0, 1fr) auto;
  grid-template-areas:
    'status id name difficulty'
    '. . shared people';
}

.row + .row {
  border-top: 1px solid v-bind('theme.dividerColor');
}

.row:hover {
  background: v-bind('theme.hoverColor');
}

.row:hover .text {
  text-decoration: underline;
}

.status {
  grid-area: status;
  display: flex;
  justify-content: center;
}

.id {
  grid-area: id;
  min-width: 36px;
  font-size: var(--oj-fs-body);
  color: v-bind('theme.textColor3');
  font-variant-numeric: tabular-nums;
}

.name {
  grid-area: name;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.text {
  min-width: 0;
  font-size: var(--oj-fs-body);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.difficulty {
  grid-area: difficulty;
  justify-self: end;
  height: 22px;
  padding: 0 7px;
  border-radius: 4px;
  font-size: var(--oj-fs-meta);
  display: inline-flex;
  align-items: center;
}

.shared {
  grid-area: shared;
  min-width: 0;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor2');
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.people {
  grid-area: people;
  justify-self: end;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.textColor2');
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.people b {
  font-weight: 600;
  color: v-bind('theme.textColor1');
}
</style>
