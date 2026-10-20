<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { useThemeVars } from "naive-ui"
import { classLabel } from "utils/classes"
import { errorMessage } from "utils/api"
import { CLASS_NAME_MAX_DIGITS, CLASS_NAME_MIN_DIGITS, CLASS_NAME_RE } from "utils/constants"
import { copyToClipboard, parseTime } from "utils/functions"
import type { OrphanImage, OrphanTestCase, Server, WebsiteConfig } from "utils/types"
import { useConfigStore } from "shared/store/config"
import {
  deleteJudgeServer,
  editWebsite,
  getJudgeServer,
  getWebsite,
  listInvalidTestcases,
  listOrphanImages,
  pruneInvalidTestcases,
  pruneOrphanImages,
} from "../api"

/**
 * 后台设置（设计稿「后台首页」页的 ConfAdmin）：网站 / 班级 / 开关 / 判题机，有无效测试用例时
 * 再多一块。**改了就存**（用户要的实时保存）：开关一拨、班级一加一删立刻存，网站名停手半秒再存，
 * 右上角写「已保存」。
 *
 * 2026-10-13 用户定的：网址、简称、页脚三项删了（前后端从来没读过），AI 小助手连同挂件一起删了；
 * 注册、「学生能看到所有人的提交」两个开关留着。班级不再拖动排序 —— 全站的班级下拉早就按年级
 * 自动分组排序了，拖出来的顺序没有地方用上
 */
const message = useMessage()
const theme = useThemeVars()
const configStore = useConfigStore()

const websiteConfig = reactive<WebsiteConfig>({
  websiteName: "判题狗",
  allowRegister: false,
  submissionListShowAll: true,
  classList: [],
})

/**
 * 上一次存进去（或刚读回来）的内容。和它一样就不存 —— 读回配置本身也是一次改动，
 * 只看「读完没有」的话，那次改动的延迟保存会在读完之后照样发出去
 */
let savedSnapshot = ""
const saveState = ref<"idle" | "saving" | "saved" | "failed">("idle")

async function getWebsiteConfig() {
  const res = await getWebsite()
  websiteConfig.websiteName = res.websiteName
  websiteConfig.allowRegister = res.allowRegister
  websiteConfig.submissionListShowAll = res.submissionListShowAll
  websiteConfig.classList = res.classList
  savedSnapshot = JSON.stringify(websiteConfig)
}

// 改了就存。网站名打字时一个字一存没意义，停手半秒再存；开关、班级本来就是一下一下的
watchDebounced(
  () => JSON.stringify(websiteConfig),
  (now) => {
    if (savedSnapshot && now !== savedSnapshot) saveWebsiteConfig()
  },
  { debounce: 500 },
)

async function saveWebsiteConfig() {
  if (!websiteConfig.websiteName.trim()) {
    saveState.value = "failed"
    message.error("网站名不能空着")
    return
  }
  // 班级号要和用户名里 ks 后面那段对得上，位数不对登录页会查不到该班学生。后端也会拦
  const invalid = websiteConfig.classList.filter((c) => !CLASS_NAME_RE.test(c))
  if (invalid.length) {
    message.error(
      `班级号 ${invalid.join("、")} 必须是 ${CLASS_NAME_MIN_DIGITS}~${CLASS_NAME_MAX_DIGITS} 位数字`,
    )
    return
  }
  saveState.value = "saving"
  const snapshot = JSON.stringify(websiteConfig)
  try {
    await editWebsite(websiteConfig)
    savedSnapshot = snapshot
  } catch (err) {
    saveState.value = "failed"
    message.error("没保存上：" + errorMessage(err))
    return
  }
  saveState.value = "saved"
  // 广播由后端在 POST /admin/website 里做，开着页面的人不用刷新
  configStore.getConfig()
}

// ---------------------------------------------------------------- 班级

/** 按年级分组，新年级在上，组里按班号排（和全站班级下拉一样） */
const classGroups = computed(() => {
  const groups = new Map<string, string[]>()
  for (const name of websiteConfig.classList) {
    const grade = /^\d{3,}$/.test(name) ? name.slice(0, 2) : "其他"
    groups.set(grade, [...(groups.get(grade) ?? []), name])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([grade, list]) => ({
      grade,
      list: [...list].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })),
    }))
})

const newClass = ref("")
function addClass() {
  const value = newClass.value.trim()
  if (!value) return
  if (!CLASS_NAME_RE.test(value)) {
    message.error(`班级号要是 ${CLASS_NAME_MIN_DIGITS}~${CLASS_NAME_MAX_DIGITS} 位数字，如 2613`)
    return
  }
  if (websiteConfig.classList.includes(value)) {
    message.info(`${classLabel(value)} 已经在里面了`)
    return
  }
  websiteConfig.classList = [...websiteConfig.classList, value]
  newClass.value = ""
}

function removeClass(name: string) {
  websiteConfig.classList = websiteConfig.classList.filter((c) => c !== name)
}

// ---------------------------------------------------------------- 判题机

