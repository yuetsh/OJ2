import { defineStore } from "pinia"

/**
 * 登录框、注册框开没开。表单本身在两个组件里：每次打开都从干净的表单开始
 * （机房一台电脑轮流坐人，别把上一个人的名字和密码留在框里），不需要跨组件共享。
 */
export const useAuthModalStore = defineStore("authModal", () => {
  const loginModalOpen = ref(false)
  const signupModalOpen = ref(false)

  function openLoginModal() {
    loginModalOpen.value = true
  }

  function closeLoginModal() {
    loginModalOpen.value = false
  }

  function openSignupModal() {
    signupModalOpen.value = true
  }

  function closeSignupModal() {
    signupModalOpen.value = false
  }

  function switchToSignup() {
    closeLoginModal()
    openSignupModal()
  }

  function switchToLogin() {
    closeSignupModal()
    openLoginModal()
  }

  return {
    loginModalOpen,
    signupModalOpen,
    openLoginModal,
    closeLoginModal,
    openSignupModal,
    closeSignupModal,
    switchToSignup,
    switchToLogin,
  }
})
