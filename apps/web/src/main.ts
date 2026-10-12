import { addAPIProvider } from "@iconify/vue"
import { createPinia } from "pinia"
import { createRouter, createWebHistory } from "vue-router"

import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"

import App from "./App.vue"
import { admins, ojs } from "./routes"

const router = createRouter({
  history: createWebHistory(),
  routes: [ojs, admins],
})

const pinia = createPinia()

// 创建 app 并安装插件
const app = createApp(App)
app.use(pinia)
app.use(router)

// 现在可以安全地使用 Store
import { useAuthModalStore } from "./shared/store/authModal"
import { useUserStore } from "./shared/store/user"

const authStore = useAuthModalStore()

// vue-router 5.4 起 next() 回调已弃用，改成返回值：返回 "/" 就是跳回首页，什么都不返回就是放行
router.beforeEach(async (to) => {
  // 检查是否需要认证
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    if (!storage.get(STORAGE_KEY.AUTHED)) {
      authStore.openLoginModal()
      return "/"
    }
  }

  // 检查权限
  if (
    to.matched.some(
      (record) =>
        record.meta.requiresSuperAdmin ||
        record.meta.requiresTeacherAdmin ||
        record.meta.requiresProblemPermission,
    )
  ) {
    if (!storage.get(STORAGE_KEY.AUTHED)) {
      authStore.openLoginModal()
      return "/"
    }

    const userStore = useUserStore()
    if (!userStore.user) {
      try {
        await userStore.getMyProfile()
      } catch {
        return "/"
      }
    }
    if (to.matched.some((record) => record.meta.requiresSuperAdmin)) {
      if (!userStore.isSuperAdmin) {
        return "/"
      }
    } else if (to.matched.some((record) => record.meta.requiresTeacherAdmin)) {
      if (!userStore.isTeacherOrAbove) {
        return "/"
      }
    } else if (to.matched.some((record) => record.meta.requiresProblemPermission)) {
      if (!userStore.hasProblemPermission) {
        return "/"
      }
    }
  }
})

app.mount("#app")

if (import.meta.env.PUBLIC_ICONIFY_URL) {
  addAPIProvider("", {
    resources: [import.meta.env.PUBLIC_ICONIFY_URL],
  })
}
