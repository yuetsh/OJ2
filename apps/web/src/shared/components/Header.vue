<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { RouterLink } from "vue-router"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useDarkTransition } from "shared/composables/darkTransition"
import { useLearnProgress } from "shared/composables/learnProgress"
import { useProblemJump } from "shared/composables/problemJump"
import { useAuthModalStore } from "shared/store/authModal"
import { useCollabStore } from "shared/store/collab"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"
import { useThemeVars } from "naive-ui"

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
 * 求助的入口收进姓名下拉里，顶栏只留姓名按钮上的角标 —— 老师不用展开菜单
 * 也能看见有没有人举手。窄屏同样给：接单之后要在弹框里替学生写代码，那件事
 * 确实只有桌面端好使，但「有没有人在等」是宽度多少都得知道的。
 */
const pendingHelpCount = computed(() => (collabStore.isTeacher ? collabStore.pendingCount : 0))

/**
 * 顶栏的题号框：老师报完题号，学生在哪一页都能直接敲，不用先回首页或题目列表。
 * 只给桌面端 —— 窄屏顶栏已经挤满了，手机上从首页的搜索框走同一套逻辑。
 */
const { jump, jumping } = useProblemJump()
const jumpKeyword = ref("")

async function handleJump() {
  await jump(jumpKeyword.value)
  jumpKeyword.value = ""
}

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
  return () => h(Icon, { icon, width: 20 })
}

function learnLink(type: "python" | "c") {
  return `/learn/${type}/${learnStep.value[type].toString().padStart(2, "0")}`
}

/**
 * 顶栏导航的唯一一张表：桌面端渲染成一排纯文字链接，窄屏收进「菜单」下拉。
 * `key` 就是一级路径，用来判定高亮（见上面的 active）。
 *
 * 桌面端不带图标、不用 n-menu：n-menu 横排每项固定占 100px，管理员 8 项在
 * 1280 宽的机房屏上直接把顶栏挤成两行。图标只留给下拉菜单。
 */
interface NavLink {
  key: string
  label: string
  to: string
  icon: string
  show?: boolean
}

const navLinks = computed<NavLink[]>(() =>
  [
    { key: "problem", label: "题目", to: "/problem", icon: "fluent-emoji:memo" },
    { key: "problemset", label: "题单", to: "/problemset", icon: "fluent-emoji:clipboard" },
    {
      key: "submission",
      label: "提交",
      to: "/submission",
      icon: "fluent-emoji:inbox-tray",
      show: userStore.showSubmissions,
    },
    { key: "contest", label: "比赛", to: "/contest", icon: "fluent-emoji:chequered-flag" },
    { key: "rank", label: "排名", to: "/rank", icon: "fluent-emoji:trophy" },
    { key: "announcement", label: "公告", to: "/announcement", icon: "fluent-emoji:loudspeaker" },
  ].filter((link) => link.show !== false),
)

const learnOptions: DropdownOption[] = [
  { label: "Python", key: "learn-python" },
  { label: "C语言", key: "learn-c" },
]

// 「后台」不和学生导航排在一起：桌面端放到右边那组的开头、弱化成灰字，
// 老师和学生看到的顶栏前半截就是同一排
const adminPath = computed(() => (userStore.isSuperAdmin ? "/admin" : "/admin/problem/list"))

const mobileMenus = computed<DropdownOption[]>(() => [
  {
    label: "自学",
    key: "learn",
    icon: renderIcon("fluent-emoji:books"),
    children: learnOptions,
  },
  ...navLinks.value.map((link) => ({
    label: link.label,
    key: link.key,
    icon: renderIcon(link.icon),
  })),
  {
    label: "后台",
    key: "admin",
    icon: renderIcon("fluent-emoji:gear"),
    show: userStore.isAdminRole,
  },
])

function handleNavSelect(key: string) {
  if (key === "learn-python") router.push(learnLink("python"))
  else if (key === "learn-c") router.push(learnLink("c"))
  else if (key === "admin") router.push(adminPath.value)
  else {
    const link = navLinks.value.find((item) => item.key === key)
    if (link) router.push(link.to)
  }
}

