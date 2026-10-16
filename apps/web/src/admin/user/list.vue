<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { errorMessage } from "utils/api"
import { DataTableRowKey, SelectOption, useThemeVars } from "naive-ui"
import Pagination from "shared/components/Pagination.vue"
import { usePagination } from "shared/composables/pagination"
import { parseTime } from "utils/functions"
import type { AdminUserForm } from "utils/types"
import { deleteUsers, editUser, getUserList, importUsers, resetPassword } from "../api"
import Actions from "./components/Actions.vue"
import UserNameCell from "./components/UserNameCell.vue"
import PasswordCell from "./components/PasswordCell.vue"
import { PROBLEM_PERMISSION, USER_TYPE } from "utils/constants"
import { useRouteQuery } from "@vueuse/router"
import { NO_CLASS } from "@oj2/contract"
import { classLabel, groupClassOptions } from "oj/submission/utils"
import { useConfigStore } from "shared/store/config"
import { useBreakpoints } from "shared/composables/breakpoints"

/**
 * 后台用户列表（设计稿「后台用户与批量建号」UsList）。老师进来多半是三件事：学生忘了密码、
 * 看一个班的名单、开学建号。所以加了班级筛选，一行只摆 用户名 / 班级 / 密码 / 上次登录 / 建号，
 * 「重置密码」常驻、其余收进 ⋯。ID、真名（名字就在用户名里）、占位邮箱不再单列，搜索照样搜得到
 */
const message = useMessage()
const theme = useThemeVars()
const configStore = useConfigStore()
const { isMobile } = useBreakpoints()

interface UserQuery {
  keyword: string
  type: string
  orderBy: string
  className: string
}

// 使用分页 composable
const { query, clearQuery } = usePagination<UserQuery>({
  keyword: useRouteQuery("keyword", "").value,
  type: useRouteQuery("type", "").value,
  orderBy: useRouteQuery("orderBy", "").value,
  className: useRouteQuery("className", "").value,
})

const classOptions = computed(() => [
  { label: "全部班级", value: "" },
  ...groupClassOptions(configStore.config?.classList ?? []),
  { label: classLabel(NO_CLASS), value: NO_CLASS },
])
const neverLoggedIn = ref(0)

const total = ref(0)
const users = ref<AdminUserForm[]>([])
const userEditing = ref<AdminUserForm | null>(null)

const adminOptions = [
  { label: "全部角色", value: "" },
  { label: "学生", value: USER_TYPE.REGULAR_USER },
  { label: "学生管理员", value: USER_TYPE.STUDENT_ADMIN },
  { label: "教师管理员", value: USER_TYPE.TEACHER_ADMIN },
  { label: "超级管理员", value: USER_TYPE.SUPER_ADMIN },
]

const sortOptions = [
  { label: "最近建号", value: "" },
  { label: "按用户名", value: "username" },
  { label: "最近登录", value: "-last_login" },
  { label: "在线优先", value: "-online" },
]
const [create, toggleCreate] = useToggle(false)
const password = ref("")
// 已经点开的管理员密码，按 user id 记。同一个按钮再点一下收回去；listUsers() 里清空，
// 所以翻页/搜索/换筛选之后也一律回到打码状态 —— 不做定时自动隐藏，也不记进 localStorage。
const revealedPasswords = ref(new Set<number>())
const userIDs = ref<DataTableRowKey[]>([])

const rowKey = (row: AdminUserForm) => row.id

/** 上次登录：今天的写「今天 13:02」，在线的前面一个绿点；今年的写到月日；从没登录的写出来 */
function lastLoginText(row: AdminUserForm) {
  if (!row.lastLogin) return h("span", { class: "muted" }, "从没登录")
  const day = parseTime(row.lastLogin, "YYYY-MM-DD")
  const today = parseTime(new Date().toISOString(), "YYYY-MM-DD")
  const text =
    day === today
      ? `今天 ${parseTime(row.lastLogin, "HH:mm")}`
      : day.slice(0, 4) === today.slice(0, 4)
        ? parseTime(row.lastLogin, "MM-DD HH:mm")
        : day
  return h("span", { class: "num", title: parseTime(row.lastLogin, "YYYY-MM-DD HH:mm:ss") }, [
    row.isOnline ? h("span", { class: "online", title: "在线" }) : null,
    text,
  ])
}

