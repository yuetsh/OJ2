<script setup lang="ts">
import { STORAGE_KEY } from "utils/constants"
import storage from "utils/storage"
import { useUserStore } from "shared/store/user"

// 两边都按需加载：没登录的访客只拿题目列表那一份，登录了的学生只拿首页那一份
const Dashboard = defineAsyncComponent(() => import("./dashboard.vue"))
const ProblemList = defineAsyncComponent(() => import("oj/problem/list.vue"))

const userStore = useUserStore()

// profile 回来之前先按上次的登录标记猜一个：干等的话 /profile 一失败首页就是
// 白的，而先按「没登录」渲染又会让每个学生都先闪一下题目列表
const showDashboard = computed(() =>
  userStore.isFinished ? userStore.isAuthed : !!storage.get(STORAGE_KEY.AUTHED),
)
</script>

<template>
  <Dashboard v-if="showDashboard" />
  <ProblemList v-else />
</template>