const token = ref("")
const tokenShown = ref(false)
const servers = ref<Server[]>([])
const abnormalServers = computed(() => servers.value.filter((item) => item.status === "abnormal"))

async function getJudgeServerData() {
  const res = await getJudgeServer()
  token.value = res.token
  servers.value = res.servers
}

/** 上一次心跳：一分钟内写「刚刚还在」，否则「N 分钟 / 小时 / 天没动静了」 */
function heartbeatText(server: Server) {
  const seconds = Math.max(0, (Date.now() - Date.parse(server.lastHeartbeat)) / 1000)
  if (seconds < 60) return "刚刚还在"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟没动静了`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时没动静了`
  return `${Math.floor(seconds / 86400)} 天没动静了`
}

async function delJudgeServer(hostname: string) {
  await deleteJudgeServer(hostname)
  message.success("删掉了")
  getJudgeServerData()
}

async function deleteAbnormalServers() {
  await Promise.all(abnormalServers.value.map((item) => deleteJudgeServer(item.hostname)))
  message.success("删掉了")
  getJudgeServerData()
}

async function copyToken() {
  if (await copyToClipboard(token.value)) message.success("复制好了")
}

// ---------------------------------------------------------------- 无效的测试用例

const testcases = ref<OrphanTestCase[]>([])

async function getTestcases() {
  testcases.value = await listInvalidTestcases()
}

async function deleteTestcase(id?: string) {
  await pruneInvalidTestcases(id)
  message.success("删掉了")
  getTestcases()
}

// ---------------------------------------------------------------- 没人用的图片

/**
 * 要扫遍整个库（包括十几万条提交），所以不在进页面时自动查，点了才查。
 * null = 还没查过
 */
const orphanImages = ref<OrphanImage[] | null>(null)
const scanningImages = ref(false)

const IMAGE_GROUPS = [
  { folder: "upload", label: "编辑器里删掉的图" },
  { folder: "avatar", label: "换下来的头像" },
] as const

const imageGroups = computed(() =>
  IMAGE_GROUPS.map((group) => {
    const images = (orphanImages.value ?? []).filter((image) => image.folder === group.folder)
    const bytes = images.reduce((sum, image) => sum + image.size, 0)
    return { ...group, images, bytes }
  }).filter((group) => group.images.length),
)

async function scanImages() {
  scanningImages.value = true
  try {
    orphanImages.value = await listOrphanImages()
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    scanningImages.value = false
  }
}

