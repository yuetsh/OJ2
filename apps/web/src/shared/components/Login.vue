<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import RankAvatar from "oj/rank/components/RankAvatar.vue"
import { classLabel, groupClassOptions } from "oj/submission/utils"
import { errorCode } from "utils/api"
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import { getClassUsernames, login } from "../api"
import { useAuthModalStore } from "../store/authModal"
import UserName from "./UserName.vue"
import { useConfigStore } from "../store/config"
import { useUserStore } from "../store/user"

/**
 * 登录框两种样子：
 *
 * - **点名字**（默认）：班级记在这台电脑上，一打开就是这个班的名单，点自己的名字再输密码。
 *   机房一台电脑对一个班，学生一个字都不用打。
 * - **写用户名**：老师、往届（班级已经从后台配置里删掉的）、自己注册的。9 月以来约一成的
 *   登录走这条，所以入口「名单里没有我」「老师登录」一直摆在名单底下。
 *
 * 这台电脑上次用哪种登上的，下次就先开哪种 —— 老师的电脑不用每次都切。
 */
type Mode = "pick" | "user"

const userStore = useUserStore()
const configStore = useConfigStore()
const authStore = useAuthModalStore()
const { loginModalOpen } = storeToRefs(authStore)
const theme = useThemeVars()

// n-modal 把内容传送到 body 底下，CSS 的 v-bind() 挂不上去（变量挂在组件根上，
// 这个组件的根是 n-modal 自己）—— 颜色直接写到弹框根节点的 style 里
const themeVars = computed(() => ({
  "--t-border-color": theme.value.borderColor,
  "--t-box-shadow-3": theme.value.boxShadow3,
  "--t-error-color": theme.value.errorColor,
  "--t-hover-color": theme.value.hoverColor,
  "--t-modal-color": theme.value.modalColor,
  "--t-primary-color": theme.value.primaryColor,
  "--t-primary-color-hover": theme.value.primaryColorHover,
  "--t-text-color-1": theme.value.textColor1,
  "--t-text-color-2": theme.value.textColor2,
  "--t-text-color-3": theme.value.textColor3,
}))

const mode = ref<Mode>("pick")
/** 选中的班，带 ks 前缀（`ks257`），和用户名的前缀同一个写法 */
const klass = ref<string | null>(null)
const names = ref<string[]>([])
const namesLoading = ref(false)
const query = ref("")
const picked = ref<string | null>(null)
const username = ref("")
const password = ref("")
const loading = ref(false)
const error = ref("")
/** 错太多次被锁了：按钮灰掉，换个名字 / 换种登法才放开 */
const locked = ref(false)

const searchRef = useTemplateRef("searchRef")
const passwordRef = useTemplateRef("passwordRef")
const usernameRef = useTemplateRef("usernameRef")

const knownClasses = computed(() => (configStore.config?.classList ?? []).map((c) => `ks${c}`))
const classOptions = computed(() =>
  groupClassOptions(configStore.config?.classList ?? [], (item) => ({
    label: classLabel(item),
    value: `ks${item}`,
  })),
)
/** 还没选过班的电脑：名单的位置先摆一排排班级 */
const classGroups = computed(() =>
  classOptions.value.flatMap((option) =>
    "children" in option ? [{ label: option.label, items: option.children }] : [],
  ),
)

// 名字支持拼音和拼音缩写搜索（张三 ← zhangsan / zs）。pinyin-pro 带着一份几百 K 的
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

function matches(name: string, keyword: string) {
  if (name.includes(keyword)) return true
  return pinyinMatch.value ? pinyinMatch.value(name, keyword, { continuous: true }) !== null : false
}

// 按拼音排：zh 的排序规则在 Chrome 里就是拼音序，不用等 pinyin-pro
const collator = new Intl.Collator("zh-CN")
const shown = computed(() => {
  const keyword = query.value.trim()
  return keyword ? names.value.filter((name) => matches(name, keyword)) : names.value
})

async function loadNames(value: string) {
  namesLoading.value = true
  names.value = []
  try {
    const list = await getClassUsernames(value.slice(2))
    // 切班的请求比上一个先回来时，别让旧班的名单盖上来
    if (klass.value === value) names.value = [...list].sort(collator.compare)
  } catch {
    if (klass.value === value) names.value = []
  } finally {
    if (klass.value === value) namesLoading.value = false
  }
}

watch(klass, (value) => {
  picked.value = null
  query.value = ""
  clearError()
  if (value) {
    loadNames(value)
    focusLater(() => searchRef.value)
  } else names.value = []
})

function clearError() {
  error.value = ""
  locked.value = false
}

/** 要聚焦的框往往下一帧才渲染出来，所以传取值函数，到时候再取 */
function focusLater(target: () => { focus: () => void } | null | undefined) {
  nextTick(() => target()?.focus())
}

function pick(name: string) {
  picked.value = name
  password.value = ""
  clearError()
  focusLater(() => passwordRef.value)
}

