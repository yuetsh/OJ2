import type { MascotEventInput, MascotProfile } from '@oj2/contract'
import api from 'utils/api'
import { useUserStore } from 'shared/store/user'
import type { MascotGuide } from './guide'
import type { MascotSituation } from './lines'

/**
 * 看板娘按学生的行为挑话：常犯哪类错、今天做了几道、和她熟不熟。数从 GET /mascot/profile 来，
 * 那边按库里的提交和互动记录算；互动本身经 logMascotEvent 记进 mascot_event。
 *
 * 只对学生。老师的话不跟着行为变。
 */

/** 记一条互动。只记登录了的，失败就算了：前台不等它、也不提示 */
export function logMascotEvent(event: Omit<MascotEventInput, 'path'>) {
  if (!useUserStore().isAuthed) return
  const body: MascotEventInput = { ...event, path: location.pathname.slice(0, 200) }
  if (body.line) body.line = body.line.slice(0, 100)
  api.post('mascot/events', body).catch(() => {})
}

export const mascotProfile = shallowRef<MascotProfile | null>(null)
let loadedAt = 0
let loading: Promise<void> | null = null
/** 进页面、交完一次都想要新的数，但别每次都打一遍 */
const STALE_MS = 30_000

export function refreshMascotProfile(force = false) {
  const userStore = useUserStore()
  if (!userStore.isAuthed || userStore.isTeacherOrAbove) {
    mascotProfile.value = null
    return null
  }
  if (loading) return loading
  if (!force && mascotProfile.value && Date.now() - loadedAt < STALE_MS) return null
  loading = api
    .get<MascotProfile>('mascot/profile')
    .then((profile) => {
      mascotProfile.value = profile
      loadedAt = Date.now()
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

/** 这一页会话里点开过几次：第一次见面那句只说一回，刚点过的也算熟了一点 */
let sessionPokes = 0
export function notePoke() {
  sessionPokes++
}

// 门槛按本机生产快照定的（2026-11，最近 120 天交过 10 次以上的 266 个学生）：最近 20 次里
// 运行出错 ≥3 的 87 人、答案错误 ≥5 的 82 人，各占三成；编译错误有提交前语法检查，≥3 的只有 7 人
const HABIT_MIN = { wrongAnswer: 5, compileError: 3, runtimeError: 3, timeout: 2 } as const
/** 有专门几句的运行错误类型，别的走 habit.runtimeError */
const NAMED_RUNTIME_ERRORS = new Set(['NameError', 'TypeError', 'ValueError', 'EOFError'])

/**
 * 这一类错是不是这个学生的老毛病：是就给对应的那组话，不是返回 null。
 * 题目页点她、交完错了她主动开口都走这里
 */
export function habitSituation(failure: MascotSituation): MascotSituation | null {
  const recent = mascotProfile.value?.recent
  if (!recent) return null
  switch (failure) {
    case 'problem.wrong':
      return recent.wrongAnswer >= HABIT_MIN.wrongAnswer ? 'habit.wrongAnswer' : null
    case 'problem.compileError':
      return recent.compileError >= HABIT_MIN.compileError ? 'habit.compileError' : null
    case 'problem.runtimeError': {
      if (recent.runtimeError < HABIT_MIN.runtimeError) return null
      const type = recent.runtimeErrorType
      return type && NAMED_RUNTIME_ERRORS.has(type) ? (`habit.${type}` as MascotSituation) : 'habit.runtimeError'
    }
    case 'problem.timeout':
      return recent.timeout >= HABIT_MIN.timeout ? 'habit.timeout' : null
    default:
      return null
  }
}

const HABIT_CHANCE = 0.6
const GENTLE_CHANCE = 0.5
const WEEK_CHANCE = 0.4
/** 点过这么多次「太难了」，错了就别怼了 */
const GENTLE_TOO_HARD = 3
/** 这一周交了这么多次、例子却跑得不到五分之一，才说她「从来不跑例子」 */
const WEEK_SUBMITS_MIN = 10
/** 这一周要了这么多次 AI 提示，就劝先自己想 */
const WEEK_HINTS_MANY = 5
const FAILURES = new Set<MascotSituation>(['problem.wrong', 'problem.compileError', 'problem.runtimeError', 'problem.timeout'])
const TODAY_CHANCE = 0.4
const FAMILIAR_CHANCE = 0.2
/** 点开过这么多次算老熟人 */
const FAMILIAR_POKES = 50
/** 今天做到这么多道才拿出来说 */
const TODAY_MIN = 3
const GREETINGS = new Set<MascotSituation>(['greet', 'announcement', 'achievement', 'profile'])
const PRAISE = new Set<MascotSituation>(['problem.accepted', 'problem.firstTry', 'problem.finally', 'home.done', 'home.assigned', 'home.free'])

/**
 * 好感档位：一共做对几道（含比赛题，和成就一个数）。点她多少次不算，脚本刷不上去。
 * 门槛按生产库定的（2026-11，最近 60 天交过题的 378 个学生）：做对 p25 是 14 道、中位 25、p75 37、p90 108，
 * 所以前四档大约各占四分之一，最高一档是前一成。档位不显示，学生自己感觉出来
 */
const AFFINITY_TIERS = [10, 25, 40, 100] as const
/** 0 是还不熟（没有额外的话），1～4 对应 lines.ts 的 affinity.1～4。老师、没拉到数都是 0 */
export function affinityTier() {
  return tierOf(mascotProfile.value?.solved ?? 0)
}
function tierOf(solved: number) {
  return AFFINITY_TIERS.filter((min) => solved >= min).length
}
const AFFINITY_CHANCE = 0.25
/** 掺好感台词的情况：闲聊、夸人，加上学生最常点她的空白题目页、题目列表（第一天点开的四成在这两处） */
const CHATTY = new Set<MascotSituation>([
  'greet',
  'announcement',
  'achievement',
  'profile',
  'problem.accepted',
  'problem.firstTry',
  'problem.finally',
  'problem.solvedBefore',
  'problem.blank',
  'problems',
  'home.done',
  'home.free',
])

/** 抽哪一档的话：自己那一档占一半，剩下一半在低几档里均分 */
function affinitySituation(tier: number): MascotSituation {
  const level = tier === 1 || Math.random() < 0.5 ? tier : 1 + Math.floor(Math.random() * (tier - 1))
  return `affinity.${level}` as MascotSituation
}

/** 这一页会话里翻过的旧账：说完到下次拉回新数之间别再说一遍 */
const memorySaid = new Set<'closer' | 'grudge' | 'pat'>()

function whenText(days: number) {
  return days === 1 ? '昨天' : days === 2 ? '前天' : '前几天'
}

/** 跨天记得的事，有就挑一件：今天升档 > 被惹生气 > 被摸头。每件只翻一次（后端看说没说过） */
function memoryGuide(profile: MascotProfile): Pick<MascotGuide, 'situation' | 'vars'> | null {
  const memory = profile.memory
  if (!memory.closerSaidToday && !memorySaid.has('closer') && tierOf(memory.solvedBeforeToday) < tierOf(profile.solved)) {
    memorySaid.add('closer')
    return { situation: 'memory.closer' }
  }
  if (memory.grudgeDaysAgo !== null && !memorySaid.has('grudge')) {
    memorySaid.add('grudge')
    return { situation: 'memory.grudge', vars: { when: whenText(memory.grudgeDaysAgo) } }
  }
  if (memory.patDaysAgo !== null && !memorySaid.has('pat')) {
    memorySaid.add('pat')
    return { situation: 'memory.pat', vars: { when: whenText(memory.patDaysAgo) } }
  }
  return null
}

/** 点她的时候：按行为把页面给的情况换成更贴这个学生的那一组（按钮不变） */
export function personalize(guide: MascotGuide): MascotGuide {
  const profile = mascotProfile.value
  if (!profile) return guide
  if (profile.pokes + sessionPokes === 0) return { ...guide, situation: 'first.meet', n: undefined, vars: undefined }
  const situation = guide.situation
  if (CHATTY.has(situation)) {
    const memory = memoryGuide(profile)
    if (memory) return { ...guide, ...memory, n: undefined }
  }
  // 常点「太难了」的，错了先软着说，不翻老毛病
  if (FAILURES.has(situation) && profile.tooHard >= GENTLE_TOO_HARD && Math.random() < GENTLE_CHANCE) return { ...guide, situation: 'gentle.wrong' }
  const week = profile.week
  if (situation === 'problem.stuck' && week.helps === 0 && Math.random() < WEEK_CHANCE) return { ...guide, situation: 'habit.neverHelp' }
  if (situation === 'problem.hintReady' && week.aiHints >= WEEK_HINTS_MANY) return { ...guide, situation: 'habit.aiHintMany', n: week.aiHints }
  if (
    (situation === 'problem.unsubmitted' || situation === 'problem.samplesFailed') &&
    week.submits >= WEEK_SUBMITS_MIN &&
    week.trials * 5 < week.submits &&
    Math.random() < WEEK_CHANCE
  ) {
    return { ...guide, situation: 'habit.weekNoSamples', n: week.submits }
  }
  const habit = habitSituation(guide.situation)
  if (habit && Math.random() < HABIT_CHANCE) return { ...guide, situation: habit }
  if (PRAISE.has(guide.situation) && profile.todaySolved >= TODAY_MIN && Math.random() < TODAY_CHANCE) {
    return { ...guide, situation: 'today.count', n: profile.todaySolved }
  }
  const tier = affinityTier()
  if (tier > 0 && CHATTY.has(guide.situation) && guide.n === undefined && !guide.vars && Math.random() < AFFINITY_CHANCE) {
    return { ...guide, situation: affinitySituation(tier) }
  }
  if (GREETINGS.has(guide.situation) && profile.pokes >= FAMILIAR_POKES && Math.random() < FAMILIAR_CHANCE) {
    return { ...guide, situation: 'familiar' }
  }
  return guide
}

// ---- 主动开口 ----

export interface MascotSpeech extends MascotGuide {
  /** 同一个 key 一次页面会话里只说一次（比如「这道题卡住了」每道题只说一回） */
  key: string
}

/** 页面请她主动说一句；说不说、什么时候说由 Mascot.vue 按频率上限定 */
export const speechRequest = shallowRef<MascotSpeech | null>(null)
export function requestSpeech(speech: MascotSpeech) {
  speechRequest.value = speech
}