function renderPassword(row: AdminUserForm) {
  return h(PasswordCell, {
    user: row,
    revealed: revealedPasswords.value.has(row.id),
    onToggle: (id: number) => {
      if (!revealedPasswords.value.delete(id)) revealedPasswords.value.add(id)
    },
  })
}

function renderActions(row: AdminUserForm) {
  return h(Actions, {
    user: row,
    onDeleteUser: onDeleteUsers,
    onUserBanned,
    onOpenEditModal,
    onResetPassword,
  })
}

/**
 * 手机上一个人一张卡：用户名一行，班级 · 上次登录 · 建号一行小字（每项不断开），
 * 密码单独一行（学生忘了密码是最常见的事，要一眼找到），操作按钮放不下就折行
 */
function renderMobileCard(row: AdminUserForm) {
  return h("div", { class: "m-card" }, [
    h(UserNameCell, { user: row }),
    h("div", { class: "m-meta muted" }, [
      h("span", { class: "m-item" }, row.className ? classLabel(row.className) : "没填班级"),
      h("span", { class: "m-item" }, [" · ", lastLoginText(row)]),
      row.createTime
        ? h("span", { class: "m-item" }, ` · 建号 ${parseTime(row.createTime, "YYYY-MM-DD")}`)
        : null,
    ]),
    row.rawPassword
      ? h("div", { class: "m-password" }, [
          h("span", { class: "muted" }, "密码"),
          renderPassword(row),
        ])
      : null,
    renderActions(row),
  ])
}

const mobileColumns: DataTableColumn<AdminUserForm>[] = [
  { type: "selection" },
  { title: "用户", key: "username", render: renderMobileCard },
]

const desktopColumns: DataTableColumn<AdminUserForm>[] = [
  { type: "selection" },
  {
    title: "用户名",
    key: "username",
    // 定宽：用户名一般就 ks + 班号 + 两三个字，原来 minWidth 让它把整行剩下的空都吃掉了（用户嫌空太多）。
    // 剩下的宽度给最后的操作列，操作直接摆出来
    width: 230,
    render: (row) => h(UserNameCell, { user: row }),
  },
  {
    title: "班级",
    key: "className",
    width: 130,
    render: (row) => h("span", { class: "muted" }, row.className ? classLabel(row.className) : "—"),
  },
  {
    title: "密码",
    key: "raw_password",
    width: 150,
    render: renderPassword,
  },
  { title: "上次登录", key: "last_login", width: 150, render: lastLoginText },
  {
    title: "建号",
    key: "create_time",
    width: 110,
    render: (row) =>
      h(
        "span",
        { class: "num muted" },
        row.createTime ? parseTime(row.createTime, "YYYY-MM-DD") : "",
      ),
  },
  {
    key: "actions",
    title: "",
    minWidth: 300,
    render: renderActions,
  },
]

const columns = computed(() => (isMobile.value ? mobileColumns : desktopColumns))

const options: SelectOption[] = [
  { label: "普通", value: USER_TYPE.REGULAR_USER },
  { label: "学生管理员", value: USER_TYPE.STUDENT_ADMIN },
  { label: "教师管理员", value: USER_TYPE.TEACHER_ADMIN },
  { label: "超级管理员", value: USER_TYPE.SUPER_ADMIN },
]

const problemPermissionOptions: SelectOption[] = [
  { label: "无权限", value: PROBLEM_PERMISSION.NONE },
  { label: "仅管理自己创建", value: PROBLEM_PERMISSION.OWN },
  { label: "管理全部题目", value: PROBLEM_PERMISSION.ALL },
]
// 老师不给「无权限」：比赛题的接口要出题权限，设了就是比赛题目页全报权限不足，后端也会兜成「仅自己」
const teacherPermissionOptions = problemPermissionOptions.slice(1)

