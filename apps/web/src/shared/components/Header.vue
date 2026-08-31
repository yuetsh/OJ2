<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { RouterLink } from "vue-router"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useDarkTransition } from "shared/composables/darkTransition"
import { useLearnProgress } from "shared/composables/learnProgress"
import { useAuthModalStore } from "shared/store/authModal"
import { useCollabStore } from "shared/store/collab"
import { useScreenModeStore } from "shared/store/screenMode"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"

const userStore = useUserStore()
const configStore = useConfigStore()
const collabStore = useCollabStore()
const authStore = useAuthModalStore()
const screenModeStore = useScreenModeStore()
const route = useRoute()
const router = useRouter()

const { isMobile, isDesktop } = useBreakpoints()
const { learnStep } = useLearnProgress()
const { isDark, toggleDark } = useDarkTransition()

/**
 * 求助的入口收进姓名下拉里，顶栏只留姓名按钮上的角标 —— 老师不用展开菜单
 * 也能看见有没有人举手。窄屏同样给：接单之后要在弹框里替学生写代码，那件事
 * 确实只有桌面端好使，但「有没有人在等」是宽度多少都得知道的。
 */
const pendingHelpCount = computed(() =>
  collabStore.isTeacher ? collabStore.pendingCount : 0,
)

// 从 store 中获取屏幕模式状态
const { screenMode } = storeToRefs(screenModeStore)

const names = [
  "man-with-chinese-cap-1",
  "cat-face",
  "china",
  "chicken",
  "eyes",
  "elephant",
  "hear-no-evil-monkey",
  "panda-face",
  "penguin-1",
  "rooster",
  "star-struck-1",
  "tomato",
  "rocket",
  "sparkles",
  "money-bag",
  "ghost",
  "game-dice",
  "ewe-1",
  "artist-palette",
  "baby-bottle",
]

function getRandomAvatar() {
  const name = names[Math.floor(Math.random() * names.length)]
  return `streamline-emojis:${name}`
}

const avatar = ref(getRandomAvatar())

const envVersion = computed(() => {
  if (import.meta.env.PUBLIC_ENV === "test") {
    return "测试版"
  } else if (import.meta.env.PUBLIC_ENV === "dev") {
    return "开发版"
  }
  return ""
})

/**
 * 站名后面括号里的东西：环境名 + 演示中。
 *
 * 演示模式除了下拉里那行「退出演示」再没有别的痕迹，而它是存在 localStorage 里
 * 的，刷新、关标签页都还在，只有退出登录才清 —— 不在这儿常驻标一下，很容易
 * 投屏完忘了退，第二天纳闷后台入口怎么没了。
 */
const titleTags = computed(() =>
  [envVersion.value, userStore.demoMode ? "演示中" : ""].filter(Boolean),
)

// 一级路径就是菜单 key，对不上的页面（/user、/setting、/achievement 等）
// 自然没有一项亮着
const active = computed(() => route.path.split("/")[1] || "problem")

