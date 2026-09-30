<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { NSwitch, useThemeVars } from "naive-ui"
import { RouterLink } from "vue-router"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useDarkTransition } from "shared/composables/darkTransition"
import { useLearnProgress } from "shared/composables/learnProgress"
import { useAuthModalStore } from "shared/store/authModal"
import { useCollabStore } from "shared/store/collab"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"
import HelpButton from "./HelpButton.vue"
import ProblemJumpBox from "./ProblemJumpBox.vue"

const userStore = useUserStore()
const configStore = useConfigStore()
const collabStore = useCollabStore()
const authStore = useAuthModalStore()
const route = useRoute()
const router = useRouter()

const { isMobile, isDesktop } = useBreakpoints()
const { learnStep } = useLearnProgress()
const { isDark, toggleDark } = useDarkTransition()
const theme = useThemeVars()

/**
 * 1280 以下（老师的笔记本）收一收：题号框变窄、「课堂看板」只留图标。
 * 机房的两种屏是 1280 和 1366，都走完整那版 —— 老师也会用机房的电脑。
 */
const compact = useMediaQuery("(max-width: 1279px)")
// 再窄（769–1023，很少见）一行放不下老师那版，允许折行，只保证不坏
const narrow = useMediaQuery("(max-width: 1023px)")

const tone = computed(() => ({
  activeBg: isDark.value ? "rgba(99, 226, 183, 0.14)" : "#e7f5ed",
  activeText: isDark.value ? theme.value.primaryColor : theme.value.primaryColorPressed,
}))

/**
 * 站名后面的小标签：环境名、演示中。
 *
 * 演示模式除了下拉里那行「退出演示」再没有别的痕迹，而它是存在 localStorage 里
 * 的，刷新、关标签页都还在，只有退出登录才清 —— 不在这儿常驻标一下，很容易
 * 投屏完忘了退，第二天纳闷后台入口怎么没了。
 */
const envVersion = computed(() => {
  if (import.meta.env.PUBLIC_ENV === "test") {
    return "测试版"
  } else if (import.meta.env.PUBLIC_ENV === "dev") {
    return "开发版"
  }
  return ""
})

// 一级路径就是菜单 key，对不上的页面（/user、/setting、/achievement 等）
// 自然没有一项亮着。根路径没登录时就是题目列表，登录了是个人首页，不亮任何一项
const active = computed(() => route.path.split("/")[1] || (userStore.isAuthed ? "" : "problem"))

async function handleLogout() {
  await userStore.signOut()
  // 整页跳转而不是 router.replace：AI 分析、学情小结这些 store 还装着这个人的数据，
  // 机房下一个学生坐下来就能看到。重载一次把内存清干净，比挨个 reset 可靠。
  window.location.replace("/")
}

function handleToggleDemoMode() {
  const entering = !userStore.demoMode
  userStore.toggleDemoMode()
  // 进入演示模式时若正停在后台页面，当前界面已经失去权限，必须主动退出去
  if (entering && route.path.startsWith("/admin")) {
    router.push("/")
  }
}

function renderIcon(icon: string) {
  return () => h(Icon, { icon, width: 18 })
}

function learnLink(type: "python" | "c") {
  return `/learn/${type}/${learnStep.value[type].toString().padStart(2, "0")}`
}

/**
 * 顶栏导航的唯一一张表：桌面端渲染成一排纯文字，窄屏收进「菜单」下拉。
 * `key` 就是一级路径，用来判定高亮（见上面的 active）。
 *
 * 顺序是 自学 / 题目 / 提交 / 题单 / 比赛 / 排名。「自学」是下拉，单独渲染在最前面，
 * 不在这张表里。提交留在一级：学生天天回来看自己交的结果，老师课上翻全班代码也走它。
 * 公告不上顶栏 —— 一年五六条、基本是版本更新，首页有公告卡片和「全部」入口；
 * 只有手机菜单里留一项（见 mobileMenus）。
 * 不用 n-menu：它横排每项固定占 100px，1280 宽的机房屏上会把顶栏挤成两行。
 */
interface NavLink {
  key: string
  label: string
  to: string
  show?: boolean
}

const navLinks = computed<NavLink[]>(() =>
  [
    { key: "problem", label: "题目", to: "/problem" },
    { key: "submission", label: "提交", to: "/submission", show: userStore.showSubmissions },
    { key: "problemset", label: "题单", to: "/problemset" },
    { key: "contest", label: "比赛", to: "/contest" },
    { key: "rank", label: "排名", to: "/rank" },
  ].filter((link) => link.show !== false),
)

