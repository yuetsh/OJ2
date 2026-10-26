<script setup lang="ts">
import { registerRequestSchema } from '@oj2/contract'
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import { errorCode } from 'utils/api'
import { login, signup } from '../api'
import { useAuthModalStore } from '../store/authModal'
import { useUserStore } from '../store/user'

/**
 * 注册框。错在哪个框就标在哪个框下面，不攒成最底下一条；注册完直接登上，
 * 不用回登录框再输一遍。开关在后台设置里（allow_register），关着时顶栏没有入口。
 */
type Field = 'username' | 'email' | 'password' | 'again'

const authStore = useAuthModalStore()
const userStore = useUserStore()
const { signupModalOpen } = storeToRefs(authStore)
const theme = useThemeVars()

// n-modal 把内容传送到 body 底下，CSS 的 v-bind() 挂不上去（变量挂在组件根上，
// 这个组件的根是 n-modal 自己）—— 颜色直接写到弹框根节点的 style 里
const themeVars = computed(() => ({
  '--t-box-shadow-3': theme.value.boxShadow3,
  '--t-error-color': theme.value.errorColor,
  '--t-hover-color': theme.value.hoverColor,
  '--t-modal-color': theme.value.modalColor,
  '--t-primary-color': theme.value.primaryColor,
  '--t-primary-color-hover': theme.value.primaryColorHover,
  '--t-text-color-1': theme.value.textColor1,
  '--t-text-color-2': theme.value.textColor2,
}))

const form = reactive({ username: '', email: '', password: '', again: '' })
const errors = reactive<Partial<Record<Field, string>>>({})
/** 不归哪个框的错（注册太频繁、网络） */
const general = ref('')
const loading = ref(false)

const usernameRef = useTemplateRef('usernameRef')

function check() {
  for (const key of Object.keys(errors) as Field[]) delete errors[key]
  if (!form.username.trim()) errors.username = '写上用户名'
  if (!form.email.trim()) errors.email = '写上邮箱'
  else if (!registerRequestSchema.shape.email.safeParse(form.email.trim()).success) {
    errors.email = '邮箱的样子不对，比如 zhangsan@qq.com'
  }
  if (form.password.length < 6 || form.password.length > 20) errors.password = '密码要 6 到 20 位'
  if (!errors.password && form.again !== form.password) errors.again = '和上面的不一样'
  return Object.keys(errors).length === 0
}

function clearOne(field: Field) {
  delete errors[field]
  general.value = ''
}

async function submit() {
  if (loading.value || !check()) return
  loading.value = true
  general.value = ''
  const username = form.username.trim()
  try {
    await signup({ username, email: form.email.trim(), password: form.password })
  } catch (err) {
    const code = errorCode(err)
    if (code === 'username-exists') errors.username = '这个名字已经有人用了，换一个'
    else if (code === 'email-exists') errors.email = '这个邮箱已经注册过了'
    else if (code === 'too-many-registrations') general.value = '注册太频繁了，等一会儿再试'
    else if (code === 'registration-disabled') general.value = '现在不开放注册'
    else general.value = '注册不了，等一会儿再试'
    loading.value = false
    return
  }
  try {
    await login({ username, password: form.password })
    authStore.closeSignupModal()
    await userStore.getMyProfile()
  } catch {
    // 号已经建好了，只是这一下没登上：回登录框自己登
    authStore.switchToLogin()
  } finally {
    loading.value = false
  }
}

watch(signupModalOpen, (open) => {
  if (!open) return
  Object.assign(form, { username: '', email: '', password: '', again: '' })
  for (const key of Object.keys(errors) as Field[]) delete errors[key]
  general.value = ''
  nextTick(() => usernameRef.value?.focus())
})
</script>

<template>
  <n-modal v-model:show="signupModalOpen" :mask-closable="false" :auto-focus="false">
    <div class="box" :style="themeVars" role="dialog" aria-label="注册">
      <div class="head">
        <h2>注册</h2>
        <span class="grow"></span>
        <button class="close" type="button" aria-label="关闭" @click="authStore.closeSignupModal()">
          <Icon icon="ph:x" :width="18" />
        </button>
      </div>
      <div class="form">
        <label class="field">
          <span class="lab">用户名</span>
          <n-input
            ref="usernameRef"
            v-model:value="form.username"
            size="large"
            clearable
            :maxlength="32"
            placeholder="以后登录就写它"
            :input-props="{ name: 'username', autocomplete: 'username' }"
            :status="errors.username ? 'error' : undefined"
            @update:value="clearOne('username')"
          />
          <span v-if="errors.username" class="err">{{ errors.username }}</span>
        </label>
        <label class="field">
          <span class="lab">邮箱</span>
          <n-input
            v-model:value="form.email"
            size="large"
            clearable
            :maxlength="64"
            placeholder="常用的邮箱"
            :input-props="{ name: 'email', autocomplete: 'email' }"
            :status="errors.email ? 'error' : undefined"
            @update:value="clearOne('email')"
          />
          <span v-if="errors.email" class="err">{{ errors.email }}</span>
        </label>
        <label class="field">
          <span class="lab">密码</span>
          <n-input
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            size="large"
            :maxlength="20"
            placeholder="6 到 20 位"
            :input-props="{ name: 'password', autocomplete: 'new-password' }"
            :status="errors.password ? 'error' : undefined"
            @update:value="clearOne('password')"
          />
          <span v-if="errors.password" class="err">{{ errors.password }}</span>
        </label>
        <label class="field">
          <span class="lab">再输一遍密码</span>
          <n-input
            v-model:value="form.again"
            type="password"
            show-password-on="click"
            size="large"
            :maxlength="20"
            :input-props="{ name: 'password-again', autocomplete: 'new-password' }"
            :status="errors.again ? 'error' : undefined"
            @update:value="clearOne('again')"
            @keyup.enter="submit"
          />
          <span v-if="errors.again" class="err">{{ errors.again }}</span>
        </label>
        <span v-if="general" class="err">{{ general }}</span>
        <n-button type="primary" size="large" :loading="loading" @click="submit"> 注册并登录 </n-button>
        <div class="links">
          <button class="link" type="button" @click="authStore.switchToLogin()">已经有账号了，去登录</button>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 24px 28px;
  border-radius: var(--oj-radius);
  background: var(--t-modal-color);
  color: var(--t-text-color-1);
  box-shadow: var(--t-box-shadow-3);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.head h2 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
}

.grow {
  flex: 1;
}

.close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--t-text-color-2);
  cursor: pointer;
}

.close:hover {
  background: var(--t-hover-color);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 20px;
}

.field {
  display: flex;
  flex-direction: column;
}

.lab {
  margin-bottom: 6px;
  font-size: var(--oj-fs-sec);
  color: var(--t-text-color-2);
}

.err {
  margin-top: 6px;
  font-size: var(--oj-fs-sec);
  line-height: 20px;
  color: var(--t-error-color);
}

.form > .err {
  margin-top: -8px;
}

.links {
  display: flex;
  justify-content: center;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--oj-fs-sec);
  color: var(--t-primary-color);
  cursor: pointer;
}

.link:hover {
  color: var(--t-primary-color-hover);
}

@media (max-width: 640px) {
  .box {
    width: 100vw;
    /* 全站给 .n-modal 的「左右各留 16px」在这里不要 */
    max-width: none;
    /* 100vh 是浏览器工具栏收起时的高度，工具栏露着的时候底下那截被压住；
       dvh 跟着工具栏变，Chrome 108 起才有，105 退回 100vh */
    height: 100vh;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    padding: 12px 16px 16px;
  }
}
</style>
