<script setup lang="ts">
import { h } from "vue"
import { Icon } from "@iconify/vue"
import { RouterLink } from "vue-router"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useDarkTransition } from "shared/composables/darkTransition"
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import { useUserStore } from "../store/user"
import HelpButton from "../components/HelpButton.vue"
import type { MenuOption } from "naive-ui"

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { isMobile } = useBreakpoints()
const { isDark, toggleDark } = useDarkTransition()

/**
 * 菜单的唯一一张表。`role` 必须和 routes.ts 里对应路由的 meta 对齐：
 * 菜单里露出一个守卫不放行的入口，点下去就是被静默踢回首页。
 * `path` 同时用来判定高亮：取当前路径能匹配上的**最长**那一条，所以
 * /admin/problem/stuck 亮「卡点分析」而不是「题目」。
 */
type Role = "problem" | "teacher" | "super"
interface NavItem {
  label: string
  icon: string
  path: string
  /** 点击跳到哪；不写就是 path 本身（path 只是前缀时必须写，前缀不一定有路由） */
  to?: string
  role: Role
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: "概览",
    items: [{ label: "首页", icon: "ph:house", path: "/admin", role: "super" }],
  },
  {
    label: "教学内容",
    items: [
      {
        label: "题目",
        icon: "ph:code",
        path: "/admin/problem",
        to: "/admin/problem/list",
        role: "problem",
      },
      { label: "标签", icon: "ph:tag", path: "/admin/problem/tags", role: "problem" },
      {
        label: "比赛",
        icon: "ph:flag-checkered",
        path: "/admin/contest",
        to: "/admin/contest/list",
        role: "teacher",
      },
      {
        label: "题单",
        icon: "ph:list-checks",
        path: "/admin/problemset",
        to: "/admin/problemset/list",
        role: "teacher",
      },
      {
        label: "教程",
        icon: "ph:book-open",
        path: "/admin/tutorial",
        to: "/admin/tutorial/list",
        role: "super",
      },
    ],
  },
  {
    label: "学情分析",
    items: [
      {
        label: "卡点分析",
        icon: "ph:warning-diamond",
        path: "/admin/problem/stuck",
        role: "teacher",
      },
      {
        label: "年度趋势",
        icon: "ph:chart-line-up",
        path: "/admin/problem/top_ac_trend",
        role: "teacher",
      },
      { label: "自学情况", icon: "ph:student", path: "/admin/learn", role: "teacher" },
      {
        label: "AI 报告",
        icon: "ph:sparkle",
        path: "/admin/ai",
        to: "/admin/ai/reports",
        role: "teacher",
      },
    ],
  },
  {
    label: "站点管理",
    items: [
      {
        label: "用户",
        icon: "ph:users",
        path: "/admin/user",
        to: "/admin/user/list",
        role: "super",
      },
      {
        label: "公告",
        icon: "ph:megaphone",
        path: "/admin/announcement",
        to: "/admin/announcement/list",
        role: "super",
      },
      {
        label: "成就",
        icon: "ph:medal",
        path: "/admin/achievement",
        to: "/admin/achievement/list",
        role: "super",
      },
      { label: "设置", icon: "ph:gear-six", path: "/admin/config", role: "super" },
    ],
  },
]

function allowed(role: Role) {
  if (role === "super") return userStore.isSuperAdmin
  if (role === "teacher") return userStore.isTeacherOrAbove
  return userStore.hasProblemPermission
}

const groups = computed(() =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.role)) })).filter(
    (g) => g.items.length,
  ),
)

function renderIcon(icon: string) {
  return () => h(Icon, { icon, width: 18 })
}

function toOption(i: NavItem): MenuOption {
  return {
    key: i.path,
    icon: renderIcon(i.icon),
    label: () => h(RouterLink, { to: i.to ?? i.path }, { default: () => i.label }),
  }
}

// 收起时 64px 放不下分组标题（会折成两行），换成分隔线
const options = computed<MenuOption[]>(() =>
  siderCollapsed.value
    ? groups.value.flatMap((g, idx) => [
        ...(idx ? [{ type: "divider", key: `divider-${g.label}` }] : []),
        ...g.items.map(toOption),
      ])
    : groups.value.map((g) => ({
        type: "group",
        key: g.label,
        label: g.label,
        children: g.items.map(toOption),
      })),
)

function matches(path: string, prefix: string) {
  // 首页只能精确匹配，否则它是所有后台路径的前缀
  if (prefix === "/admin") return path === "/admin" || path === "/admin/"
  return path === prefix || path.startsWith(prefix + "/")
}

