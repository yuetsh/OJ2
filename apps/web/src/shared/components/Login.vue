<script setup lang="ts">
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import { getClassUsernames, login } from "../api"
import { storeToRefs } from "pinia"
import { useAuthModalStore } from "../store/authModal"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"
import { useLoginSummaryStore } from "../store/loginSummary"

const userStore = useUserStore()
const loginSummaryStore = useLoginSummaryStore()
const configStore = useConfigStore()
const authStore = useAuthModalStore()

const {
  loginModalOpen,
  loginForm: form,
  loginLoading: isLoading,
  loginError: msg,
} = storeToRefs(authStore)

// 学生页签走「班级 + 姓名」两个下拉，一个字都不用打；
// 管理员页签只有用户名 + 密码，不拼班级前缀。
const activeTab = ref<"student" | "admin">("student")
const studentRef = useTemplateRef("studentRef")
const adminRef = useTemplateRef("adminRef")
const studentPasswordRef = useTemplateRef("studentPasswordRef")
const classUserOptions = ref<SelectOption[]>([])
const classUserLoading = ref(false)
// 姓名支持拼音和拼音缩写搜索（张三 ← zhangsan / zs）。pinyin-pro 带着一份几百 K 的
// 词典，静态引入会压进首屏 —— 改成打开登录框才拉，已登录的人一次都不会下载。
// 用 match 而不是自己拼拼音串：多音字它两个读音都认（单田芳 ← stf 和 dtf 都能搜到）。
type MatchFn = typeof import("pinyin-pro").match
const pinyinMatch = shallowRef<MatchFn | null>(null)
async function ensurePinyin() {
  if (pinyinMatch.value) return
  try {
    pinyinMatch.value = (await import("pinyin-pro")).match
  } catch {
    // 拉不下来就只剩中文匹配，不至于让人登不上
  }
}
function filterClassUser(pattern: string, option: SelectOption) {
  const keyword = pattern.trim()
  if (!keyword) return true
  const label = String(option.label ?? "")
  if (label.includes(keyword)) return true
  return pinyinMatch.value
    ? pinyinMatch.value(label, keyword, { continuous: true }) !== null
    : false
}
// 空串是「没有我所在的班级」，null 才是没选 —— 往届的班级毕业后会从后台配置里删掉，
// 这一项是他们唯一的入口，写完整用户名登录
const OTHER_CLASS = ""
const classList = computed<SelectOption[]>(() => {
  const configs =
    configStore.config?.classList.map((item) => ({
      label: `${item.slice(0, 2)}计算机${item.slice(2)}班`,
      value: `ks${item}`,
    })) ?? []
  return [...configs, { label: "没有我所在的班级", value: OTHER_CLASS }]
})
// 选了具体班级就是「选姓名」，选了「没有我所在的班级」就是「写用户名」
const isClassLogin = computed(() => Boolean(form.value.class))
const passwordRule: FormItemRule[] = [
  { required: true, message: "密码必填", trigger: "blur" },
  { min: 6, max: 20, message: "长度在 6 到 20 位之间", trigger: "input" },
]
const studentRules = computed<FormRules>(() => ({
  class: [
    {
      validator: () => form.value.class !== null,
      message: "班级必选",
      trigger: ["blur", "change"],
    },
  ],
  username: [
    {
      required: true,
      message: isClassLogin.value ? "姓名必选" : "用户名必填",
      trigger: ["blur", "change"],
    },
  ],
  password: passwordRule,
}))
const adminRules: FormRules = {
  username: [
    { required: true, message: "用户名必填", trigger: ["blur", "change"] },
  ],
  password: passwordRule,
}

function resetForm() {
  form.value.class = null
  form.value.username = null
  form.value.password = ""
  classUserOptions.value = []
  classUserLoading.value = false
  authStore.clearLoginError()
}

function onTabChange(tab: "student" | "admin") {
  resetForm()
  studentRef.value?.restoreValidation()
  adminRef.value?.restoreValidation()
  // 切回学生页签把记住的班级填回去，别因为误点了一下管理员就得重选
  if (tab === "student") restoreLastClass()
}

function submit() {
  const formRef = activeTab.value === "student" ? studentRef : adminRef
  formRef.value!.validate(async (errors?: unknown) => {
    if (errors) return
    try {
      authStore.clearLoginError()
      authStore.setLoginLoading(true)
      const merged = {
        username: form.value.username ?? "",
        password: form.value.password,
      }
      // 选了班级的只填了姓名，ks + 班级号的前缀这里补
      if (activeTab.value === "student" && form.value.class) {
        merged.username = form.value.class + merged.username
      }
      await login(merged)
    } catch (err: any) {
      // 判错误码而不是错误文案：文案在后端，改一个字这里就静默掉进「无法登录」
      if (err.error === "account-disabled") {
        authStore.setLoginError("此账号已被封禁")
      } else if (err.error === "invalid-credentials") {
        authStore.setLoginError("用户名或密码不正确")
      } else {
        authStore.setLoginError("无法登录")
      }
    } finally {
      authStore.setLoginLoading(false)
    }
    if (!msg.value) {
      if (activeTab.value === "student") {
        storage.set(STORAGE_KEY.LOGIN_CLASS, form.value.class)
      }
      authStore.closeLoginModal()
      await userStore.getMyProfile()
      // 登录后弹「上次登录以来」的学情小结。移植时漏掉了这一行，
      // LoginSummaryModal 一直挂在 layout 里但没人触发，整条链路等于死的
      loginSummaryStore.open()
    }
  })
}

