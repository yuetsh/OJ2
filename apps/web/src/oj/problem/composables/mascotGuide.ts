import { useBreakpoints } from 'shared/composables/breakpoints'
import { useMascotGuide, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import { HINT_MIN_FAILURES, isFlowchartPass } from '@oj2/contract'
import { habitSituation, isPendingDaily, logMascotEvent, reactMascot, refreshMascotProfile, requestSpeech, spokenSpeechKeys } from 'shared/mascot/behavior'
import { lintCode, type LintIssue, type LintRule } from '../utils/codeLint'
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

/** 每条检查说哪组话。写成表而不是拼字符串：加了规则忘了写台词，这里编译不过 */
const LINT_SITUATION: Record<Exclude<LintRule, 'punct'>, MascotSituation> = {
  typo: 'lint.typo',
  printf: 'lint.printf',
  bareMethod: 'lint.bareMethod',
  inputPrompt: 'lint.inputPrompt',
  colon: 'lint.colon',
  assignInIf: 'lint.assignInIf',
  cOperator: 'lint.cOperator',
  shadowBuiltin: 'lint.shadowBuiltin',
  elseIf: 'lint.elseIf',
  keywordCase: 'lint.keywordCase',
  printStatement: 'lint.printStatement',
  noInt: 'lint.noInt',
  wrongLangC: 'lint.wrongLangC',
  wrongLangPython: 'lint.wrongLangPython',
  noInclude: 'lint.noInclude',
  undefinedName: 'lint.undefinedName',
  noPrint: 'lint.noPrint',
  unclosedBracket: 'lint.unclosedBracket',
  unclosedQuote: 'lint.unclosedQuote',
}

/** 连着敲了这么久代码（两次改动隔不到 TYPING_GAP_MS 算连着），她给加个油；加完隔 CHEER_COOLDOWN_MS 才有下一次 */
const TYPING_STREAK_MS = 60_000
const TYPING_GAP_MS = 8000
const CHEER_COOLDOWN_MS = 5 * 60_000

/** 停手这么久还有常见的错，她就说 */
const LINT_PAUSE_MS = 2000
/**
 * 错在光标那一行、而且可能只是还没写完的（if 写了一半在想条件、正要套 int()），多等一会儿；停手这么久
 * （从最后一次改动算）还是这样就说。中文标点、print = () 这类敲出来就是错的，不用等
 */
const LINT_EDITING_PAUSE_MS = 6000
const LINT_MAYBE_UNFINISHED = new Set<LintRule>(['colon', 'noInt'])
/** 这几种写到一半一定是这样（还没写到 print、括号引号还没关），不管在哪一行都等停手久一点 */
const LINT_ALWAYS_WAIT = new Set<LintRule>(['noPrint', 'unclosedBracket', 'unclosedQuote'])

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
const CHANCE = { classMany: 0.3, classFew: 0.5, rate: 0.4, hint: 0.5, challenge: 0.4, fish: 0.6 } as const
const roll = (chance: number) => Math.random() < chance

const FINISHED = (result: number | undefined) =>
  result !== undefined && result !== SubmissionStatus.pending && result !== SubmissionStatus.judging && result !== SubmissionStatus.submitting

/**
 * 题目页上看板娘说什么、给哪几个按钮。看的是这一页上最近的那件事：刚交的结果、刚跑的例子，
 * 都没有就看写没写代码。比赛入口不用管（Mascot.vue 在比赛里不弹）。
 *
 * 另外几件事她会主动开口（只对学生，频率上限在 Mascot.vue）：同一道题错到第 5 次、连着 3 次
 * 没跑例子就交还错了、又犯了自己的老毛病（behavior.ts 的 habitSituation）、15 分钟没交没跑。
 * 做对了也说（priority：不受频率上限管，等点评弹框关了再说）；第一次做对的题攒了一条小鱼干，多半说这个。
 * 代码里有常见的错（utils/codeLint.ts：中文标点、函数名拼错、input 带提示语、缺冒号……），停手 LINT_PAUSE_MS
 * 以后她滑到那一行旁边指出来，改得了的给「帮我改」；光标所在那一行还在写，不说。一次只说最靠前的一处，
 * 同一处只说一回。点她的时候有这类错也先说（多半就是交不过的原因）。
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

  /** 代码里现在还在的那几处错（按行排） */
  const currentIssues = () => lintCode(codeStore.code.value, codeStore.code.language)

  /**
   * 「帮我改」：按 key 在**当下的**代码里重新找那一处再改（说话到点按钮之间学生可能又改过）。
   * 协作中（举手了、老师在帮）不替学生改：编辑器正和对方同步
   */
  function fixAction(issue: LintIssue): MascotAction | null {
    if (!issue.fix || collabStore.helpStatus !== 'idle') return null
    return {
      label: issue.rule === 'punct' ? '帮我换掉' : '帮我改',
      run: () => {
        const now = currentIssues().find((it) => it.key === issue.key)
        if (now?.fix) codeStore.setCode(now.fix(codeStore.code.value))
      },
    }
  }

  /**
   * 编辑器里第几行在屏幕上的高度（行号那一格的中线）。CodeMirror 只画看得见的行，滚出去的拿不到，
   * 就是 null；行号栏里有一格看不见的占位（量宽度用的），跳过
   */
  function editorLineY(line: number) {
    for (const el of document.querySelectorAll<HTMLElement>('.problem-editor .cm-lineNumbers .cm-gutterElement')) {
      if (el.textContent !== String(line) || el.style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.height && rect.top >= 0 && rect.bottom <= window.innerHeight) return rect.top + rect.height / 2
    }
    return null
  }

  /** 光标所在的那一行（还在写），拿不到是 null */
  function activeLine() {
    const text = document.querySelector('.problem-editor .cm-lineNumbers .cm-activeLineGutter')?.textContent
    return text ? Number(text) : null
  }

  /** 指出一处错的那句话：中文标点一处、好几处分两组；别的按规则 lint.* */
  function lintGuide(issue: LintIssue): MascotGuide {
    const situation: MascotSituation =
      issue.rule === 'punct'
        ? Number(issue.vars.n) > 1
          ? 'problem.chinesePuncts'
          : 'problem.chinesePunct'
        : issue.rule === 'undefinedName' && issue.vars.right
          ? 'lint.undefinedNameGuess'
          : issue.rule === 'unclosedBracket' && issue.vars.kind === 'extra'
            ? 'lint.extraBracket'
            : LINT_SITUATION[issue.rule]
    const fix = fixAction(issue)
    return { situation, n: Number(issue.vars.n ?? 1), vars: { line: issue.line, ...issue.vars }, actions: fix ? [fix] : [] }
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

    const issue = currentIssues()[0]
    if (issue) return lintGuide(issue)

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

    // 这两种只说话、只留举手：上线第一天「做过了」的「下一道」没人点过，空着代码跑例子也没意义，
    // 而空白页上「举手求助」是真有人点（不会下手）。没有按钮的气泡 5 秒自己收起，不一直挡着
    if (problem.myStatus === SubmissionStatus.accepted) return guide('problem.solvedBefore')
    if (codeStore.code.value.trim().length < 10) return guide(entry.entry === 'problemset' ? 'problem.inSet' : 'problem.blank', help)
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
  /** 交这一次之前这道题做对过没有：没做对过的，这次做对就攒了一条小鱼干 */
  let solvedBeforeSubmit = false
  /** 交这一次的时候，这道是不是她今天挑的、还没做对的那道（判完 profile 会刷新，得先记下） */
  let dailyPending = false

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
      solvedBeforeSubmit = problemStore.problem?.myStatus === SubmissionStatus.accepted
      dailyPending = !!problemStore.problem && isPendingDaily(problemStore.problem._id)
    },
  )

  // 判完了：错了就看要不要说一句；不管对错都刷新行为数（最近的错、今天做对几道）
  watch(
    () => [submissionStore.submission?.id, submissionStore.submission?.result] as const,
    ([id, result]) => {
      const problem = problemStore.problem
      if (!id || !FINISHED(result) || !problem || !student()) return
      refreshMascotProfile(true)
      if (result === SubmissionStatus.accepted) {
        requestSpeech({ key: `ac:${problem.id}`, situation: acceptedSituation(problem._id), priority: true, cheer: true })
        return
      }
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

  /** 做对了说哪一组：新攒了小鱼干的多半说这个，不然看是不是全班第一个、一次就过、磨了好几次 */
  function acceptedSituation(problemId: string): MascotSituation {
    // 她今天挑的那道做对了：说好的多给两条
    if (dailyPending) return 'daily.solved'
    if (!solvedBeforeSubmit && roll(CHANCE.fish)) return 'problem.acceptedFish'
    const lesson = lessonStore.find(problemId)
    if (lesson && lesson.acceptedCount <= (lesson.myStatus === 'accepted' ? 1 : 0)) return 'class.firstSolver'
    const fails = problemStore.failCount
    return fails === 0 ? 'problem.firstTry' : fails >= FINALLY_FAILS ? 'problem.finally' : 'problem.accepted'
  }

  // 停手一会儿还有常见的错：指出最靠前的那处。错在光标那行的多等一会儿（LINT_EDITING_PAUSE_MS）；
  // 同一处一次页面会话只说一回（真说出口了才算，见 behavior.ts 的 spokenSpeechKeys）
  let editingTimer: ReturnType<typeof setTimeout> | undefined
  onScopeDispose(() => clearTimeout(editingTimer))
  watchDebounced(
    () => [codeStore.code.value, codeStore.code.language] as const,
    () => {
      clearTimeout(editingTimer)
      const problem = problemStore.problem
      if (!problem || !student()) return
      const editing = activeLine()
      const keyOf = (it: LintIssue) => `lint:${problem.id}:${it.key}`
      const fresh = currentIssues().filter((it) => !spokenSpeechKeys.has(keyOf(it)))
      const waitLonger = (it: LintIssue) => LINT_ALWAYS_WAIT.has(it.rule) || (it.line === editing && LINT_MAYBE_UNFINISHED.has(it.rule))
      const issue = fresh.find((it) => !waitLonger(it))
      if (!issue) {
        // 剩下的都可能还没写完：再等等，代码一直没动就说
        const code = codeStore.code.value
        if (fresh.length) editingTimer = setTimeout(() => codeStore.code.value === code && point(fresh[0]!), LINT_EDITING_PAUSE_MS - LINT_PAUSE_MS)
        return
      }
      point(issue)

      function point(issue: LintIssue) {
        requestSpeech({
          key: keyOf(issue),
          ...lintGuide(issue),
          priority: true,
          valid: () => currentIssues().some((it) => it.key === issue.key),
          anchorY: () => editorLineY(issue.line),
        })
      }
    },
    { debounce: LINT_PAUSE_MS },
  )

  // ---- 不说话的小动作：跑例子时凑过来看，判题时紧张，敲了好一阵代码加个油 ----
  watch(
    () => submissionStore.trial.samplesRunning.value,
    (running, was) => {
      if (!student()) return
      if (running) return reactMascot('curious')
      if (!was) return
      const runs = submissionStore.trial.sampleRuns.value
      const passed = runs.length > 0 && runs.every((run) => run.result === SubmissionStatus.accepted)
      reactMascot(passed ? 'yes' : 'sweat', 2500)
    },
  )
  watch(
    () => submissionStore.judging || submissionStore.pending,
    (busy, was) => {
      if (!student()) return
      if (busy) return reactMascot('fluster')
      if (!was) return
      // 做对了有欢呼（上面 priority 那句），这里只管收起；没做对难过一下
      const failed = RESULT_SITUATION[submissionStore.submission?.result as SubmissionStatus]
      reactMascot(failed ? 'sad' : null, 2500)
    },
  )
  let streakStart = 0
  let lastTyped = 0
  let cheeredAt = -Infinity
  watch(
    () => codeStore.code.value,
    () => {
      const now = Date.now()
      if (now - lastTyped > TYPING_GAP_MS) streakStart = now
      lastTyped = now
      if (!student() || now - streakStart < TYPING_STREAK_MS || now - cheeredAt < CHEER_COOLDOWN_MS) return
      cheeredAt = now
      streakStart = now
      reactMascot('cheer', 3000)
    },
  )
  onScopeDispose(() => reactMascot(null))

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
