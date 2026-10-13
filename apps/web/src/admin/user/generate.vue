<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { classLabel } from "oj/submission/utils"
import UserName from "shared/components/UserName.vue"
import { errorMessage } from "utils/api"
import {
  CLASS_NAME_MAX_DIGITS,
  CLASS_NAME_MAX_VALUE,
  CLASS_NAME_MIN_DIGITS,
  CLASS_NAME_MIN_VALUE,
} from "utils/constants"
import { parseTime } from "utils/functions"
import { checkUsernames, importUsers } from "../api"

/**
 * 批量建号（设计稿「后台用户与批量建号」UsGen / UsGenIssue / UsDone）。
 *
 * 一年就开学那几天用（2026-09 七批共 440 个），所以要的是「粘进去就看到会建成什么」：
 * 右边当场列出用户名和密码，同批重名、已经有的账号在建之前就点出来哪一行、怎么改。
 * 建好之后给「下载名单」和「打印账号条」（一人一张，剪开发下去），原来是一点就自动下载
 * 一个 CSV，Excel 打开中文还是乱码。新班级后端会顺手加进班级列表。
 */
const message = useMessage()

const classNo = ref("")
const rawInput = ref("")

const classError = computed(() => {
  const value = classNo.value.trim()
  if (!value) return ""
  const n = Number(value)
  if (!/^\d+$/.test(value) || n < CLASS_NAME_MIN_VALUE || n > CLASS_NAME_MAX_VALUE) {
    return `班级号要是 ${CLASS_NAME_MIN_DIGITS}~${CLASS_NAME_MAX_DIGITS} 位数字`
  }
  return ""
})
const prefix = computed(() => (classNo.value.trim() ? `ks${classNo.value.trim()}` : ""))

/** 名单：一行一个，前后和中间的空格都去掉（从表格里复制常带空格），空行不算 */
const names = computed(() =>
  rawInput.value
    .split("\n")
    .map((line) => line.replace(/\s+/g, ""))
    .filter(Boolean),
)

// 每个名字的密码记住，边改名单边看时不会每敲一个字全换一遍
const passwords = new Map<string, string>()
function passwordOf(name: string) {
  let value = passwords.get(name)
  if (!value) {
    value = ""
    for (let j = 0; j < 6; j++) value += "123456789".charAt(Math.floor(Math.random() * 9))
    passwords.set(name, value)
  }
  return value
}

const rows = computed(() =>
  names.value.map((name) => ({
    name,
    username: prefix.value + name,
    password: passwordOf(prefix.value + name),
  })),
)

/** 同批重名：「第 4 行和第 2 行重名」 */
const duplicates = computed(() => {
  const first = new Map<string, number>()
  const result: { line: number; firstLine: number; name: string }[] = []
  rows.value.forEach((row, i) => {
    const key = row.username.toLowerCase()
    const seen = first.get(key)
    if (seen === undefined) first.set(key, i + 1)
    else result.push({ line: i + 1, firstLine: seen, name: row.name })
  })
  return result
})

// 已经有的账号：停手半秒再去查
const existing = ref<{ username: string; createTime: string | null }[]>([])
const checking = ref(false)
watchDebounced(
  () => rows.value.map((row) => row.username).join("\n"),
  async () => {
    const usernames = [...new Set(rows.value.map((row) => row.username))]
    if (!usernames.length || classError.value || usernames.length > 500) {
      existing.value = []
      return
    }
    checking.value = true
    try {
      existing.value = (await checkUsernames(usernames)).existing
    } catch {
      existing.value = []
    } finally {
      checking.value = false
    }
  },
  { debounce: 500, immediate: true },
)

const tooMany = computed(() => rows.value.length > 500)
const issueCount = computed(
  () =>
    (classError.value ? 1 : 0) +
    duplicates.value.length +
    existing.value.length +
    (tooMany.value ? 1 : 0),
)
const canSubmit = computed(
  () => rows.value.length > 0 && !issueCount.value && !checking.value && !!prefix.value,
)

// ---------------------------------------------------------------- 建号

const saving = ref(false)
const done = ref<{ username: string; password: string }[] | null>(null)
const addedClasses = ref<string[]>([])

async function submit() {
  if (!canSubmit.value) return
  // 占位邮箱必须全站唯一：注册、编辑用户、导入三条路都查重。每批一段随机后缀错开，
  // 同一个班分两批导也不会撞。这个地址不发给任何人，纯占位
  const batch = Math.random().toString(36).slice(2, 8)
  const payload = rows.value.map((row, i) => [
    row.username,
    row.password,
    `${prefix.value || "user"}.${batch}.${i + 1}@example.com`,
    row.name,
  ])
  saving.value = true
  try {
    const res = await importUsers(payload)
    addedClasses.value = res.addedClasses ?? []
    done.value = rows.value.map(({ username, password }) => ({ username, password }))
  } catch (err) {
    message.error("没建成：" + errorMessage(err))
  } finally {
    saving.value = false
  }
}

function again() {
  done.value = null
  rawInput.value = ""
  addedClasses.value = []
  passwords.clear()
}