async function handleLogout() {
  await userStore.signOut()
  router.replace("/")
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

const menus = computed<MenuOption[]>(() => [
  {
    label: "自学",
    key: "learn",
    icon: renderIcon("fluent-emoji:books"),
    children: [
      {
        label: () =>
          h(
            RouterLink,
            { to: learnLink("python") },
            { default: () => "Python" },
          ),
        key: "learn-python",
      },
      {
        label: () =>
          h(RouterLink, { to: learnLink("c") }, { default: () => "C语言" }),
        key: "learn-c",
      },
    ],
  },
  {
    label: () => h(RouterLink, { to: "/" }, { default: () => "题目" }),
    key: "problem",
    icon: renderIcon("fluent-emoji:memo"),
  },
  {
    label: () =>
      h(RouterLink, { to: "/problemset" }, { default: () => "题单" }),
    key: "problemset",
    icon: renderIcon("fluent-emoji:clipboard"),
  },
  {
    label: () =>
      h(RouterLink, { to: "/submission" }, { default: () => "提交" }),
    key: "submission",
    icon: renderIcon("fluent-emoji:inbox-tray"),
    show: userStore.showSubmissions,
  },
  {
    label: () => h(RouterLink, { to: "/contest" }, { default: () => "比赛" }),
    key: "contest",
    icon: renderIcon("fluent-emoji:chequered-flag"),
  },
  {
    label: () => h(RouterLink, { to: "/rank" }, { default: () => "排名" }),
    key: "rank",
    icon: renderIcon("fluent-emoji:trophy"),
  },
  {
    label: () =>
      h(RouterLink, { to: "/announcement" }, { default: () => "公告" }),
    key: "announcement",
    icon: renderIcon("fluent-emoji:loudspeaker"),
  },
  {
    label: () =>
      h(
        RouterLink,
        { to: userStore.isSuperAdmin ? "/admin" : "/admin/problem/list" },
        { default: () => "后台" },
      ),
    show: userStore.isAdminRole,
    key: "admin",
    icon: renderIcon("fluent-emoji:gear"),
  },
])

const options = computed<Array<DropdownOption | DropdownDividerOption>>(() => [
  {
    label: pendingHelpCount.value
      ? `课堂求助（${pendingHelpCount.value}）`
      : "课堂求助",
    key: "help",
    show: collabStore.isTeacher,
    icon: renderIcon("streamline-emojis:raising-hands-2"),
    props: {
      onClick: () => (collabStore.helpPanelOpen = true),
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

function goHome() {
  router.push("/")
}
</script>

<template>
  <n-flex justify="space-between" align="center">
    <n-flex align="center">
      <!-- text 按钮而不是带 @click 的 div：站名要能 tab 到、回车能按 -->
      <n-button text class="title" @click="goHome">
        <n-flex align="center">
          <Icon icon="streamline-emojis:dog" :height="30"></Icon>
          <div>{{ configStore.config?.websiteName }}</div>
          <div v-if="titleTags.length">({{ titleTags.join(" · ") }})</div>
        </n-flex>
      </n-button>
      <div>
        <n-menu
          v-if="isDesktop"
          mode="horizontal"
          :options="menus"
          :value="active"
        />
      </div>
    </n-flex>
    <n-flex align="center">
      <n-dropdown v-if="isMobile" :options="menus" size="large">
        <n-button>
          <Icon icon="fluent-emoji:artist-palette" height="20"></Icon>
          <span style="padding-left: 8px">菜单</span>
        </n-button>
      </n-dropdown>
      <n-button
        v-if="
          isDesktop &&
          (route.name === 'problem' || route.name === 'contest problem')
        "
        @click="() => screenModeStore.switchScreenMode()"
      >
        {{ screenMode }}
      </n-button>
      <div v-if="userStore.isFinished">
        <n-dropdown v-if="userStore.isAuthed" :options="options" size="large">
          <n-badge :value="pendingHelpCount" :max="99">
            <n-button>
              <Icon :icon="avatar" height="20"></Icon>
              <span style="padding-left: 8px">
                {{ userStore.user!.username }}
              </span>
            </n-button>
          </n-badge>
        </n-dropdown>
        <n-flex align="center" v-else>
          <n-button
            secondary
            type="primary"
            @click="authStore.openLoginModal()"
          >
            登录
          </n-button>
          <n-button
            tertiary
            v-if="configStore.config?.allowRegister"
            @click="authStore.openSignupModal()"
          >
            注册
          </n-button>
        </n-flex>
      </div>
      <n-button :bordered="false" circle @click="toggleDark">
        <template #icon>
          <Icon v-if="isDark" icon="fluent-emoji:sun"></Icon>
          <Icon v-else icon="fluent-emoji:full-moon"></Icon>
        </template>
      </n-button>
    </n-flex>
  </n-flex>
</template>

<style scoped>
.title {
  font-size: 18px;
}
</style>
