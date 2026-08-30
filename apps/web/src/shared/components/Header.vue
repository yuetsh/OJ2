<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { RouterLink } from "vue-router"
import { useBreakpoints } from "shared/composables/breakpoints"
import { useLearnProgress } from "shared/composables/learnProgress"
import { useAuthModalStore } from "shared/store/authModal"
import { useCollabStore } from "shared/store/collab"
import { useScreenModeStore } from "shared/store/screenMode"
import { logout } from "../api"
import CollabModal from "./CollabModal.vue"
import HelpRequestList from "./HelpRequestList.vue"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"
import { trickOrTreat } from "utils/functions"

const userStore = useUserStore()
const configStore = useConfigStore()
const collabStore = useCollabStore()
const message = useMessage()

/**
 * 课堂求助的一次性提示，统一在这里弹。
 *
 * 原来挂在题目页的 Form.vue 上：学生排着队切去看提交记录，老师这时候取消了
 * 他的求助，那条「老师已取消你的求助」就永远没人消费。顶栏是全局的，放这儿
 * 才收得全 —— 教师端的 error 提示（比如「请先退出当前协作」）同理。
 */
watch(
  () => collabStore.noticeSeq,
  () => {
    const text = collabStore.consumeNotice()
    if (text) message.info(text)
  },
)
const authStore = useAuthModalStore()
const screenModeStore = useScreenModeStore()
const route = useRoute()
const router = useRouter()

const { isMobile, isDesktop } = useBreakpoints()
const { learnStep } = useLearnProgress()

const isDark = useDark()

/**
 * 圆环从哪儿开始扩散。正常点击就用指针落点；键盘触发（Enter / 空格）时浏览器给的
 * clientX/clientY 是 0，照用会让圆环从屏幕左上角冒出来——那种情况退回按钮自己的中心。
 * `event.detail` 是点击次数，键盘触发时为 0，用它区分最省事。
 */
function revealOrigin(event: MouseEvent) {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function toggleDark(event: MouseEvent) {
  if (!document.startViewTransition) {
    // 机房那批 Chrome 低于 94，没有 View Transitions，直接切、不做动画。
    isDark.value = !isDark.value
    return
  }
  const { x, y } = revealOrigin(event)
  // 半径要取到**最远**那个角的距离。用 hypot(x, y) 只覆盖到左上角，
  // 点在偏左上时右下角会有一块旧画面等圆环扩过去，看着像是没刷新。
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  document
    .startViewTransition(() => {
      isDark.value = !isDark.value
    })
    .ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 400,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        },
      )
    })
    .catch(() => {})
}

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

const showEnvVersion = computed(() => {
  return (
    import.meta.env.PUBLIC_ENV === "test" ||
    import.meta.env.PUBLIC_ENV === "dev"
  )
})

const active = computed(() => {
  const path = route.path.split("/")[1] || "problem"
  return !["user", "setting"].includes(path) ? path : ""
})

async function handleLogout() {
  await logout()
  userStore.clearProfile()
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
    label: () => h(RouterLink, { to: "/class/pk" }, { default: () => "班级" }),
    show: false,
    key: "class",
    icon: renderIcon("fluent-emoji:crossed-swords"),
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
    label: "我的主页",
    key: "home",
    icon: renderIcon("streamline-ultimate-color:newspaper-fold"),
    props: {
      onClick: () => router.push("/user"),
    },
  },
  {
    label: "我的消息",
    key: "message",
    show: false,
    icon: renderIcon("streamline-emojis:herb"),
    props: {
      onClick: () => router.push("/message"),
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

function handleMenuSelect(key: string) {
  if (key === "dont-click") {
    trickOrTreat()
  }
}
</script>

<template>
  <n-flex justify="space-between" align="center">
    <n-flex align="center">
      <n-flex align="center" class="title" @click="goHome">
        <Icon icon="streamline-emojis:dog" :height="30"></Icon>
        <div>{{ configStore.config?.websiteName }}</div>
        <div v-if="showEnvVersion">({{ envVersion }})</div>
      </n-flex>
      <div>
        <n-menu
          v-if="isDesktop"
          mode="horizontal"
          :options="menus"
          :value="active"
          @update:value="handleMenuSelect"
        />
      </div>
    </n-flex>
    <n-flex align="center">
      <n-dropdown
        v-if="isMobile"
        :options="menus"
        size="large"
        @select="handleMenuSelect"
      >
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
      <HelpRequestList v-if="isDesktop && userStore.isTeacherOrAbove" />
      <div v-if="userStore.isFinished">
        <n-dropdown v-if="userStore.isAuthed" :options="options" size="large">
          <n-button>
            <Icon :icon="avatar" height="20"></Icon>
            <span style="padding-left: 8px">
              {{ userStore.user!.username }}
            </span>
          </n-button>
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
    <!--
      挂在根 n-flex 内部而不是同级：Header.vue 一旦变成多根 fragment，
      default.vue 里 `<Header class="header" />` 那个 class 就没有任何单一
      根节点可以落地（Vue 会报 "Extraneous non-props attributes" 警告并把它
      整个丢弃），header 行随之丢掉 `max-width: 2000px` 那条居中样式。
      n-modal 默认 teleport 到 body，塞在这里不影响它的实际渲染位置。
    -->
    <CollabModal v-if="userStore.isTeacherOrAbove" />
  </n-flex>
</template>

<style scoped>
.title {
  font-size: 18px;
  cursor: pointer;
}
</style>
