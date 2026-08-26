import { formatISO, getTime, parseISO } from "date-fns"
import { useUserStore } from "shared/store/user"
import { ContestStatus, ContestType } from "utils/constants"
import { duration } from "utils/functions"
import type { OjContest, ProblemFiltered } from "utils/types"
import {
  checkContestPassword,
  getContest,
  getContestAccess,
  getContestProblems,
} from "../api"

export const useContestStore = defineStore("contest", () => {
  const userStore = useUserStore()
  const [access, toggleAccess] = useToggle(false)
  const contest = ref<OjContest | null>(null)
  const problems = ref<ProblemFiltered[]>([])
  const now = ref(0)

  let timer = 0

  const contestStatus = computed<ContestStatus>(() => {
    if (!contest.value) return ContestStatus.initial
    const start = getTime(parseISO(contest.value.startTime.toString()))
    const end = getTime(parseISO(contest.value.endTime.toString()))
    if (start > now.value) {
      return ContestStatus.not_started
    } else if (end < now.value) {
      return ContestStatus.finished
    } else {
      return ContestStatus.underway
    }
  })

  const countdown = computed(() => {
    if (contestStatus.value === ContestStatus.finished) {
      return "已结束"
    } else if (contestStatus.value === ContestStatus.not_started) {
      const d = duration(formatISO(now.value), contest.value!.startTime, true)
      return "距离比赛开始 " + d
    } else {
      const d = duration(formatISO(now.value), contest.value!.endTime, true)
      return "距离比赛结束 " + d
    }
  })

  const isContestAdmin = computed(
    () =>
      userStore.isSuperAdmin ||
      (userStore.isAuthed &&
        contest.value?.createdBy.id === userStore.user!.id),
  )

  const isPrivate = computed(
    () => contest.value!.contestType === ContestType.private,
  )

  async function init(contestID: string) {
    problems.value = []
    const res = await getContest(contestID)
    contest.value = res
    // now 是学生侧比赛专有的服务器时间，用来对齐倒计时
    now.value = getTime(parseISO(res.now ?? res.createTime))
    if (contestStatus.value !== ContestStatus.finished) {
      timer = setInterval(() => {
        now.value = now.value + 1000
      }, 1000)
    }
    if (contest.value?.contestType === ContestType.private) {
      const res = await getContestAccess(contestID)
      toggleAccess(res.access)
    }
    _getProblems(contestID)
  }

  function clear() {
    contest.value = null
    problems.value = []
    toggleAccess(false)
    now.value = 0
    if (timer) clearInterval(timer)
  }

  async function checkPassword(contestID: string, password: string) {
    try {
      const res = await checkContestPassword(contestID, password)
      toggleAccess(res)
      if (res) {
        _getProblems(contestID)
      }
    } catch (err) {
      toggleAccess(false)
    }
  }

  async function _getProblems(contestID: string) {
    try {
      problems.value = await getContestProblems(contestID)
    } catch (err) {
      problems.value = []
      toggleAccess(false)
    }
  }

  return {
    contest,
    contestStatus,
    isContestAdmin,
    access,
    problems,
    isPrivate,
    countdown,
    init,
    clear,
    checkPassword,
  }
})