function goSignup() {
  authStore.switchToSignup()
}

async function loadClassUsernames(selectedClass: string) {
  classUserLoading.value = true
  try {
    const res = await getClassUsernames(selectedClass)
    classUserOptions.value = res.map((name: string) => ({
      label: name,
      value: name,
    }))
  } catch {
    classUserOptions.value = []
  } finally {
    classUserLoading.value = false
  }
}

watch(
  () => form.value.class,
  (selectedClass) => {
    classUserOptions.value = []
    form.value.username = null
    if (!selectedClass) {
      classUserLoading.value = false
      return
    }
    loadClassUsernames(selectedClass.slice(2))
  },
)

// 选完姓名直接跳到密码框，学生的手不用离开这一列
function onUsernamePicked() {
  nextTick(() => studentPasswordRef.value?.focus())
}

/**
 * 机房电脑一台对一个班，班级记在本地下次自动填上；
 * 姓名不记 —— 同一台机器换个人坐就是别人的名字了。
 */
function restoreLastClass() {
  if (form.value.class !== null) return
  const last = storage.get(STORAGE_KEY.LOGIN_CLASS)
  if (
    typeof last === "string" &&
    classList.value.some((item) => item.value === last)
  ) {
    form.value.class = last
  }
}

watch(classList, restoreLastClass)

// 每次打开都从干净的表单开始，别把上一个人的姓名和密码留在框里
watch(loginModalOpen, (open) => {
  if (!open) return
  ensurePinyin()
  resetForm()
  studentRef.value?.restoreValidation()
  adminRef.value?.restoreValidation()
  restoreLastClass()
})

onMounted(() => {
  authStore.clearLoginError()
  restoreLastClass()
  if (loginModalOpen.value) ensurePinyin()
})
</script>

<template>
  <n-modal
    :mask-closable="false"
    v-model:show="loginModalOpen"
    preset="card"
    title="登录"
    style="width: 420px"
    :auto-focus="false"
  >
    <n-tabs v-model:value="activeTab" @update:value="onTabChange">
      <n-tab-pane name="student" tab="学生登录">
        <n-form
          ref="studentRef"
          :model="form"
          :rules="studentRules"
          show-require-mark
        >
          <n-form-item label="班级" path="class">
            <n-select
              v-model:value="form.class"
              :options="classList"
              filterable
              name="class"
              id="login-class"
              placeholder="选择班级"
            />
          </n-form-item>
          <n-form-item
            :label="isClassLogin ? '姓名' : '用户名'"
            path="username"
          >
            <n-select
              v-if="isClassLogin"
              v-model:value="form.username"
              :options="classUserOptions"
              :loading="classUserLoading"
              filterable
              :filter="filterClassUser"
              name="class-username"
              id="login-class-username"
              placeholder="选择姓名，可打拼音或缩写搜索"
              @update:value="onUsernamePicked"
            />
            <n-input
              v-else
              v-model:value="form.username"
              clearable
              :disabled="form.class === null"
              name="username"
              id="login-username"
              autocomplete="username"
              placeholder="完整用户名，如 ks231张三"
            />
          </n-form-item>
          <n-form-item label="密码" path="password">
            <n-input
              ref="studentPasswordRef"
              v-model:value="form.password"
              clearable
              type="password"
              :name="isClassLogin ? 'class-password' : 'password'"
              :id="isClassLogin ? 'login-class-password' : 'login-password'"
              :autocomplete="isClassLogin ? 'new-password' : 'current-password'"
              @keyup.enter="submit"
            />
          </n-form-item>
          <n-alert v-if="msg" type="error" :show-icon="false">{{
            msg
          }}</n-alert>
          <n-form-item>
            <n-flex style="width: 100%">
              <n-button
                type="primary"
                :loading="isLoading"
                @click="submit"
                :style="{
                  flex: configStore.config?.allowRegister ? '0 0 auto' : '1',
                }"
              >
                登录
              </n-button>
              <n-button
                v-if="configStore.config?.allowRegister"
                @click="goSignup"
              >
                没有账号？立即注册
              </n-button>
            </n-flex>
          </n-form-item>
          <n-alert :show-icon="false" class="tip">
            往届的班级、列表里找不到的班级、以及自己注册的账号，选【没有我所在的班级】，用户名要写完整，比如
            23 计算机 1 班张三写 ks231张三（姓名可以用拼音或拼音缩写快速查找）。
          </n-alert>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="admin" tab="管理员登录">
        <n-form
          ref="adminRef"
          :model="form"
          :rules="adminRules"
          show-require-mark
        >
          <n-form-item label="用户名" path="username">
            <n-input
              v-model:value="form.username"
              clearable
              name="username"
              id="login-admin-username"
              autocomplete="username"
              placeholder="请输入用户名"
            />
          </n-form-item>
          <n-form-item label="密码" path="password">
            <n-input
              v-model:value="form.password"
              clearable
              type="password"
              name="password"
              id="login-admin-password"
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </n-form-item>
          <n-alert v-if="msg" type="error" :show-icon="false">{{
            msg
          }}</n-alert>
          <n-form-item>
            <n-button block type="primary" :loading="isLoading" @click="submit">
              登录
            </n-button>
          </n-form-item>
          <n-alert :show-icon="false" class="tip">
            管理员和老师从这里登录，学生请走【学生登录】页签。
          </n-alert>
        </n-form>
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<style scoped>
.tip {
  margin-top: 4px;
}
</style>