async function deleteImages(target: Parameters<typeof pruneOrphanImages>[0]) {
  try {
    const { deleted } = await pruneOrphanImages(target)
    message.success(`删掉了 ${deleted} 张`)
  } catch (error) {
    message.error(errorMessage(error))
  }
  scanImages()
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

onMounted(() => {
  getWebsiteConfig()
  getTestcases()
  getJudgeServerData()
})
</script>

<template>
  <PageHeader title="设置">
    <template #actions>
      <n-text v-if="saveState === 'saving'" depth="3">正在保存…</n-text>
      <n-text v-else-if="saveState === 'saved'" type="success">已保存</n-text>
      <n-text v-else-if="saveState === 'failed'" type="error">没保存上</n-text>
    </template>
  </PageHeader>

  <section class="block">
    <h3>网站</h3>
    <div class="field">
      <label for="site-name" class="field-label">网站名</label>
      <n-input
        v-model:value="websiteConfig.websiteName"
        :input-props="{ id: 'site-name' }"
        style="width: 240px"
      />
      <n-text depth="3" class="hint">顶栏左上角和浏览器标签页上显示的名字</n-text>
    </div>
  </section>

  <section class="block">
    <h3>
      班级 <span class="count">{{ websiteConfig.classList.length }} 个</span>
    </h3>
    <div v-for="group in classGroups" :key="group.grade" class="grade listed">
      <span class="grade-label">{{ group.grade === "其他" ? "其他" : `${group.grade} 级` }}</span>
      <div class="chips">
        <n-tag
          v-for="name in group.list"
          :key="name"
          closable
          :bordered="false"
          @close="removeClass(name)"
        >
          {{ classLabel(name) }}
        </n-tag>
      </div>
    </div>
    <div class="grade">
      <span class="grade-label"></span>
      <n-input
        v-model:value="newClass"
        placeholder="加一个班，如 2613"
        style="width: 180px"
        @keyup.enter="addClass"
      />
      <n-button @click="addClass">加</n-button>
      <n-text depth="3" class="hint">批量建号时新班级会自动加进来，这里主要是删掉毕业的班</n-text>
    </div>
  </section>

  <section class="block">
    <h3>开关</h3>
    <label class="toggle">
      <n-switch v-model:value="websiteConfig.allowRegister" />
      学生可以自己注册账号
    </label>
    <label class="toggle">
      <n-switch v-model:value="websiteConfig.submissionListShowAll" />
      学生能看到所有人的提交
    </label>
  </section>

  <section class="block">
    <h3>
      判题机
      <n-button
        v-if="abnormalServers.length > 1"
        size="small"
        style="margin-left: 8px"
        @click="deleteAbnormalServers"
      >
        把断了的都删掉
      </n-button>
    </h3>
    <n-empty v-if="!servers.length" description="一台都没有连上" />
    <div v-for="server in servers" :key="server.hostname" class="server">
      <span class="dot" :class="server.status === 'normal' ? 'ok' : 'bad'"></span>
      <b>{{ server.hostname }}</b>
      <span class="muted">
        {{ server.cpuCore }} 核 · CPU {{ server.cpuUsage }}% · 内存 {{ server.memoryUsage }}% · 版本
        {{ server.judgerVersion }}
      </span>
      <span
        :class="server.status === 'normal' ? 'ok-text' : 'bad-text'"
        :title="parseTime(server.lastHeartbeat, 'YYYY-MM-DD HH:mm:ss')"
      >
        {{ heartbeatText(server) }}
      </span>
      <n-button
        v-if="server.status !== 'normal'"
        size="small"
        @click="delJudgeServer(server.hostname)"
      >
        删掉
      </n-button>
    </div>
    <div class="server token">
      <span class="muted">接口凭证</span>
      <span class="mono">{{ tokenShown ? token : "••••••••••••" }}</span>
      <n-button size="small" @click="tokenShown = !tokenShown">
        {{ tokenShown ? "藏起来" : "显示" }}
      </n-button>
      <n-button size="small" @click="copyToken">复制</n-button>
    </div>
  </section>

  <section class="block">
    <h3>
      没人用的图片
      <n-button size="small" style="margin-left: 8px" :loading="scanningImages" @click="scanImages">
        {{ orphanImages ? "再查一遍" : "查一下" }}
      </n-button>
    </h3>
    <n-text v-if="orphanImages && !imageGroups.length" depth="3" class="hint">
      都有地方在用
    </n-text>
    <div v-for="group in imageGroups" :key="group.folder" class="image-group">
      <div class="image-group-head">
        {{ group.label }}
        <span class="count">{{ group.images.length }} 张 · {{ formatBytes(group.bytes) }}</span>
        <n-popconfirm @positive-click="deleteImages({ folder: group.folder })">
          <template #trigger>
            <n-button size="small" style="margin-left: 8px">都删掉</n-button>
          </template>
          删掉这 {{ group.images.length }} 张，删了找不回来，确定吗？
        </n-popconfirm>
      </div>
      <div class="thumbs">
        <div v-for="image in group.images" :key="image.name" class="thumb">
          <a
            :href="image.url"
            target="_blank"
            :title="`${image.name} · ${parseTime(new Date(image.createTime * 1000), 'YYYY-MM-DD')}`"
          >
            <img :src="image.url" alt="" loading="lazy" />
          </a>
          <button
            type="button"
            class="thumb-delete"
            title="删掉"
            @click="deleteImages({ folder: image.folder, name: image.name })"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  </section>

  <section v-if="testcases.length" class="block">
    <h3>
      没有题目用的测试数据 <span class="count">{{ testcases.length }} 份</span>
      <n-button size="small" style="margin-left: 8px" @click="deleteTestcase()">都删掉</n-button>
    </h3>
    <n-text depth="3" class="hint">删题时测试数据留在了磁盘上（故意的，删错了还能捞回来）</n-text>
    <div class="chips">
      <n-tag
        v-for="item in testcases"
        :key="item.id"
        closable
        :bordered="false"
        @close="deleteTestcase(item.id)"
      >
        {{ item.id }}
      </n-tag>
    </div>
  </section>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid v-bind("theme.dividerColor");
}

h3 {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 16px;
}

.count {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.field,
.grade,
.server {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
}

.field-label {
  width: 60px;
  font-size: 14px;
  color: v-bind("theme.textColor3");
}

.hint {
  font-size: 13px;
}

.grade-label {
  width: 50px;
  flex: none;
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.image-group-head {
  display: flex;
  align-items: center;
  font-size: 14px;
}

.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid v-bind("theme.dividerColor");
  background: v-bind("theme.actionColor");
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-delete {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  cursor: pointer;
}

.server {
  font-size: 14px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot.ok {
  background: v-bind("theme.successColor");
}

.dot.bad {
  background: v-bind("theme.errorColor");
}

.ok-text {
  color: v-bind("theme.successColor");
}

.bad-text {
  color: v-bind("theme.errorColor");
}

.muted {
  color: v-bind("theme.textColor3");
}

.token {
  margin-top: 4px;
}

.mono {
  font-family: Consolas, Monaco, monospace;
}

/* 手机：班多的年级整排折到年级名下面去了，和班少的年级对不齐；班级在年级名右边自己折行 */
@media (max-width: 768px) {
  .grade.listed {
    flex-wrap: nowrap;
    align-items: flex-start;
  }

  .grade.listed .grade-label {
    line-height: 28px;
  }

  .grade .chips {
    flex: 1 1 auto;
    min-width: 0;
  }
}
</style>
