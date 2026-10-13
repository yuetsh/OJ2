<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { useThemeVars } from "naive-ui"
import {
  getAdminAchievements,
  getBaseInfo,
  getMetricOptions,
  type AdminAchievement,
  type MetricOption,
} from "admin/api"
import AchievementIcon from "shared/components/AchievementIcon.vue"
import AchievementModal from "./components/AchievementModal.vue"
import { RARITY_LABEL } from "utils/constants"

/**
 * 后台成就（设计稿「我的成就重设计」AchAdmin）：按指标分组，一组一行排成阶梯 ——
 * 「做对的题数」初出茅庐 ≥1 → 小有所成 ≥10 → … → 二百大关 ≥200。每档写名字、门槛、
 * 解锁人数和占全部学生的比例；隐藏的写「隐藏」，下架的变淡写「下架了」；点一档就编辑
 * （删除在编辑框左下角）。
 *
 * 原来是一张平铺的表，同一个指标的几档散在各处，看不出阶梯，也看不出哪一档太难没人拿到
 */
const theme = useThemeVars()

const list = ref<AdminAchievement[]>([])
const metrics = ref<MetricOption[]>([])
const students = ref(0)
const loading = ref(false)
const showModal = ref(false)
const editing = ref<AdminAchievement | null>(null)

const offline = computed(() => list.value.filter((a) => !a.visible).length)

/** 按指标分组，指标按后端给的顺序（做题 → 坚持 → 比赛题单 → 趣味），组内按门槛从低到高 */
const groups = computed(() => {
  const byMetric = new Map<string, AdminAchievement[]>()
  for (const a of list.value) byMetric.set(a.metric, [...(byMetric.get(a.metric) ?? []), a])
  const order = metrics.value.map((m) => m.key)
  return [...byMetric.entries()]
    .sort(
      ([a], [b]) =>
        (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
        (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
    )
    .map(([metric, items]) => ({
      metric,
      name: items[0]?.metricName ?? metric,
      items: [...items].sort((x, y) => x.threshold - y.threshold),
    }))
})

function percent(a: AdminAchievement) {
  if (!students.value) return ""
  const value = (a.unlockCount / students.value) * 100
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`
}

async function load() {
  loading.value = true
  try {
    const [res, options, info] = await Promise.all([
      getAdminAchievements(),
      metrics.value.length ? Promise.resolve(metrics.value) : getMetricOptions(),
      students.value ? Promise.resolve(null) : getBaseInfo().catch(() => null),
    ])
    list.value = res
    metrics.value = options
    if (info) students.value = info.site.students
  } finally {
    loading.value = false
  }
}

function create() {
  editing.value = null
  showModal.value = true
}

function edit(row: AdminAchievement) {
  editing.value = row
  showModal.value = true
}

onMounted(load)
</script>

<template>
  <PageHeader title="成就">
    <template #extra>
      <n-text depth="3">
        {{ list.length }} 个<template v-if="offline"> · {{ offline }} 个下架了</template>
      </n-text>
    </template>
    <template #actions>
      <n-button type="primary" @click="create">新建成就</n-button>
    </template>
  </PageHeader>

  <n-spin :show="loading">
    <div class="groups">
      <div v-for="group in groups" :key="group.metric" class="group">
        <span class="metric">{{ group.name }}</span>
        <div class="steps">
          <template v-for="(a, i) in group.items" :key="a.id">
            <span v-if="i" class="arrow" aria-hidden="true">→</span>
            <button
              type="button"
              class="step"
              :class="{ off: !a.visible }"
              :title="`${RARITY_LABEL[a.rarity] ?? a.rarity} · 点了编辑`"
              @click="edit(a)"
            >
              <AchievementIcon :icon="a.icon" :size="26" />
              <span class="step-text">
                <b>
                  {{ a.name }}
                  <span class="muted small"
                    >{{ a.operator === "gte" ? "≥" : "≤" }} {{ a.threshold }}</span
                  >
                </b>
                <span class="small">
                  {{ a.unlockCount }} 人
                  <span v-if="percent(a)" class="muted">· {{ percent(a) }}</span>
                  <span v-if="a.hidden" class="muted"> 隐藏</span>
                  <span v-if="!a.visible" class="off-note"> 下架了</span>
                </span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </n-spin>

  <AchievementModal v-model:show="showModal" :editing="editing" @saved="load" />
</template>

<style scoped>
.groups {
  display: flex;
  flex-direction: column;
}

/* 斑马底纹，和后台其它列表一样 */
.group:nth-child(even) {
  background: v-bind("theme.tableColorStriped");
}

.group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.metric {
  width: 150px;
  flex: none;
  font-size: 14px;
}

.steps {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.arrow {
  color: v-bind("theme.textColor3");
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.cardColor");
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.step:hover {
  border-color: v-bind("theme.primaryColor");
}

.step.off {
  opacity: 0.5;
}

.step-text {
  display: flex;
  flex-direction: column;
}

.step-text b {
  font-size: 14px;
}

.small {
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: v-bind("theme.textColor3");
}

.off-note {
  color: v-bind("theme.errorColor");
}
</style>