const options = computed<Array<DropdownOption | DropdownDividerOption>>(() => [
  {
    label: pendingHelpCount.value ? `课堂求助（${pendingHelpCount.value}）` : "课堂求助",
    key: "help",
    show: collabStore.isTeacher,
    icon: renderIcon("streamline-emojis:raising-hands-2"),
    props: {
      onClick: () => (collabStore.helpPanelOpen = true),
    },
  },
  {
    label: "课堂看板",
    key: "classroom-board",
    show: userStore.isTeacherOrAbove,
    icon: renderIcon("fluent-emoji:school"),
    props: {
      onClick: () => router.push("/classroom"),
    },
  },
  {
    label: "我的主页",
    key: "home",
    icon: renderIcon("streamline-ultimate-color:newspaper-fold"),
    props: {
      onClick: () => router.push("/user"),
    },
  },
  {
    label: "我的成就",
    key: "achievement",
    icon: renderIcon("streamline-ultimate-color:award-medal-4"),
    props: {
      onClick: () => router.push("/achievement"),
    },
  },
  {
    label: "我的提交",
    key: "status",
    icon: renderIcon("streamline-ultimate-color:analytics-bars-3d"),
    props: {
      onClick: () => router.push("/submission?myself=1"),
    },
  },
  {
    label: "我的设置",
    key: "setting",
    icon: renderIcon("streamline-emojis:musical-score"),
    props: {
      onClick: () => router.push("/setting"),
    },
  },
  {
    label: "智能分析",
    key: "ai-analysis",
    icon: renderIcon("vscode-icons:file-type-gemini"),
    props: {
      onClick: () => router.push("/ai-analysis"),
    },
  },
  {
    label: userStore.demoMode ? "退出演示" : "进入演示",
    key: "demo-mode",
    show: userStore.canToggleDemoMode,
    icon: renderIcon("fluent-emoji:graduation-cap"),
    props: { onClick: handleToggleDemoMode },
  },
  { type: "divider" },
  {
    label: "退出",
    key: "logout",
    icon: renderIcon("streamline-ultimate-color:coffee-cold"),
    props: { onClick: handleLogout },
  },
])
</script>

<template>
  <header class="bar" :class="{ mobile: isMobile }">
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
        <button type="button" class="nav-link" :class="{ active: active === 'learn' }">自学</button>
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
      <template v-if="isDesktop && userStore.isAdminRole">
        <RouterLink :to="adminPath" class="admin-link">
          <Icon icon="ph:gear-six" :width="15" />
          <span>后台</span>
        </RouterLink>
        <span class="divider"></span>
      </template>
      <n-dropdown v-if="isMobile" :options="mobileMenus" size="large" @select="handleNavSelect">
        <n-button>菜单</n-button>
      </n-dropdown>
      <n-input
        v-if="isDesktop"
        v-model:value="jumpKeyword"
        class="jump"
        placeholder="输入题号直达"
        :loading="jumping"
        @keyup.enter="handleJump"
      >
        <template #prefix>
          <Icon icon="ph:magnifying-glass" />
        </template>
      </n-input>
      <template v-if="userStore.isFinished">
        <n-dropdown v-if="userStore.isAuthed" :options="options" size="large">
          <n-badge :value="pendingHelpCount" :max="99">
            <n-button>{{ userStore.user!.username }}</n-button>
          </n-badge>
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
        </template>
      </template>
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

/* 窄屏放不下一行：允许折行，高度跟着内容走 */
.bar.mobile {
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
  gap: 22px;
  flex: none;
}

.nav-link {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  color: v-bind("theme.textColor2");
  text-decoration: none;
}

.nav-link:hover {
  color: v-bind("theme.primaryColor");
}

.nav-link.active {
  color: v-bind("theme.primaryColorPressed");
  font-weight: 600;
}

.spacer {
  flex: 1 1 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.admin-link {
  display: flex;
  align-items: center;
  gap: 5px;
  color: v-bind("theme.textColor3");
  text-decoration: none;
}

.admin-link:hover {
  color: v-bind("theme.primaryColor");
}

.divider {
  width: 1px;
  height: 20px;
  background-color: v-bind("theme.dividerColor");
}

.jump {
  width: 180px;
}
</style>