const current = computed(() => {
  let best: { group: NavGroup; item: NavItem } | null = null
  for (const group of groups.value) {
    for (const item of group.items) {
      if (matches(route.path, item.path) && item.path.length > (best?.item.path.length ?? 0)) {
        best = { group, item }
      }
    }
  }
  return best
})

const collapsed = ref<boolean>(storage.get(STORAGE_KEY.ADMIN_SIDER_COLLAPSED) ?? false)
watch(collapsed, (v) => storage.set(STORAGE_KEY.ADMIN_SIDER_COLLAPSED, v))
// 窄屏一律收起，不写回偏好 —— 手机上看一眼不该改掉桌面端的习惯
const siderCollapsed = computed({
  get: () => isMobile.value || collapsed.value,
  set: (v) => {
    if (!isMobile.value) collapsed.value = v
  },
})

const userOptions: DropdownOption[] = [
  { label: "回到前台", key: "home", icon: renderIcon("ph:arrow-square-out") },
  { type: "divider", key: "d" },
  { label: "退出登录", key: "logout", icon: renderIcon("ph:sign-out") },
]

async function onUserSelect(key: string) {
  if (key === "home") {
    router.push("/")
  } else if (key === "logout") {
    await userStore.signOut()
    // 与前台 Header 一致：整页跳转把各个 store 里的数据清干净
    window.location.replace("/")
  }
}

onMounted(async () => {
  if (!storage.get(STORAGE_KEY.AUTHED)) {
    router.replace("/")
  } else {
    await userStore.getMyProfile()
    if (!userStore.isAdminRole) {
      router.replace("/")
    }
  }
})
</script>

<template>
  <n-layout has-sider position="absolute">
    <n-layout-sider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="200"
      :native-scrollbar="false"
      :show-trigger="isMobile ? false : 'bar'"
      v-model:collapsed="siderCollapsed"
    >
      <RouterLink to="/" class="brand" :class="{ collapsed: siderCollapsed }" title="回到前台">
        <Icon icon="streamline-emojis:dog" :height="28" />
        <span v-if="!siderCollapsed" class="brandText">后台管理</span>
      </RouterLink>
      <n-menu
        :options="options"
        :value="current?.item.path ?? null"
        :collapsed="siderCollapsed"
        :collapsed-width="64"
        :collapsed-icon-size="20"
        :indent="20"
        :theme-overrides="{ itemHeight: '36px' }"
      />
    </n-layout-sider>

    <n-layout>
      <n-layout-header bordered class="topbar">
        <n-breadcrumb v-if="!isMobile">
          <n-breadcrumb-item>后台</n-breadcrumb-item>
          <template v-if="current">
            <n-breadcrumb-item>{{ current.group.label }}</n-breadcrumb-item>
            <n-breadcrumb-item>
              <RouterLink :to="current.item.to ?? current.item.path">{{
                current.item.label
              }}</RouterLink>
            </n-breadcrumb-item>
          </template>
        </n-breadcrumb>
        <div v-if="isMobile" />
        <n-flex align="center" :size="8" :wrap="false">
          <n-button v-if="!isMobile" quaternary size="small" @click="router.push('/')">
            <template #icon><Icon icon="ph:arrow-square-out" /></template>
            回到前台
          </n-button>
          <n-button quaternary circle size="small" @click="toggleDark" title="切换明暗">
            <template #icon>
              <Icon :icon="isDark ? 'ph:sun' : 'ph:moon'" />
            </template>
          </n-button>
          <n-dropdown
            v-if="userStore.user"
            :options="userOptions"
            trigger="click"
            @select="onUserSelect"
          >
            <n-button quaternary size="small">
              <template #icon><Icon icon="ph:user-circle" /></template>
              <template v-if="!isMobile">{{ userStore.user.username }}</template>
            </n-button>
          </n-dropdown>
          <!-- 老师在后台改题时也得知道有人举手（前台顶栏在这里是卸载的）。
               和前台一样放最末尾，出现、消失时别的按钮不挪 -->
          <HelpButton size="small" />
        </n-flex>
      </n-layout-header>
      <n-layout-content
        position="absolute"
        style="top: 49px"
        :native-scrollbar="false"
        content-style="padding: 20px 24px"
      >
        <router-view></router-view>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 20px;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
}

.brand.collapsed {
  justify-content: center;
  padding: 0;
}

.brandText {
  font-size: 16px;
  font-weight: 600;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 49px;
  padding: 0 16px 0 24px;
  box-sizing: border-box;
}
</style>