const announcementLink: NavLink = { key: "announcement", label: "公告", to: "/announcement" }

const learnOptions: DropdownOption[] = [
  { label: "Python", key: "learn-python", icon: renderIcon("ph:book-open") },
  { label: "C 语言", key: "learn-c", icon: renderIcon("ph:book-open") },
]

const mobileMenus = computed<DropdownOption[]>(() => [
  { label: "自学", key: "learn", children: learnOptions },
  ...navLinks.value.map((link) => ({ label: link.label, key: link.key })),
  { label: announcementLink.label, key: announcementLink.key },
])

function handleNavSelect(key: string) {
  if (key === "learn-python") router.push(learnLink("python"))
  else if (key === "learn-c") router.push(learnLink("c"))
  else {
    const link = [...navLinks.value, announcementLink].find((item) => item.key === key)
    if (link) router.push(link.to)
  }
}

const adminPath = computed(() => (userStore.isSuperAdmin ? "/admin" : "/admin/problem/list"))

/**
 * 暗色开关放进个人菜单：顶栏右边留给老师的课堂工具。整行可点，开关只是显示状态
 * （pointer-events 关掉，免得点在开关上切两次）。
 */
function renderThemeRow() {
  return h(
    "div",
    {
      class: "theme-row",
      role: "switch",
      "aria-checked": isDark.value,
      tabindex: 0,
      onClick: toggleDark,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).click()
        }
      },
    },
    [
      h(Icon, { icon: "ph:moon", width: 18 }),
      h("span", { class: "theme-label" }, "暗色"),
      h(NSwitch, { value: isDark.value, size: "small", style: "pointer-events: none" }),
    ],
  )
}

/**
 * 个人菜单只放「自己的东西」+ 后台入口 + 暗色开关。
 * 课堂求助、课堂看板挪到了顶栏上（HelpButton、下面的课堂看板链接），不在这里。
 */
const options = computed<Array<DropdownOption | DropdownDividerOption>>(() => {
  const work = userStore.isAdminRole || userStore.canToggleDemoMode
  return [
    {
      label: "后台",
      key: "admin",
      show: userStore.isAdminRole,
      icon: renderIcon("ph:toolbox"),
      props: { onClick: () => router.push(adminPath.value) },
    },
    {
      label: userStore.demoMode ? "退出演示" : "进入演示",
      key: "demo-mode",
      show: userStore.canToggleDemoMode,
      icon: renderIcon("ph:presentation"),
      props: { onClick: handleToggleDemoMode },
    },
    { type: "divider", key: "work-divider", show: work },
    {
      label: "我的主页",
      key: "home",
      icon: renderIcon("ph:house"),
      props: { onClick: () => router.push("/user") },
    },
    {
      label: "我的成就",
      key: "achievement",
      icon: renderIcon("ph:medal"),
      props: { onClick: () => router.push("/achievement") },
    },
    {
      label: "我的提交",
      key: "status",
      icon: renderIcon("ph:list-checks"),
      props: { onClick: () => router.push("/submission?myself=1") },
    },
    {
      label: "智能分析",
      key: "ai-analysis",
      icon: renderIcon("ph:sparkle"),
      props: { onClick: () => router.push("/ai-analysis") },
    },
    {
      label: "我的设置",
      key: "setting",
      icon: renderIcon("ph:gear-six"),
      props: { onClick: () => router.push("/setting") },
    },
    { type: "divider", key: "theme-divider" },
    { type: "render", key: "theme", render: renderThemeRow },
    { type: "divider", key: "logout-divider" },
    {
      label: "退出",
      key: "logout",
      icon: renderIcon("ph:sign-out"),
      props: { onClick: handleLogout },
    },
  ]
})
</script>

