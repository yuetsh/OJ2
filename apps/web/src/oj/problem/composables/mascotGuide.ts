import { useBreakpoints } from 'shared/composables/breakpoints'
import { useMascotGuide, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import type { MascotSituation } from 'shared/mascot/lines'
import { useCollabStore } from 'shared/store/collab'
import { useLessonStore } from 'shared/store/lesson'
import { useUserStore } from 'shared/store/user'
import { useCodeStore } from 'oj/store/code'
import { useProblemStore } from 'oj/store/problem'
import { useSubmissionStore, type ResultSegment } from 'oj/store/submission'
import { SubmissionStatus } from 'utils/constants'
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

/**
 * 题目页上看板娘说什么、给哪几个按钮。看的是这一页上最近的那件事：刚交的结果、刚跑的例子，
 * 都没有就看写没写代码。比赛入口不用管（Mascot.vue 在比赛里不弹）。
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
    const busy = submissionStore.isFormatting || submissionStore.isSubmittingRequest || submissionStore.judging || submissionStore.isCooldown
    const submit: MascotAction | null = busy
      ? null
      : { label: '提交', run: () => submissionStore.submit({ contestId: entry.contestId, problemSetId: entry.problemSetId }) }

    const guide = (situation: MascotSituation, ...actions: (MascotAction | null)[]): MascotGuide => ({
      situation,
      actions: actions.filter((it): it is MascotAction => !!it),
    })

    if (language === 'Flowchart') return guide('problem.flowchart', help)
    // 正在判、正在跑例子：没什么好说的，打个招呼
    if (submissionStore.judging || submissionStore.pending || submissionStore.trial.samplesRunning.value) return null

    const stuck = problemStore.failCount >= STUCK_FAILS
    if (submissionStore.syntaxErrorInfo) return stuck ? guide('problem.stuck', help, why) : guide('problem.compileError', why, help)

    const runs = submissionStore.trial.sampleRuns.value
    if (submissionStore.resultSegment === 'samples' && runs.length) {
      return runs.every((run) => run.result === SubmissionStatus.accepted)
        ? guide('problem.samplesPassed', submit)
        : guide('problem.samplesFailed', { label: '我错在哪', run: () => showResult('samples') }, help)
    }

    const result = submissionStore.submission?.result
    if (result === SubmissionStatus.accepted) {
      const next = nextAction()
      const fails = problemStore.failCount
      return guide(fails === 0 ? 'problem.firstTry' : fails >= FINALLY_FAILS ? 'problem.finally' : 'problem.accepted', next)
    }
    const failed = result === undefined ? undefined : RESULT_SITUATION[result as SubmissionStatus]
    if (failed) return stuck ? guide('problem.stuck', help, why) : guide(failed, why, failed === 'problem.wrong' ? runSamples : null, help)

    if (problem.myStatus === SubmissionStatus.accepted) return guide('problem.solvedBefore', nextAction())
    if (codeStore.code.value.trim().length < 10) return guide(entry.entry === 'problemset' ? 'problem.inSet' : 'problem.blank', runSamples, help)
    return guide('problem.unsubmitted', runSamples, help)

    /** 做对之后去哪：专题里回专题，这节课里去下一道还没做的 */
    function nextAction(): MascotAction | null {
      if (entry.entry === 'problemset') return { label: '回专题', run: () => router.push(`/problemset/${entry.problemSetId}`) }
      const next = lessonStore.nextAfter(problem!._id)?.next
      return next ? { label: '下一道', run: () => router.push(`/problem/${next.problemDisplayId}`) } : null
    }
  })
}