async function listUsers() {
  if (query.page < 1) query.page = 1
  const offset = (query.page - 1) * query.limit
  const res = await getUserList(
    offset,
    query.limit,
    query.type,
    query.keyword,
    query.orderBy,
    query.className,
  )
  total.value = res.total
  neverLoggedIn.value = res.neverLoggedIn
  users.value = res.results
  revealedPasswords.value.clear()
}

function chooseUsers(rowKeys: DataTableRowKey[]) {
  userIDs.value = rowKeys
}

async function onDeleteUsers(ids: DataTableRowKey[] | Ref<number[]>) {
  try {
    await deleteUsers(toRaw(ids) as number[])
    message.success("删掉了")
    userIDs.value = []
  } catch (err) {
    message.error(errorMessage(err))
  }
  listUsers()
}

async function onResetPassword(user: AdminUserForm) {
  const res = await resetPassword(user.id)
  message.success(`【${user.username}】的密码已重置成【${res}】`)
  users.value = users.value.map((it) => {
    if (it.id === user.id && user.adminType === USER_TYPE.REGULAR_USER) {
      it.rawPassword = res
    }
    return it
  })
}

async function onUserBanned(user: AdminUserForm) {
  users.value = users.value.map((it) => {
    if (it.id === user.id) {
      it.isDisabled = user.isDisabled
    }
    return it
  })
}

function createNewUser() {
  toggleCreate(true)
  userEditing.value = {
    id: 0,
    username: "",
    realName: "",
    // 预填一个唯一的占位邮箱：这条路走的是导入接口，后端要求邮箱合法且不重复，
    // 留空会直接被打回。想填真邮箱就改掉它
    email: `user.${Math.random().toString(36).slice(2, 10)}@example.com`,
    // 导入接口写死建成普通用户（后端 POST /admin/users），这里不摆一个建不出来的
    // 角色。要给管理员权限，建完再用「编辑」改
    adminType: "Regular User",
    problemPermission: "None",
    createTime: null,
    lastLogin: null,
    isDisabled: false,
    isOnline: false,
    rawPassword: null,
    className: null,
    password: "",
  }
  password.value = ""
}

function onOpenEditModal(user: AdminUserForm) {
  userEditing.value = user
  password.value = ""
}

function onCloseEditModal() {
  userEditing.value = null
  password.value = ""
  toggleCreate(false)
}

async function handleEditUser() {
  if (!userEditing.value) return
  // 新建走的是导入接口，密码是必填的（后端 min(1)），留空只会换来一句 400
  if (create.value && !password.value) {
    message.error("新建用户必须填写密码")
    return
  }
  if (password.value && password.value.length < 6) {
    message.error("密码长度不得小于 6")
    return
  }
  // http 拦截器只对 login-required / permission-denied 自动弹提示，
  // 其余业务错误（比如班级号位数不对）不接住就什么都不显示
  try {
    if (create.value) {
      const newUser = [
        [
          userEditing.value.username,
          password.value,
          userEditing.value.email ?? "",
          userEditing.value.realName ?? "",
        ],
      ]
      await importUsers(newUser)
      listUsers()
    } else {
      const user = Object.assign(userEditing.value, {
        password: password.value,
      })
      await editUser(user)
    }
  } catch (err) {
    message.error("保存失败：" + errorMessage(err))
    return
  }
  userEditing.value = null
  password.value = ""
  toggleCreate(false)
}

onMounted(listUsers)

// 监听搜索关键词变化（防抖）
watchDebounced(() => query.keyword, listUsers, { debounce: 500, maxWait: 1000 })

// 监听其他查询条件变化
watch(() => [query.page, query.limit, query.type, query.orderBy, query.className], listUsers)
</script>

