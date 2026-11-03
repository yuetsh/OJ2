import { useBreakpoints } from 'shared/composables/breakpoints'
import { useMascotGuide, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import { HINT_MIN_FAILURES, isFlowchartPass } from '@oj2/contract'
import { habitSituation, logMascotEvent, refreshMascotProfile, requestSpeech } from 'shared/mascot/behavior'
import { useChallengeStore } from 'oj/store/challenge'
import { useFlowchartStore } from 'oj/store/flowchart'
import type { MascotSituation } from 'shared/mascot/lines'
import { useCollabStore } from 'shared/store/collab'
import { useLessonStore } from 'shared/store/lesson'
import { useUserStore } from 'shared/store/user'
import { useCodeStore } from 'oj/store/code'
import { useProblemStore } from 'oj/store/problem'
import { useSubmissionStore, type ResultSegment } from 'oj/store/submission'
import { SubmissionStatus } from 'utils/constants'
import type { ProblemDetail } from 'utils/types'
import { useProblemPageContext } from './problemPageContext'
import { useTeacherCollab } from './teacherCollab'

/** 同一道题错到这么多次，她就不怼了，劝去举手 */
const STUCK_FAILS = 5
/** 错过这么多次以后做对，算「终于」 */
const FINALLY_FAILS = 2

const RESULT_SITUATION: Partial<Record<SubmissionStatus, MascotSituation>> = {
  [SubmissionStatus.wrong_answer]: 'problem.wrong',
  [SubmissionStatus.partial_accepted]: 'problem.wrong',
  [SubmissionStatus.ast_check_failed]: 'problem.wrong',
  [SubmissionStatus.compile_error]: 'problem.compileError',
  [SubmissionStatus.runtime_error]: 'problem.runtimeError',
  [SubmissionStatus.memory_limit_exceeded]: 'problem.runtimeError',
  [SubmissionStatus.cpu_time_limit_exceeded]: 'problem.timeout',
  [SubmissionStatus.real_time_limit_exceeded]: 'problem.timeout',
}

/** 一道题上这么久没交、没跑例子，她就来问一句（主动开口） */
const IDLE_MS = 15 * 60_000
/** 连着这么多次没跑例子就交，而且错了，她就念一句 */
const UNSAMPLED_SUBMITS = 3
/** 同班做对这么多人，就拿出来说「全班已经 N 个人做对了」 */
const CLASS_MANY = 5
/** 同班交过这么多人、做对的不超过 CLASS_FEW 个，算「全班都卡着」 */
const CLASS_TRIED = 5
const CLASS_FEW = 2
/** 全站交过这么多次，通过率才有意义 */
const RATE_MIN_SUBMISSIONS = 30
const HARD_RATE = 0.3
const EASY_RATE = 0.7

/** 几种「换个说法」各自的机会：不是每次都说同一件事 */
const CHANCE = { classMany: 0.3, classFew: 0.5, rate: 0.4, hint: 0.5, challenge: 0.4 } as const
const roll = (chance: number) => Math.random() < chance

const FINISHED = (result: number | undefined) =>
  result !== undefined && result !== SubmissionStatus.pending && result !== SubmissionStatus.judging && result !== SubmissionStatus.submitting

/**
 * 题目页上看板娘说什么、给哪几个按钮。看的是这一页上最近的那件事：刚交的结果、刚跑的例子，
 * 都没有就看写没写代码。比赛入口不用管（Mascot.vue 在比赛里不弹）。
 *
 * 另外几件事她会主动开口（只对学生，频率上限在 Mascot.vue）：同一道题错到第 5 次、连着 3 次
 * 没跑例子就交还错了、又犯了自己的老毛病（behavior.ts 的 habitSituation）、15 分钟没交没跑。
 *
 * `showResult` 是「我错在哪」：把左栏切到「结果」页签的那一段（提交结果 / 运行例子），页签归页面管。
 */
export function useProblemMascotGuide(showResult: (segment: ResultSegment) => void) {
  const router = useRouter()
  const userStore = useUserStore()
  const problemStore = useProblemStore()
  const submissionStore = useSubmissionStore()
  const codeStore = useCodeStore()
  const collabStore = useCollabStore()
  const lessonStore = useLessonStore()
  const ctx = useProblemPageContext()
  const teacherCollab = useTeacherCollab()
  const { isDesktop } = useBreakpoints()
  const flowchartStore = useFlowchartStore()
  const challengeStore = useChallengeStore()

  /** 学生在这道题上能用的几个按钮，点她和她主动开口共用 */
  function studentActions(problem: ProblemDetail) {
    const language = codeStore.code.language
    const entry = ctx.value
    const runSamples: MascotAction | null =
      problem.samples.length && language !== 'Flowchart' && language !== 'SQL' ? { label: '运行例子', run: submissionStore.runSamples } : null
    // 和工具栏的「举手求助」同一个条件；已经举着手、老师在帮的时候不给
    const help: MascotAction | null =
      entry.help && isDesktop.value && !userStore.demoMode && language !== 'Flowchart' && collabStore.helpStatus === 'idle'
        ? { label: '举手求助', run: () => collabStore.requestHelp(problem._id, language) }
        : null
    const why: MascotAction = { label: '我错在哪', run: () => showResult('submit') }
    const whySamples: MascotAction = { label: '我错在哪', run: () => showResult('samples') }
    const busy = submissionStore.isFormatting || submissionStore.isSubmittingRequest || submissionStore.judging || submissionStore.isCooldown
    const submit: MascotAction | null = busy
      ? null
      : { label: '提交', run: () => submissionStore.submit({ contestId: entry.contestId, problemSetId: entry.problemSetId }) }
    return { runSamples, help, why, whySamples, submit }
  }

  const guide = (situation: MascotSituation, ...actions: (MascotAction | null)[]): MascotGuide => ({
    situation,
    actions: actions.filter((it): it is MascotAction => !!it),
  })

  useMascotGuide(() => {
    const problem = problemStore.problem
    if (!problem) return null

    if (userStore.isTeacherOrAbove) {
      // 协作中别把老师带离这一页：跳走协作就断了
      if (teacherCollab.value) return null
      const actions: MascotAction[] = [{ label: '全班这题的提交', run: () => router.push({ name: 'submissions', query: { problem: problem._id } }) }]
      if (isDesktop.value && userStore.canEditProblem(problem)) {
        actions.push({ label: '编辑这道题', run: () => window.open(router.resolve(`/admin/problem/edit/${problem.id}`).href, '_blank') })
      }
      return { situation: 'teacher.problem', actions }
    }

    const entry = ctx.value
    const { runSamples, help, why, whySamples, submit } = studentActions(problem)

    if (codeStore.code.language === 'Flowchart') {
      // 画过、评过分了：分低就说分低，拿了 S 夸一句
      const grade = flowchartStore.latestRating.grade
      if (grade === 'S') return guide('flowchart.good', help)
      if (grade && !isFlowchartPass(grade)) return guide('flowchart.low', help)
      return guide('problem.flowchart', help)
    }
    // 正在判、正在跑例子：没什么好说的，打个招呼
    if (submissionStore.judging || submissionStore.pending || submissionStore.trial.samplesRunning.value) return null

    const stuck = problemStore.failCount >= STUCK_FAILS
    if (submissionStore.syntaxErrorInfo) return stuck ? guide('problem.stuck', help, why) : guide('problem.compileError', why, help)

    const runs = submissionStore.trial.sampleRuns.value
    if (submissionStore.resultSegment === 'samples' && runs.length) {
      return runs.every((run) => run.result === SubmissionStatus.accepted)
        ? guide('problem.samplesPassed', submit)
        : guide('problem.samplesFailed', whySamples, help)
    }

    const result = submissionStore.submission?.result
    const lesson = lessonStore.find(problem._id)
    if (result === SubmissionStatus.accepted) {
      const next = nextAction()
      // 课堂条的数是拉的时候的，刚做对重拉回来可能已经把自己算进去了
      if (lesson && lesson.acceptedCount <= (lesson.myStatus === 'accepted' ? 1 : 0)) return guide('class.firstSolver', next)
      if (entry.challenges && challengeStore.current?.challenges.length && roll(CHANCE.challenge)) return guide('problem.challenge', next)
      const fails = problemStore.failCount
      return guide(fails === 0 ? 'problem.firstTry' : fails >= FINALLY_FAILS ? 'problem.finally' : 'problem.accepted', next)
    }
    const failed = result === undefined ? undefined : RESULT_SITUATION[result as SubmissionStatus]
    if (failed) {
      if (stuck) return guide('problem.stuck', help, why)
      const actions = [why, failed === 'problem.wrong' ? runSamples : null, help]
      // AI 提示开了还没要：提一句，按钮带去结果里（提示在那儿）
      const hintOpen = !problem.contestId && problemStore.failCount >= HINT_MIN_FAILURES && !submissionStore.hint.hintContent.value
      if (hintOpen && roll(CHANCE.hint)) return guide('problem.hintReady', ...actions)
      const classGuide = classSituation(lesson)
      if (classGuide) return { ...guide(classGuide.situation, ...actions), n: classGuide.n }
      const rate = problem.submissionNumber >= RATE_MIN_SUBMISSIONS ? problem.acceptedNumber / problem.submissionNumber : null
      if (rate !== null && rate < HARD_RATE && roll(CHANCE.rate)) return guide('problem.hardWrong', ...actions)
      if (rate !== null && rate > EASY_RATE && failed === 'problem.wrong' && roll(CHANCE.rate)) return guide('problem.easyWrong', ...actions)
      return guide(failed, ...actions)
    }

    if (problem.myStatus === SubmissionStatus.accepted) return guide('problem.solvedBefore', nextAction())
    if (codeStore.code.value.trim().length < 10) return guide(entry.entry === 'problemset' ? 'problem.inSet' : 'problem.blank', runSamples, help)
    const classGuide = classSituation(lesson)
    if (classGuide?.situation === 'class.manyDone') return { ...guide('class.manyDone', runSamples, help), n: classGuide.n }
    return guide('problem.unsubmitted', runSamples, help)

    /** 这节课的题：同班多少人做对了（课堂条那份数），不在这节课里就没有 */
    function classSituation(item: typeof lesson) {
      if (!item || item.myStatus === 'accepted') return null
      if (item.acceptedCount >= CLASS_MANY && roll(CHANCE.classMany)) return { situation: 'class.manyDone' as const, n: item.acceptedCount }
      if (item.userCount >= CLASS_TRIED && item.acceptedCount <= CLASS_FEW && roll(CHANCE.classFew))
        return { situation: 'class.fewDone' as const, n: item.acceptedCount }
      return null
    }

    /** 做对之后去哪：专题里回专题，这节课里去下一道还没做的 */
    function nextAction(): MascotAction | null {
      if (entry.entry === 'problemset') return { label: '回专题', run: () => router.push(`/problemset/${entry.problemSetId}`) }
      const next = lessonStore.nextAfter(problem!._id)?.next
      return next ? { label: '下一道', run: () => router.push(`/problem/${next.problemDisplayId}`) } : null
    }
  })

  // ---- 主动开口（只对学生；比赛里 Mascot.vue 不弹）----

  const student = () => userStore.isAuthed && !userStore.isTeacherOrAbove && ctx.value.entry !== 'contest'

  /** 这道题上连着几次没跑例子就交了。跑过一次例子就清零 */
  let unsampledSubmits = 0
  let sampledSinceSubmit = false
  /** 上一次「动静」（进题、交、跑例子）的时刻，给「盯了好久」用 */
  let lastActivity = Date.now()

  watch(
    () => problemStore.problem?.id,
    () => {
      unsampledSubmits = 0
      sampledSinceSubmit = false
      lastActivity = Date.now()
    },
  )
  watch(
    () => submissionStore.trial.samplesRunAt.value,
    (at) => {
      if (!at) return
      sampledSinceSubmit = true
      lastActivity = Date.now()
      if (student()) logMascotEvent({ kind: 'trial', action: 'samples' })
    },
  )
  // 「运行例子」「自己输入」「举手」别处都不存，记下来给她看一周的习惯（behavior.ts）
  watch(
    () => submissionStore.trial.customRunning.value,
    (running) => {
      if (!running) return
      lastActivity = Date.now()
      if (student()) logMascotEvent({ kind: 'trial', action: 'custom' })
    },
  )
  watch(
    () => collabStore.helpStatus,
    (status, previous) => {
      if (status === 'pending' && previous === 'idle' && student()) logMascotEvent({ kind: 'help' })
    },
  )
  watch(
    () => submissionStore.submission?.id,
    (id) => {
      if (!id) return
      unsampledSubmits = sampledSinceSubmit ? 0 : unsampledSubmits + 1
      sampledSinceSubmit = false
      lastActivity = Date.now()
    },
  )

  // 判完了：错了就看要不要说一句；不管对错都刷新行为数（最近的错、今天做对几道）
  watch(
    () => [submissionStore.submission?.id, submissionStore.submission?.result] as const,
    ([id, result]) => {
      const problem = problemStore.problem
      if (!id || !FINISHED(result) || !problem || !student()) return
      refreshMascotProfile(true)
      const failed = RESULT_SITUATION[result as SubmissionStatus]
      if (!failed) return
      const { runSamples, help, why } = studentActions(problem)
      if (problemStore.failCount >= STUCK_FAILS) {
        requestSpeech({ key: `stuck:${problem.id}`, ...guide('problem.stuck', help, why) })
      } else if (unsampledSubmits >= UNSAMPLED_SUBMITS && runSamples) {
        requestSpeech({ key: `unsampled:${problem.id}`, ...guide('habit.noSamples', runSamples) })
      } else {
        const habit = habitSituation(failed)
        if (habit) requestSpeech({ key: `habit:${habit}`, ...guide(habit, why) })
      }
    },
  )

  // 盯着一道没做对的题 15 分钟，没交也没跑：问一句
  useIntervalFn(() => {
    const problem = problemStore.problem
    if (!problem || !student() || Date.now() - lastActivity < IDLE_MS) return
    if (problem.myStatus === SubmissionStatus.accepted || submissionStore.submission?.result === SubmissionStatus.accepted) return
    if (codeStore.code.language === 'Flowchart') return
    const { runSamples, help } = studentActions(problem)
    requestSpeech({ key: `idle:${problem.id}`, ...guide('idle.stuck', help, runSamples) })
  }, 30_000)
}
