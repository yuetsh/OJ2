import { PROBLEM_PERMISSION, STORAGE_KEY, USER_TYPE } from "utils/constants"
import storage from "utils/storage"
import type { Profile, SessionUser } from "utils/types"
import { getProfile, logout } from "../api"
import { useConfigStore } from "./config"

export const useUserStore = defineStore("user", () => {
  const configStore = useConfigStore()

  const profile = ref<Profile | null>(null)
  const [isFinished] = useToggle(false)
  const user = computed<SessionUser | null>(() => profile.value?.user ?? null)
  const isAuthed = computed(() => !!user.value?.email)

  // 演示模式：超管临时把界面伪装成普通学生，方便上课投屏
  const demoMode = ref<boolean>(storage.get(STORAGE_KEY.DEMO_MODE) ?? false)

  // 不受伪装影响的真实身份，只用于判断能否切换演示模式。
  // 若这里用被伪装后的 isSuperAdmin，一进入演示模式入口就消失了，退不出来。
  const realIsSuperAdmin = computed(
    () => user.value?.adminType === USER_TYPE.SUPER_ADMIN,
  )

  const isAdminRole = computed(
    () =>
      !demoMode.value &&
      (user.value?.adminType === USER_TYPE.STUDENT_ADMIN ||
        user.value?.adminType === USER_TYPE.TEACHER_ADMIN ||
        user.value?.adminType === USER_TYPE.SUPER_ADMIN),
  )
  const isStudentAdmin = computed(
    () => !demoMode.value && user.value?.adminType === USER_TYPE.STUDENT_ADMIN,
  )
  const isTeacherAdmin = computed(
    () => !demoMode.value && user.value?.adminType === USER_TYPE.TEACHER_ADMIN,
  )
  const isTeacherOrAbove = computed(
    () =>
      !demoMode.value &&
      (user.value?.adminType === USER_TYPE.TEACHER_ADMIN ||
        user.value?.adminType === USER_TYPE.SUPER_ADMIN),
  )
  const isSuperAdmin = computed(() => !demoMode.value && realIsSuperAdmin.value)
  const hasProblemPermission = computed(
    () =>
      !demoMode.value &&
      user.value?.problemPermission !== PROBLEM_PERMISSION.NONE,
  )

  const canToggleDemoMode = computed(() => realIsSuperAdmin.value)

  function toggleDemoMode() {
    demoMode.value = !demoMode.value
    storage.set(STORAGE_KEY.DEMO_MODE, demoMode.value)
  }

  const showSubmissions = computed(() => {
    let flag = configStore.config.submissionListShowAll
    if (isAdminRole.value) flag = true
    return flag
  })

  // 同一时刻只发一份 /profile。App.vue 挂载时要拉、路由守卫要拉、页面自己也可能
  // 要拉（子组件的 onMounted 比 App.vue 的先跑），不去重就是同一个请求发好几遍，
  // 页面里等它的那些请求还得跟着排队。只合并「正在飞的那一次」，不缓存结果 ——
  // 登录后和改完设置仍然要能重新拉一份。
  let inflight: Promise<void> | null = null

  function getMyProfile() {
    if (inflight) return inflight
    isFinished.value = false
    inflight = getProfile()
      .then((res) => {
        profile.value = res
        isFinished.value = true
        storage.set(STORAGE_KEY.AUTHED, !!user.value?.email)
      })
      .finally(() => (inflight = null))
    return inflight
  }

  function clearProfile() {
    profile.value = null
    demoMode.value = false
    storage.clear()
  }

  // 退登的两步（吊销服务端会话、清本地状态）绑在一起：只清本地会留一个还活着
  // 的 cookie，下次进站又被 /profile 认回来。跳转留给调用方，store 里不碰路由。
  async function signOut() {
    await logout()
    clearProfile()
  }
  return {
    profile,
    isFinished,
    user,
    isAdminRole,
    isStudentAdmin,
    isTeacherAdmin,
    isTeacherOrAbove,
    isSuperAdmin,
    hasProblemPermission,
    demoMode,
    canToggleDemoMode,
    toggleDemoMode,
    isAuthed,
    showSubmissions,
    getMyProfile,
    clearProfile,
    signOut,
  }
})
