<script setup lang="ts">
import { useThemeVars } from 'naive-ui'
import { getAchievements } from 'oj/achievement/api'
import { getUserBadges } from 'oj/api'
import { useBreakpoints } from 'shared/composables/breakpoints'
import UserName from 'shared/components/UserName.vue'
import AdminLink from 'shared/components/AdminLink.vue'
import { useUserStore } from 'shared/store/user'
import { RARITY_COLOR, RARITY_LABEL } from 'utils/constants'
import type { AchievementList, AchievementRarity, UserBadge } from 'utils/types'
import ClassCard from './components/ClassCard.vue'
import GroupCard from './components/GroupCard.vue'
import NearCard from './components/NearCard.vue'
import { buildGroups, nearest, type GroupName } from './series'

/**
 * 我的成就（设计稿「我的成就重设计」定稿，画布 page ach）：
 * 顶上「快拿到了」和「本班」并排，底下 38 个成就收成一条条线、分五组。
 * 看别人的（排名、主页点进来，?name=）只有成就线 —— 「快拿到了」是给自己定目标的，
 * 「本班」后端也只在看自己时给。
 */
const route = useRoute()
const userStore = useUserStore()
const theme = useThemeVars()
const { isDesktop } = useBreakpoints()

const name = computed(() => (route.query.name as string) || undefined)
const data = ref<AchievementList | null>(null)
const badges = ref<UserBadge[]>([])
const loading = ref(true)
const notFound = ref(false)

const other = computed(() => !!data.value && data.value.username !== userStore.user?.username)
const groups = computed(() => (data.value ? buildGroups(data.value.achievements) : []))
const near = computed(() => (other.value ? [] : nearest(groups.value)))
const got = computed(() => data.value?.achievements.filter((item) => item.unlocked) ?? [])
const rarities: AchievementRarity[] = ['platinum', 'gold', 'silver', 'bronze']
const countOf = (rarity: AchievementRarity) => got.value.filter((item) => item.rarity === rarity).length

// 桌面两栏：左边做题、其他、彩蛋，右边坚持、题单和比赛 —— 两边差不多高
const LEFT: GroupName[] = ['做题', '其他', '彩蛋']
const RIGHT: GroupName[] = ['坚持', '题单和比赛']
const pick = (names: GroupName[]) => groups.value.filter((group) => names.includes(group.name))

async function load() {
  loading.value = true
  notFound.value = false
  try {
    const [list, badgeRes] = await Promise.all([getAchievements(name.value), getUserBadges(name.value).catch(() => [])])
    data.value = list
    badges.value = badgeRes ?? []
  } catch {
    data.value = null
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(name, load)
</script>

<template>
  <div class="oj-page achievement-page">
    <!-- delay 50ms：缓存命中时数据几乎立刻回来，不闪一下转圈 -->
    <n-spin :show="loading" :delay="50" style="min-height: 240px">
      <n-empty v-if="notFound" description="没有这个用户" class="blank" />
      <template v-else-if="data">
        <div class="title">
          <h2 v-if="other"><UserName :username="data.username" /> 的成就</h2>
          <h2 v-else>我的成就</h2>
          <span class="count">
            拿到 <b>{{ got.length }}</b> 个
          </span>
          <span v-if="isDesktop" class="rarities">
            <span v-for="r in rarities" :key="r" class="rarity">
              <i :style="{ background: RARITY_COLOR[r] }"></i>{{ RARITY_LABEL[r] }}
              <b>{{ countOf(r) }}</b>
            </span>
          </span>
          <router-link v-if="other" to="/achievement" class="mine">看我的 ›</router-link>
          <div v-if="userStore.isSuperAdmin && isDesktop" class="admin-link">
            <AdminLink to="/admin/achievement/list" size="small">管理成就</AdminLink>
          </div>
        </div>

        <!-- 没有班级（老师、自己注册的号）就没有「本班」，「快拿到了」三个横排占满整宽 -->
        <div v-if="near.length || data.classBoard" class="top" :class="{ alone: !data.classBoard }">
          <NearCard v-if="near.length" :items="near" :compact="!isDesktop" :wide="isDesktop && !data.classBoard" />
          <ClassCard v-if="data.classBoard" :board="data.classBoard" :achievements="data.achievements" :me="data.username" :compact="!isDesktop" />
        </div>

        <div v-if="isDesktop" class="columns">
          <div class="column">
            <GroupCard v-for="g in pick(LEFT)" :key="g.name" :group="g" :badges="badges" />
          </div>
          <div class="column">
            <GroupCard v-for="g in pick(RIGHT)" :key="g.name" :group="g" :badges="badges" />
          </div>
        </div>
        <div v-else class="column">
          <GroupCard v-for="g in groups" :key="g.name" :group="g" :badges="badges" compact />
        </div>
      </template>
    </n-spin>
  </div>
</template>

<style scoped>
.title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: var(--oj-gap);
}

h2 {
  margin: 0;
  font-size: var(--oj-fs-title);
}

.count {
  font-size: var(--oj-fs-body);
  color: v-bind('theme.textColor2');
}

.count b {
  font-size: 18px;
  color: v-bind('theme.textColor1');
  font-variant-numeric: tabular-nums;
}

.rarities {
  display: flex;
  gap: 14px;
  margin-left: 6px;
}

.rarity {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--oj-fs-meta);
  color: v-bind('theme.textColor2');
}

.rarity i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.rarity b {
  color: v-bind('theme.textColor1');
  font-variant-numeric: tabular-nums;
}

/* 两个都在时「看我的」占着 auto，按钮跟在它后面 */
.admin-link {
  margin-left: auto;
  align-self: center;
}

.mine + .admin-link {
  margin-left: 0;
}

.mine {
  margin-left: auto;
  font-size: var(--oj-fs-sec);
  color: v-bind('theme.primaryColor');
  text-decoration: none;
}

.top {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--oj-gap);
  margin-bottom: var(--oj-gap);
}

.top.alone {
  grid-template-columns: minmax(0, 1fr);
}

.columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--oj-gap);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.blank {
  padding: 80px 0;
}

@media (max-width: 768px) {
  .top {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    margin-bottom: 14px;
  }

  .column {
    gap: 14px;
  }
}
</style>