/** 下载名单：用户名、密码两列。开头带 BOM，Excel 打开中文才不乱码 */
function download() {
  if (!done.value) return
  const csv = "﻿用户名,密码\n" + done.value.map((it) => `${it.username},${it.password}`).join("\n")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  link.download = `${prefix.value || "账号"}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

/** 打印账号条：一人一张，一页四列，打出来剪开发下去 */
function printSlips() {
  if (!done.value) return
  const escape = (text: string) =>
    text.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
    )
  const slips = done.value
    .map(
      (it) =>
        `<div class="slip"><div class="u">${escape(it.username)}</div><div class="p">密码 ${escape(it.password)}</div></div>`,
    )
    .join("")
  const win = window.open("", "_blank")
  if (!win) {
    message.warning("浏览器拦住了新窗口，允许弹出窗口后再点一次")
    return
  }
  win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(
    classLabel(classNo.value.trim()) || "账号条",
  )}</title><style>
body{margin:12mm;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
.slip{border:1px dashed #999;padding:10px 12px;break-inside:avoid}
.u{font-size:16px;font-weight:600}.p{font-family:Consolas,monospace;font-size:16px;margin-top:4px}
</style></head><body><div class="grid">${slips}</div></body></html>`)
  win.document.close()
  win.focus()
  win.print()
}
</script>

<template>
  <PageHeader title="批量建号" :back="{ name: 'admin user list' }" />

  <!-- 建好了 -->
  <div v-if="done" class="done">
    <div class="done-bar">
      <b>建好了 {{ done.length }} 个账号</b>
      <n-text v-if="addedClasses.length" depth="3">
        {{ addedClasses.map((name) => classLabel(name)).join("、") }}已加进班级列表
      </n-text>
      <div class="spacer"></div>
      <n-button @click="download">下载名单（表格）</n-button>
      <n-button type="primary" @click="printSlips">打印账号条</n-button>
      <n-button @click="again">再建一批</n-button>
    </div>
    <div class="slips">
      <div v-for="it in done" :key="it.username" class="slip">
        <UserName :username="it.username" />
        <div class="mono">密码 {{ it.password }}</div>
      </div>
    </div>
  </div>

  <div v-else class="layout">
    <div class="left">
      <label class="label" for="class-no">班级号</label>
      <div class="class-row">
        <span class="ks">ks</span>
        <n-input
          v-model:value="classNo"
          :input-props="{ id: 'class-no', inputmode: 'numeric' }"
          placeholder="如 2612"
          style="width: 120px"
        />
        <span v-if="classNo.trim() && !classError" class="class-name">
          {{ classLabel(classNo.trim()) }}
        </span>
      </div>
      <label class="label" for="names">
        名单 <n-text depth="3" class="hint">从表格里整列复制过来，一行一个</n-text>
      </label>
      <n-input
        v-model:value="rawInput"
        type="textarea"
        :input-props="{ id: 'names' }"
        :rows="20"
        placeholder="一行一个名字"
      />
    </div>

    <div class="right">
      <template v-if="rows.length">
        <div class="head">
          <b>会建这 {{ rows.length }} 个账号</b>
          <n-tag v-if="!issueCount && !checking && prefix" type="success" :bordered="false" round>
            没有重名
          </n-tag>
          <n-tag v-if="issueCount" type="warning" :bordered="false" round>
            有 {{ issueCount }} 处要先改
          </n-tag>
        </div>

        <div v-if="issueCount" class="issues">
          <div v-if="classError">{{ classError }}</div>
          <div v-if="tooMany">一次最多 500 个，分两批建</div>
          <div v-for="dup in duplicates" :key="dup.line">
            第 {{ dup.line }} 行「{{ dup.name }}」和第 {{ dup.firstLine }} 行重名 ——
            同班同名的，名字后面加个 1、2 区分
          </div>
          <div v-for="it in existing" :key="it.username">
            {{ it.username }} 已经有这个账号了<template v-if="it.createTime"
              >（{{ parseTime(it.createTime, "YYYY-MM-DD") }} 建的）</template
            >
            —— 删掉这一行，或者换个名字
          </div>
        </div>

        <div class="preview">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>用户名</th>
                <th>密码</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in rows" :key="i">
                <td class="n">{{ i + 1 }}</td>
                <td><UserName :username="row.username" /></td>
                <td class="mono">{{ row.password }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <n-button
            type="primary"
            size="large"
            :disabled="!canSubmit"
            :loading="saving || checking"
            @click="submit"
          >
            建好这 {{ rows.length }} 个账号
          </n-button>
          <n-text v-if="!prefix" depth="3" class="hint" style="margin-left: 12px">
            先填班级号
          </n-text>
        </div>
      </template>
      <n-empty v-else description="左边粘进名单，这里就列出会建成的账号" style="margin-top: 80px" />
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.left {
  width: 330px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.label {
  font-size: 14px;
  font-weight: 600;
}

.hint {
  font-size: 13px;
  font-weight: 400;
}

.class-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ks {
  font-size: 18px;
  opacity: 0.6;
}

.class-name {
  font-size: 15px;
}

.right {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(240, 160, 32, 0.45);
  background: rgba(240, 160, 32, 0.08);
  font-size: 14px;
}

.preview {
  max-height: 520px;
  overflow: auto;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 8px;
  padding: 4px 12px;
}

.preview table {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
}

.preview th {
  font-weight: 400;
  font-size: 13px;
  opacity: 0.6;
  text-align: left;
  padding: 8px;
}

.preview td {
  height: 38px;
  padding: 0 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  white-space: nowrap;
}

.preview .n {
  width: 32px;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: Consolas, Monaco, monospace;
  font-variant-numeric: tabular-nums;
}

.done {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.done-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid rgba(24, 160, 88, 0.35);
  background: rgba(24, 160, 88, 0.06);
  white-space: nowrap;
}

.done-bar b {
  font-size: 16px;
}

.spacer {
  flex: 1 1 auto;
}

.slips {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.slip {
  border: 1px dashed rgba(128, 128, 128, 0.5);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 14px;
  line-height: 22px;
}
</style>
