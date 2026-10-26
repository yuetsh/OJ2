<script setup lang="ts">
import { useCollabStore } from 'shared/store/collab'

/**
 * 课堂求助的全局界面：一次性提示、老师接单后跳到那道题。
 *
 * 新求助**不弹 toast**：原来每来一个就弹一条，一节课能弹十几次，讲台电脑投着屏时还弹在
 * 全班面前。现在靠顶栏（前台、后台都有）的 HelpButton：没人等不显示，冒出来就是提醒，
 * 人数再变多时闪一下。
 *
 * 教师端的协作**没有弹框**：房间开好就跳到那道题的页面，在页面自带的编辑器里协作
 * （ProblemEditor 的 collabHere）。用户选的方案 A：演示学生的错误时题目和代码要并排。
 * 原来这里还异步挂一个 CollabModal，那个弹框按一下 Esc 就关、协作跟着结束。
 *
 * 挂在 App.vue 而不是顶栏或 default.vue 布局里。这些东西跟着**连接**走，
 * 而连接是全局常驻的（App.vue 按登录态开关）—— 挂在前台顶栏里的时候，老师一进
 * /admin 就换成了 admin.vue 布局，顶栏连同这几个消费者一起卸载，正好错过
 * collab.ts 里写的那句「老师可能正在后台改题时收到求助」。放在这里才真的全局；
 * 后台那条顶栏自己也挂了一个 HelpButton。
 *
 * 位置要求：n-message-provider 的后代（useMessage 需要）。
 */
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
 * 老师这边房间开好了（「帮他」、看板上点「在写」、协作条的「下一个」）：跳到那道题。
 * 等 room_open 到了才跳，不在点的那一刻跳 —— 服务端可能拒了（别的老师先接走、学生刚走），
 * 那时候跳过去就是对着一个空编辑器。已经在这道题上就不跳（同一道题换下一个人）
 */
const router = useRouter()
const route = useRoute()
watch(
  () => collabStore.room,
  (room) => {
    if (!room || !collabStore.isTeacher) return
    const target = `/problem/${room.problemId}`
    if (route.path !== target) router.push(target)
  },
)
</script>

<template>
  <span hidden></span>
</template>
