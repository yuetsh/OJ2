import { errorCode } from "utils/api"
import { formatISO, getTime, parseISO } from "date-fns"
import { useUserStore } from "shared/store/user"
import { ContestStatus, ContestType } from "utils/constants"
import { duration, secondsToDuration } from "utils/functions"
import { isExamTag, type ContestScoreboard } from "@oj2/contract"
import type { Contest, ProblemRow } from "utils/types"
import {
  checkContestPassword,
  getContest,
  getContestAccess,
  getContestProblems,
  getContestScoreboard,
} from "../api"

export const useContestStore = defineStore("contest", () => {
  const userStore = useUserStore()
  const [access, toggleAccess] = useToggle(false)
  const contest = ref<Contest | null>(null)
  const problems = ref<ProblemRow[]>([])
  const now = ref(0)
  /** 整张榜（学生比赛页右边的名次、排名页共用），进行中由页面每 10 秒刷一次 */
  const scoreboard = ref<ContestScoreboard | null>(null)
  /** 上次拉到榜的时刻（本机时间），「8 秒前更新」用 */
  const scoreboardAt = ref(0)

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

  /** 进行中还剩多久，「38:12」「1:05:00」这种；不在进行中为空串。题目页上下文条用 */
  const remaining = computed(() => {
    if (contestStatus.value !== ContestStatus.underway) return ""
    const end = getTime(parseISO(contest.value!.endTime.toString()))
    const text = secondsToDuration(Math.max(0, Math.floor((end - now.value) / 1000)))
    return text.startsWith("0:") ? text.slice(2) : text
  })

  const isContestAdmin = computed(
    () =>
      userStore.isSuperAdmin ||
      (userStore.isAuthed && contest.value?.createdBy.id === userStore.user!.id),
  )

  /** 老师（出题人、超管、其他老师）：看得到全班情况、真名，期中期末进行中也看得到排名 */
  const isTeacher = computed(() => isContestAdmin.value || userStore.isTeacherOrAbove)

  const isPrivate = computed(() => contest.value!.contestType === ContestType.private)

  /** 期中、期末进行中，学生看不到排名和每题做对人数（后端同样拦着，这里只管界面） */
  const rankHidden = computed(
    () =>
      !!contest.value &&
      isExamTag(contest.value.tag) &&
      contestStatus.value === ContestStatus.underway &&
      !isTeacher.value,
  )

  /** 能不能看题目（也就能看榜）：开始了、密码对了；老师 / 出题人随时 */
  const canEnter = computed(() => {
    if (!contest.value) return false
    if (isContestAdmin.value) return true
    if (contestStatus.value === ContestStatus.not_started) return false
    return !isPrivate.value || access.value
  })

  async function loadScoreboard(contestID: string) {
    try {
      scoreboard.value = await getContestScoreboard(contestID)
      scoreboardAt.value = Date.now()
    } catch {
      // 没开始 / 没密码时拉不到，界面按 canEnter 自己会挡住
    }
  }

  async function init(contestID: string) {
    problems.value = []
    const res = await getContest(contestID)
    contest.value = res
    // now 是学生侧比赛专有的服务器时间，用来对齐倒计时
    now.value = getTime(parseISO(res.now ?? res.createTime))
    // 先停掉上一轮的表。init() 会被调第二次：detail.vue 在「未开始 → 进行中」那一刻
    // 重新 init 一次（为了把开赛后才拿得到的题目捞回来），不清的话两个 setInterval
    // 一起给 now 加 1000，倒计时变两倍速 —— 学生赛前挂着页面就会中招，一场 60 分钟的
    // 比赛过了 30 分钟页面就显示「已结束」，而服务端其实还在正常收提交。
    if (timer) clearInterval(timer)
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
    scoreboard.value = null
    problems.value = []
    toggleAccess(false)
    now.value = 0
    if (timer) clearInterval(timer)
    timer = 0
  }

  /** 返回失败时的错误码（成功为 null），调用方据此给提示 */
  async function checkPassword(contestID: string, password: string) {
    try {
      const res = await checkContestPassword(contestID, password)
      toggleAccess(res)
      if (res) {
        _getProblems(contestID)
      }
      return null
    } catch (err) {
      toggleAccess(false)
      return errorCode(err) ?? "unknown"
    }
  }

  async function _getProblems(contestID: string) {
    try {
      problems.value = await getContestProblems(contestID)
    } catch {
      problems.value = []
      toggleAccess(false)
    }
  }

  return {
    contest,
    contestStatus,
    isContestAdmin,
    isTeacher,
    rankHidden,
    canEnter,
    scoreboard,
    scoreboardAt,
    loadScoreboard,
    now,
    access,
    problems,
    isPrivate,
    countdown,
    remaining,
    init,
    clear,
    checkPassword,
  }
})