<template>
  <header class="bar" :class="{ compact, wrap: isMobile || narrow }">
    <RouterLink to="/" class="brand">
      <Icon icon="streamline-emojis:dog" :height="26"></Icon>
      <span>{{ configStore.config?.websiteName }}</span>
      <n-tag v-if="envVersion" size="small" :bordered="false">{{ envVersion }}</n-tag>
      <n-tag v-if="userStore.demoMode" size="small" :bordered="false" type="warning">
        演示中
      </n-tag>
    </RouterLink>
    <nav v-if="isDesktop" class="nav">
      <n-dropdown trigger="hover" :options="learnOptions" @select="handleNavSelect">
        <button type="button" class="nav-link" :class="{ active: active === 'learn' }">
          自学<Icon icon="ph:caret-down-bold" :width="11" />
        </button>
      </n-dropdown>
      <RouterLink
        v-for="link in navLinks"
        :key="link.key"
        :to="link.to"
        class="nav-link"
        :class="{ active: active === link.key }"
      >
        {{ link.label }}
      </RouterLink>
    </nav>
    <div class="spacer"></div>
    <div class="actions">
      <ProblemJumpBox v-if="isDesktop" :compact="compact" />
      <template v-if="isDesktop && collabStore.isTeacher">
        <!-- 和提交列表的「统计」同一种按钮：平时没底色，悬停出底色 -->
        <n-button
          quaternary
          class="tool-link"
          :type="active === 'classroom' ? 'primary' : 'default'"
          title="课堂看板"
          aria-label="课堂看板"
          @click="router.push('/classroom')"
        >
          <template #icon><Icon icon="ph:monitor" /></template>
          <template v-if="!compact">课堂看板</template>
        </n-button>
        <span class="divider"></span>
      </template>
      <n-dropdown v-if="isMobile" :options="mobileMenus" size="large" @select="handleNavSelect">
        <n-button>菜单</n-button>
      </n-dropdown>
      <template v-if="userStore.isFinished">
        <n-dropdown v-if="userStore.isAuthed" :options="options" size="large">
          <n-button class="name" :title="userStore.user!.username">
            <span class="name-text">{{ userStore.user!.username }}</span>
            <Icon icon="ph:caret-down-bold" :width="11" class="caret" />
          </n-button>
        </n-dropdown>
        <template v-else>
          <n-button secondary type="primary" @click="authStore.openLoginModal()"> 登录 </n-button>
          <n-button
            tertiary
            v-if="configStore.config?.allowRegister"
            @click="authStore.openSignupModal()"
          >
            注册
          </n-button>
          <!-- 没登录就没有个人菜单，暗色开关只能留在顶栏 -->
          <n-button
            quaternary
            circle
            :title="isDark ? '切换到亮色' : '切换到暗色'"
            :aria-label="isDark ? '切换到亮色' : '切换到暗色'"
            @click="toggleDark"
          >
            <template #icon>
              <Icon :icon="isDark ? 'ph:sun' : 'ph:moon'" />
            </template>
          </n-button>
        </template>
      </template>
      <!-- 放在最末尾：出现、消失时左边的东西都不挪 -->
      <HelpButton />
    </div>
  </header>
</template>

<style scoped>
/* 加上 n-layout-header 的 1px 下边框正好 56，和题目页设计稿一致；
   题目页、教程页、流程图页的 calc(100vh - …) 都按 56 算的，改高度要一起改 */
.bar {
  height: 55px;
  box-sizing: border-box;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 28px;
  white-space: nowrap;
}

.bar.compact {
  gap: 20px;
}

/* 窄屏放不下一行：允许折行，高度跟着内容走 */
.bar.wrap {
  height: auto;
  min-height: 55px;
  padding: 8px 12px;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  font-size: 17px;
  font-weight: 700;
  color: v-bind("theme.textColor1");
  text-decoration: none;
}

.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.nav-link {
  height: 32px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 3px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  cursor: pointer;
  color: v-bind("theme.textColor2");
  text-decoration: none;
}

.nav-link:hover {
  background: v-bind("theme.hoverColor");
}

/* 当前页：浅绿底块（设计稿「顶栏重设计 · 定稿」）。字色在暗色下换浅一档，
   深绿放在暗底上看不清 —— 和题目页课堂条同一个做法 */
.nav-link.active {
  background: v-bind("tone.activeBg");
  color: v-bind("tone.activeText");
  font-weight: 600;
}

.spacer {
  flex: 1 1 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
}

/* 按钮左右自带的留白吃回去，和两边的间距不变 */
.tool-link {
  margin: 0 -8px;
}

.divider {
  width: 1px;
  height: 20px;
  background-color: v-bind("theme.dividerColor");
}

/* 学生用户名最长有 25 个字符：按钮最宽 160，多出来的省略，全名在 title 里 */
.name {
  max-width: 160px;
}

/* 1024 宽、老师那版、名字按最长的算，160 会挤进右边距 */
.bar.compact .name {
  max-width: 120px;
}

.name :deep(.n-button__content) {
  min-width: 0;
  gap: 4px;
}

.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.caret {
  flex: none;
}
</style>

<!-- 暗色开关那一行是 render 出来挂在 dropdown 里的（teleport 到 body），scoped 够不着 -->
<style>
.theme-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px 0 12px;
  cursor: pointer;
}

.theme-row .theme-label {
  flex: 1 1 0;
  font-size: 15px;
}
</style>