function unpick() {
  picked.value = null
  password.value = ""
  clearError()
  focusLater(() => searchRef.value)
}

/** 搜到只剩一个人，回车就是点他 */
function onSearchEnter() {
  if (shown.value.length === 1) pick(shown.value[0]!)
}

function switchMode(next: Mode) {
  mode.value = next
  picked.value = null
  username.value = ""
  password.value = ""
  query.value = ""
  clearError()
  focusLater(() => (next === "user" ? usernameRef.value : searchRef.value))
}

function goSignup() {
  authStore.switchToSignup()
}

async function submit() {
  if (loading.value || locked.value) return
  const name =
    mode.value === "pick" ? `${klass.value ?? ""}${picked.value ?? ""}` : username.value.trim()
  if (mode.value === "user" && !name) {
    error.value = "写上用户名"
    focusLater(() => usernameRef.value)
    return
  }
  if (!password.value) {
    error.value = "写上密码"
    focusLater(() => passwordRef.value)
    return
  }
  loading.value = true
  clearError()
  try {
    await login({ username: name, password: password.value })
  } catch (err) {
    // 判错误码而不是错误文案：文案在后端，改一个字这里就静默掉进「登录不上」
    const code = errorCode(err)
    if (code === "invalid-credentials") {
      // 名字是点出来的，错只会错在密码
      error.value = mode.value === "pick" ? "密码不对，再试一次" : "用户名或密码不对"
    } else if (code === "too-many-login-attempts") {
      error.value = "密码错太多次了，15 分钟后再试"
      locked.value = true
    } else if (code === "account-disabled") {
      error.value = "这个账号停用了，去找老师"
    } else {
      error.value = "登录不上，等一会儿再试"
    }
    password.value = ""
    focusLater(() => passwordRef.value)
    return
  } finally {
    loading.value = false
  }
  storage.set(STORAGE_KEY.LOGIN_MODE, mode.value)
  if (mode.value === "pick") storage.set(STORAGE_KEY.LOGIN_CLASS, klass.value)
  authStore.closeLoginModal()
  // 「上次登录以来」不再弹框，拆进了首页的「上次来」卡（/me/last-visit）
  await userStore.getMyProfile()
}

/**
 * 机房电脑一台对一个班，班级记在本地下次自动填上；
 * 名字不记 —— 同一台机器换个人坐就是别人的名字了。
 */
function restoreLast() {
  const lastMode = storage.get(STORAGE_KEY.LOGIN_MODE)
  mode.value = lastMode === "user" ? "user" : "pick"
  const last = storage.get(STORAGE_KEY.LOGIN_CLASS)
  if (typeof last === "string" && knownClasses.value.includes(last)) {
    if (klass.value === last) {
      // 同一个班：名单留着，只把上一个人的痕迹清掉
      picked.value = null
      query.value = ""
    } else klass.value = last
  }
}

// 配置是异步到的，登录框可能先开了
watch(knownClasses, () => {
  if (klass.value === null) restoreLast()
})

// 每次打开都从干净的表单开始，别把上一个人的名字和密码留在框里
watch(
  loginModalOpen,
  (open) => {
    if (!open) return
    ensurePinyin()
    picked.value = null
    username.value = ""
    password.value = ""
    query.value = ""
    clearError()
    restoreLast()
    focusLater(() => (mode.value === "user" ? usernameRef.value : searchRef.value))
  },
  { immediate: true },
)
</script>

