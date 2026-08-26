<script setup lang="ts">
import { DataTableRowKey, SelectOption } from "naive-ui"
import Pagination from "shared/components/Pagination.vue"
import { usePagination } from "shared/composables/pagination"
import { parseTime } from "utils/functions"
import type { User } from "utils/types"
import {
  deleteUsers,
  editUser,
  getUserList,
  importUsers,
  resetPassword,
} from "../api"
import Actions from "./components/Actions.vue"
import Name from "./components/Name.vue"
import { PROBLEM_PERMISSION, USER_TYPE } from "utils/constants"
import { useRouteQuery } from "@vueuse/router"
import TextCopy from "shared/components/TextCopy.vue"

const message = useMessage()

interface UserQuery {
  keyword: string
  type: string
  orderBy: string
}

// 使用分页 composable
const { query, clearQuery } = usePagination<UserQuery>({
  keyword: useRouteQuery("keyword", "").value,
  type: useRouteQuery("type", "").value,
  orderBy: useRouteQuery("orderBy", "").value,
})

const total = ref(0)
const users = ref<User[]>([])
const userEditing = ref<User | null>(null)

const adminOptions = [
  { label: "全部用户", value: "" },
  { label: "学生管理员", value: USER_TYPE.STUDENT_ADMIN },
  { label: "教师管理员", value: USER_TYPE.TEACHER_ADMIN },
  { label: "超级管理员", value: USER_TYPE.SUPER_ADMIN },
]

const sortOptions = [
  { label: "默认排序", value: "" },
  { label: "最近登录", value: "-last_login" },
]
const [create, toggleCreate] = useToggle(false)
const password = ref("")
const userIDs = ref<DataTableRowKey[]>([])

const rowKey = (row: User) => row.id

const columns: DataTableColumn<User>[] = [
  { type: "selection" },
  { title: "ID", key: "id", width: 80 },
  {
    title: "用户名",
    key: "username",
    width: 220,
    render: (row) => h(Name, { user: row }),
  },
  {
    title: "密码",
    key: "raw_password",
    width: 100,
    render: (row) => h(TextCopy, () => row.rawPassword),
  },
  {
    title: "创建时间",
    key: "create_time",
    width: 200,
    render: (row) =>
      row.createTime ? parseTime(row.createTime, "YYYY-MM-DD HH:mm:ss") : "",
  },
  {
    title: "上次登录",
    key: "last_login",
    width: 200,
    render: (row) =>
      row.lastLogin
        ? parseTime(row.lastLogin, "YYYY-MM-DD HH:mm:ss")
        : "从未登录",
  },
  {
    title: "真名",
    key: "real_name",
    width: 100,
    render: (row) => h(TextCopy, () => row.realName),
  },
  { title: "邮箱", key: "email", width: 200 },
  {
    key: "actions",
    title: "选项",
    width: 280,
    render: (row) =>
      h(Actions, {
        user: row,
        onDeleteUser: onDeleteUsers,
        onUserBanned,
        onOpenEditModal,
        onResetPassword,
      }),
  },
]

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

async function listUsers() {
  if (query.page < 1) query.page = 1
  const offset = (query.page - 1) * query.limit
  const res = await getUserList(
    offset,
    query.limit,
    query.type,
    query.keyword,
    query.orderBy,
  )
  total.value = res.total
  users.value = res.results
}

function chooseUsers(rowKeys: DataTableRowKey[]) {
  userIDs.value = rowKeys
}

async function onDeleteUsers(userIDs: DataTableRowKey[] | Ref<number[]>) {
  await deleteUsers(toRaw(userIDs) as number[])
  listUsers()
}

async function onResetPassword(user: User) {
  const res = await resetPassword(user.id)
  message.success(`【${user.username}】的密码已重置成【${res}】`)
  users.value = users.value.map((it) => {
    if (it.id === user.id && user.adminType === USER_TYPE.REGULAR_USER) {
      it.rawPassword = res
    }
    return it
  })
}

async function onUserBanned(user: User) {
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
    email: "",
    adminType: "Student Admin",
    problemPermission: "None",
    createTime: null,
    lastLogin: null,
    openApi: false,
    isDisabled: false,
    rawPassword: null,
    className: null,
    password: "",
  }
  password.value = ""
}

function onOpenEditModal(user: User) {
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
  } catch (err: any) {
    message.error("保存失败：" + err.data)
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
watch(() => [query.page, query.limit, query.type, query.orderBy], listUsers)
</script>

<template>
  <n-flex class="titleWrapper" justify="space-between">
    <n-flex>
      <h2 class="title">用户列表</h2>
      <n-button type="primary" @click="createNewUser">新建</n-button>
      <n-button @click="$router.push({ name: 'admin user generate' })">
        导入
      </n-button>
    </n-flex>
    <n-flex>
      <n-popconfirm
        v-if="userIDs.length"
        @positive-click="onDeleteUsers(userIDs)"
      >
        <template #trigger>
          <n-button type="warning">删除</n-button>
        </template>
        确定删除选中的用户吗？删除后无法恢复！
      </n-popconfirm>
      <n-flex align="center">
        <n-select
          v-model:value="query.orderBy"
          :options="sortOptions"
          placeholder="排序方式"
          style="width: 120px"
        />
        <n-select
          v-model:value="query.type"
          :options="adminOptions"
          placeholder="选择用户类型"
          style="width: 120px"
        />
        <div>
          <n-input
            style="width: 200px"
            v-model:value="query.keyword"
            clearable
            @clear="clearQuery"
          />
        </div>
      </n-flex>
    </n-flex>
  </n-flex>
  <n-data-table
    :data="users"
    :columns="columns"
    striped
    :row-key="rowKey"
    @update:checked-row-keys="chooseUsers"
  />
  <Pagination
    :total="total"
    v-model:limit="query.limit"
    v-model:page="query.page"
  />
  <n-modal
    :mask-closable="false"
    :show="!!userEditing"
    preset="card"
    :title="create ? '新建用户' : '编辑用户'"
    style="width: 700px"
    @close="onCloseEditModal"
  >
    <n-form label-placement="left" v-if="userEditing">
      <n-grid :cols="2" :x-gap="16">
        <n-form-item-gi :span="1" label="用户">
          <n-input v-model:value="userEditing.username" />
        </n-form-item-gi>
        <n-form-item-gi :span="1" label="真名">
          <n-input v-model:value="userEditing.realName" />
        </n-form-item-gi>
        <n-form-item-gi v-if="!create" :span="1" label="班级">
          <n-input v-model:value="userEditing.className" />
        </n-form-item-gi>
        <n-form-item-gi :span="1" label="邮箱">
          <n-input v-model:value="userEditing.email" />
        </n-form-item-gi>
        <n-form-item-gi v-if="!create" :span="1" label="类型">
          <n-select v-model:value="userEditing.adminType" :options="options" />
        </n-form-item-gi>
        <n-form-item-gi
          :span="1"
          label="密码"
          label-style="color: red; font-weight: bold"
        >
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
            :options="problemPermissionOptions"
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
.titleWrapper {
  margin-bottom: 16px;
}

.title {
  margin: 0;
}
</style>