<template>
  <PageHeader title="用户列表">
    <template #actions>
      <n-popconfirm v-if="userIDs.length" @positive-click="onDeleteUsers(userIDs)">
        <template #trigger>
          <n-button type="error" secondary>删除选中（{{ userIDs.length }}）</n-button>
        </template>
        删掉就找不回来了。交过题的账号删不掉，那种请改为禁用。
      </n-popconfirm>
      <n-button @click="createNewUser">新建一个</n-button>
      <n-button type="primary" @click="$router.push({ name: 'admin user generate' })">
        批量建号
      </n-button>
    </template>
    <template #filters>
      <n-input
        :style="{ width: isMobile ? '100%' : '220px' }"
        v-model:value="query.keyword"
        placeholder="用户名或名字"
        clearable
        @clear="clearQuery"
      />
      <n-select
        v-model:value="query.className"
        :options="classOptions"
        filterable
        aria-label="班级"
        style="width: 150px"
      />
      <n-select
        v-model:value="query.type"
        :options="adminOptions"
        aria-label="角色"
        style="width: 120px"
      />
      <n-select
        v-model:value="query.orderBy"
        :options="sortOptions"
        aria-label="排序"
        style="width: 120px"
      />
      <n-text depth="3">
        {{ total }} 人<template v-if="neverLoggedIn"> · {{ neverLoggedIn }} 人从没登录</template>
      </n-text>
    </template>
  </PageHeader>
  <n-data-table
    striped
    class="user-table"
    :data="users"
    :columns="columns"
    :row-key="rowKey"
    :checked-row-keys="userIDs"
    @update:checked-row-keys="chooseUsers"
  />
  <Pagination :total="total" v-model:limit="query.limit" v-model:page="query.page" />
  <n-modal
    :mask-closable="false"
    :show="!!userEditing"
    preset="card"
    :title="create ? '新建用户' : '编辑用户'"
    style="width: 700px"
    @close="onCloseEditModal"
  >
    <n-form label-placement="left" v-if="userEditing">
      <n-grid :cols="isMobile ? 1 : 2" :x-gap="16">
        <n-form-item-gi :span="1" label="用户">
          <n-input v-model:value="userEditing.username" />
        </n-form-item-gi>
        <n-form-item-gi :span="1" label="真名">
          <n-input v-model:value="userEditing.realName" />
        </n-form-item-gi>
        <!-- 班级是后端从用户名的 ks 数字前缀推出来的（classNameOf），
             editUser 也不发这个字段，所以这里只读 —— 以前是个能改、改了没用的输入框 -->
        <n-form-item-gi v-if="!create" :span="1" label="班级">
          <n-input :value="userEditing.className" disabled placeholder="由用户名自动推导" />
        </n-form-item-gi>
        <n-form-item-gi :span="1" label="邮箱">
          <n-input v-model:value="userEditing.email" />
        </n-form-item-gi>
        <n-form-item-gi v-if="!create" :span="1" label="类型">
          <n-select v-model:value="userEditing.adminType" :options="options" />
        </n-form-item-gi>
        <n-form-item-gi :span="1" label="密码" label-style="color: red; font-weight: bold">
          <n-input v-model:value="password" />
        </n-form-item-gi>
        <n-form-item-gi
          v-if="
            !create &&
            (userEditing.adminType === USER_TYPE.STUDENT_ADMIN ||
              userEditing.adminType === USER_TYPE.TEACHER_ADMIN)
          "
          :span="1"
          label="出题权限"
        >
          <n-select
            v-model:value="userEditing.problemPermission"
            :options="
              userEditing.adminType === USER_TYPE.TEACHER_ADMIN
                ? teacherPermissionOptions
                : problemPermissionOptions
            "
          />
        </n-form-item-gi>

        <n-form-item-gi v-if="!create" :span="1" label="是否封禁">
          <n-switch v-model:value="userEditing.isDisabled">封号</n-switch>
        </n-form-item-gi>
      </n-grid>
      <n-flex justify="end">
        <n-button @click="onCloseEditModal">取消</n-button>
        <n-button type="primary" @click="handleEditUser">保存</n-button>
      </n-flex>
    </n-form>
  </n-modal>
</template>

<style scoped>
.user-table :deep(.muted) {
  color: v-bind("theme.textColor3");
}

.user-table :deep(.m-card) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.user-table :deep(.m-meta) {
  font-size: 13px;
  line-height: 1.5;
}

.user-table :deep(.m-item) {
  white-space: nowrap;
}

.user-table :deep(.m-password) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.user-table :deep(.num) {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.user-table :deep(.online) {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: v-bind("theme.successColor");
  vertical-align: 1px;
}
</style>
