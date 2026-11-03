<script setup lang="ts">
import { getSubmission } from 'oj/api'
import { useMascotGuide } from 'shared/mascot/guide'
import { useUserStore } from 'shared/store/user'
import type { Submission } from 'utils/types'
import SubmissionView from './components/SubmissionView.vue'

/** 单独打开的一条提交，主体在 SubmissionView（课堂任务「讲错误」的弹层也用它） */
const props = defineProps<{ submissionID: string }>()

const router = useRouter()
const userStore = useUserStore()

/**
 * 看板娘：学生看自己的提交时带回这道题。SubmissionView 里的数据拿不出来（弹层也用它，不挂看板娘），
 * 这里另取一份不带「这道题交的几次」的，只给学生取
 */
const mine = ref<Submission | null>(null)
watch(
  () => [props.submissionID, userStore.isAuthed && !userStore.isTeacherOrAbove] as const,
  async ([id, student]) => {
    mine.value = null
    if (!student) return
    const res = await getSubmission(id).catch(() => null)
    if (res && id === props.submissionID && res.userId === userStore.user?.id) mine.value = res
  },
  { immediate: true },
)

useMascotGuide(() => {
  const s = mine.value
  if (!s || userStore.isTeacherOrAbove) return null
  // 和页面上题目那个链接同一个去处：比赛里交的回比赛里的题
  const to = s.contestId
    ? { name: 'contest problem', params: { contestID: String(s.contestId), problemID: s.problemDisplayId } }
    : '/problem/' + s.problemDisplayId
  return { situation: 'submission.detail', actions: [{ label: '回到这道题', run: () => router.push(to) }] }
})
</script>

<template>
  <SubmissionView :id="submissionID" />
</template>
