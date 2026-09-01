<script setup lang="ts">
import type { CollabRequestItem } from "shared/composables/websocket"
import { useCollabStore } from "shared/store/collab"
import HelpRequestList from "./HelpRequestList.vue"

/**
 * 课堂求助的全局界面：一次性提示、新求助 toast、求助列表、教师端协作弹框。
 *
 * 挂在 App.vue 而不是顶栏或 default.vue 布局里。这些东西跟着**连接**走，
 * 而连接是全局常驻的（App.vue 按登录态开关）—— 挂在顶栏里的时候，老师一进
 * /admin 就换成了 admin.vue 布局，顶栏连同这几个消费者一起卸载：求助照收，
 * 提示、角标、协作弹框全都不出现，正好错过 collab.ts 里写的那句「老师可能
 * 正在后台改题时收到求助」。放在这里才真的全局。
 *
 * 位置要求：n-message-provider 的后代（useMessage 需要）。
 */
/**
 * 协作弹框异步加载。
 *
 * 这个组件静态 import 进来的话，整套 CodeMirror（view / state / language /
 * autocomplete / lang-*）就跟着 App.vue 进了入口 chunk —— 首屏白白多下 640 KB
 * （gzip 后 210 KB），而下面那个 v-if 决定了学生根本不渲染它。机房那批
 * Chrome 91 的老机器解析这些字节是实打实的开销。
 *
 * 拆成异步之后首页的 JS 从 1.9 MB 降到 1.3 MB（gzip 642 KB → 428 KB），
 * 老师那边只是在第一次接单时多一次 chunk 请求。
 */
const CollabModal = defineAsyncComponent(() => import("./CollabModal.vue"))

const collabStore = useCollabStore()
const message = useMessage()

/**
 * 一次性提示统一在这里消费。
 *
 * 学生排着队切去看提交记录，老师这时候取消了他的求助，那条「老师已取消你的
 * 求助」挂在题目页上就永远没人消费 —— 教师端的 error 提示（比如「请先退出
 * 当前协作」）同理。
 */
watch(
  () => collabStore.noticeSeq,
  () => {
    const text = collabStore.consumeNotice()
    if (text) message.info(text)
  },
)

/**
 * 新求助进来只有角标默默 +1，上课走动的时候根本注意不到，补一条 toast。
 *
 * 只在数字**变大**时弹：老师自己接单、拒绝、别的老师接走都会让它变小，那些
 * 不该打扰人。断线重连后服务端会重推一份全量列表，队里还有人的话这里会再弹
 * 一次 —— 那正好是「你刚断过线，这些人还等着」，留着。
 */
watch(
  () => collabStore.pendingCount,
  (count, previous) => {
    if (count <= previous) return
    let latest: CollabRequestItem | null = null
    for (const item of collabStore.requests) {
      if (item.status !== "pending") continue
      if (!latest || item.createdAt > latest.createdAt) latest = item
    }
    const text = latest
      ? `${latest.studentName} 求助：${latest.problemTitle}`
      : "有新的求助"
    // 内容传 render 函数（naive 的 content 支持），这样整条 toast 可点：
    // 点一下直接开求助列表，省得再去点名字、再点菜单。
    const notice = message.info(
      () =>
        h(
          "span",
          {
            style: { cursor: "pointer" },
            onClick: () => {
              collabStore.helpPanelOpen = true
              notice.destroy()
            },
          },
          `${text} · 点击处理`,
        ),
      { duration: 5000 },
    )
  },
)
</script>

<template>
  <HelpRequestList
    v-if="collabStore.isTeacher"
    v-model:show="collabStore.helpPanelOpen"
  />
  <CollabModal v-if="collabStore.isTeacher" />
</template>