<template>
  <n-modal v-model:show="loginModalOpen" :mask-closable="false" :auto-focus="false">
    <div class="box" :style="themeVars" :class="mode" role="dialog" aria-label="登录">
      <div class="head">
        <h2>登录</h2>
        <n-select
          v-if="mode === 'pick'"
          v-model:value="klass"
          class="klass"
          :options="classOptions"
          filterable
          placeholder="选班级"
          :consistent-menu-width="false"
        />
        <span class="grow"></span>
        <button class="close" type="button" aria-label="关闭" @click="authStore.closeLoginModal()">
          <Icon icon="ph:x" :width="18" />
        </button>
      </div>

      <template v-if="mode === 'pick'">
        <!-- 点了名字：名单换成这个人，光标直接在密码框 -->
        <div v-if="picked" class="me">
          <RankAvatar :username="`${klass}${picked}`" :avatar="null" :size="64" />
          <div class="me-name"><UserName :username="`${klass}${picked}`" /></div>
          <div class="field narrow">
            <n-input
              ref="passwordRef"
              v-model:value="password"
              type="password"
              show-password-on="click"
              size="large"
              placeholder="密码"
              :input-props="{ name: 'class-password', autocomplete: 'new-password' }"
              :status="error ? 'error' : undefined"
              @update:value="locked = false"
              @keyup.enter="submit"
            />
            <div v-if="error" class="err">{{ error }}</div>
          </div>
          <n-button
            class="narrow"
            type="primary"
            size="large"
            :loading="loading"
            :disabled="locked"
            @click="submit"
          >
            登录
          </n-button>
          <button class="link back" type="button" @click="unpick">
            <Icon icon="ph:caret-left-bold" :width="14" />不是我，换一个名字
          </button>
        </div>

        <template v-else-if="klass">
          <n-input
            ref="searchRef"
            v-model:value="query"
            class="search"
            clearable
            placeholder="打名字或拼音缩写"
            :input-props="{ autocomplete: 'off' }"
            @keyup.enter="onSearchEnter"
          >
            <template #prefix><Icon icon="ph:magnifying-glass" :width="16" /></template>
          </n-input>
          <div class="scroll">
            <div v-if="namesLoading" class="empty"><n-spin size="small" /></div>
            <div v-else-if="!names.length" class="empty">这个班还没有名单</div>
            <div v-else-if="!shown.length" class="empty">没有叫这个的</div>
            <div v-else class="grid">
              <button
                v-for="name in shown"
                :key="name"
                class="cell"
                type="button"
                @click="pick(name)"
              >
                {{ name }}
              </button>
            </div>
          </div>
        </template>

        <!-- 这台电脑还没登过：先选班 -->
        <div v-else class="scroll classes">
          <div v-for="group in classGroups" :key="group.label" class="grade">
            <span class="grade-label">{{ group.label }}</span>
            <div class="grid">
              <button
                v-for="item in group.items"
                :key="item.value"
                class="cell"
                type="button"
                @click="klass = item.value"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="links">
          <button class="link" type="button" @click="switchMode('user')">名单里没有我</button>
          <i></i>
          <button class="link" type="button" @click="switchMode('user')">老师登录</button>
          <template v-if="configStore.config?.allowRegister">
            <i></i>
            <button class="link" type="button" @click="goSignup">注册</button>
          </template>
        </div>
      </template>

      <!-- 写用户名：老师、往届、自己注册的 -->
      <div v-else class="form">
        <label class="field">
          <span class="lab">用户名</span>
          <n-input
            ref="usernameRef"
            v-model:value="username"
            size="large"
            clearable
            placeholder="完整用户名，如 ks231张三"
            :input-props="{ name: 'username', autocomplete: 'username' }"
            @keyup.enter="passwordRef?.focus()"
          />
        </label>
        <label class="field">
          <span class="lab">密码</span>
          <n-input
            ref="passwordRef"
            v-model:value="password"
            type="password"
            show-password-on="click"
            size="large"
            placeholder="密码"
            :input-props="{ name: 'password', autocomplete: 'current-password' }"
            :status="error ? 'error' : undefined"
            @update:value="locked = false"
            @keyup.enter="submit"
          />
          <span v-if="error" class="err">{{ error }}</span>
        </label>
        <n-button type="primary" size="large" :loading="loading" :disabled="locked" @click="submit">
          登录
        </n-button>
        <div class="links">
          <button class="link back" type="button" @click="switchMode('pick')">
            <Icon icon="ph:caret-left-bold" :width="14" />按班级选名字
          </button>
          <template v-if="configStore.config?.allowRegister">
            <i></i>
            <button class="link" type="button" @click="goSignup">注册</button>
          </template>
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
  max-height: calc(100vh - 32px);
  padding: 24px 28px;
  border-radius: var(--oj-radius);
  background: var(--t-modal-color);
  color: var(--t-text-color-1);
  box-shadow: var(--t-box-shadow-3);
}

.box.pick {
  width: min(800px, calc(100vw - 32px));
}

.box.user {
  width: min(420px, calc(100vw - 32px));
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.head h2 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
}

.klass {
  width: 170px;
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

.search {
  margin-top: 18px;
  flex-shrink: 0;
}

.scroll {
  margin-top: 14px;
  min-height: 0;
  overflow-y: auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.cell {
  height: 40px;
  padding: 0 6px;
  border: 1px solid var(--t-border-color);
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: var(--oj-fs-body);
  color: var(--t-text-color-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.cell:hover,
.cell:focus-visible {
  border-color: var(--t-primary-color);
  color: var(--t-primary-color);
  outline: none;
}

.classes {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 20px;
}

.classes .grid {
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
}

.grade {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grade-label {
  font-size: var(--oj-fs-sec);
  color: var(--t-text-color-3);
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  color: var(--t-text-color-3);
}

.me {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 36px 0 30px;
}

.me-name {
  font-size: 22px;
}

.narrow {
  width: min(300px, 100%);
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

.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 20px;
}

.links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
  flex-shrink: 0;
}

.form .links {
  margin-top: 0;
}

.links i {
  width: 1px;
  height: 12px;
  background: var(--t-border-color);
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

/* 手机：铺满一屏，名单往下滑，底下两条入口一直在 */
@media (max-width: 640px) {
  .box.pick,
  .box.user {
    width: 100vw;
    height: 100vh;
    max-height: none;
    border-radius: 0;
    padding: 12px 16px 16px;
  }

  .klass {
    width: 150px;
  }

  .scroll {
    flex: 1;
  }
}
</style>
