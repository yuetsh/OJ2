import { MASCOT_FISH_GIFT, MASCOT_OUTFIT_COSTS, MASCOT_OUTFIT_NONE, type MascotEventInput, type MascotOutfit, type MascotProfile } from '@oj2/contract'
import api from 'utils/api'
import { useUserStore } from 'shared/store/user'
import type { MascotGuide } from './guide'
import type { MascotSituation } from './lines'
import type { MascotPose } from './poses'

/**
 * 看板娘按人的行为挑话：常犯哪类错、今天做了几道、和她熟不熟。数从 GET /mascot/profile 来，
 * 那边按库里的提交和互动记录算；互动本身经 logMascotEvent 记进 mascot_event。
 *
 * 登录了的都有，学生、老师一套算法（老师也攒小鱼干、也有好感档）。老师专属的话（teacher.*）不跟着行为变，
 * 只有闲着打招呼那句（teacher.greet）会翻旧账、掺熟了以后的话。
 */

/** 记一条互动。只记登录了的，失败就算了：前台一般不等它、也不提示（换衣服要等它落库再拉数） */
export function logMascotEvent(event: Omit<MascotEventInput, 'path'>): Promise<void> {
  if (!useUserStore().isAuthed) return Promise.resolve()
  const body: MascotEventInput = { ...event, path: location.pathname.slice(0, 200) }
  if (body.line) body.line = body.line.slice(0, 100)
  return api.post('mascot/events', body).then(
    () => {},
    () => {},
  )
}

export const mascotProfile = shallowRef<MascotProfile | null>(null)
let loadedAt = 0
let loading: Promise<void> | null = null
/** 进页面、交完一次都想要新的数，但别每次都打一遍 */
const STALE_MS = 30_000

export function refreshMascotProfile(force = false) {
  const userStore = useUserStore()
  if (!userStore.isAuthed) {
    mascotProfile.value = null
    return null
  }
  if (loading) return loading
  if (!force && mascotProfile.value && Date.now() - loadedAt < STALE_MS) return null
  loading = api
    .get<MascotProfile>('mascot/profile')
    .then((profile) => {
      const userId = userStore.user?.id ?? null
      if (userId !== fishUserId) {
        fishUserId = userId
        fishBase = profile.fish.fed + profile.fish.spent
        usedLocally.value = 0
        outfitWorn.value = undefined
      }
      noteCollectReward(userId, profile.fish.collect)
      mascotProfile.value = profile
      loadedAt = Date.now()
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

// ---- 小鱼干 ----

/**
 * 用掉的数（喂的、换衣服花的）前台先记着：喂一条就发一条 feed 事件，不等它落库，接着拉回来的数
 * 可能还没算上刚喂的那条。所以按「拉到这个人的第一份数时已用的 + 这一页里用的」和后端的数取大的，
 * 数字不会往回跳
 */
let fishUserId: number | null = null
let fishBase = 0
const usedLocally = ref(0)

/** 手里还剩几条小鱼干（没登录、没拉到数是 0） */
export const fishLeft = computed(() => {
  const fish = mascotProfile.value?.fish
  if (!fish) return 0
  return Math.max(0, MASCOT_FISH_GIFT + fish.earned - Math.max(fish.fed + fish.spent, fishBase + usedLocally.value))
})

export function noteFed() {
  usedLocally.value++
}

/** 这一页里刚换的衣服（undefined 是没换过，按后端的数）；null 是换回平时那身 */
const outfitWorn = ref<string | null | undefined>(undefined)

/** 她今天穿的衣服，没换是 null */
export const mascotOutfit = computed(() => (outfitWorn.value !== undefined ? outfitWorn.value : (mascotProfile.value?.outfit ?? null)))

/** 换一身（null 是换回平时那身，不花鱼）。鱼不够的前台不让点，后端也会拦 */
export function dressMascot(outfit: MascotOutfit | null, line: string) {
  if (outfit) usedLocally.value += MASCOT_OUTFIT_COSTS[outfit]
  outfitWorn.value = outfit
  return logMascotEvent({ kind: 'dress', action: outfit ?? MASCOT_OUTFIT_NONE, line })
}

// ---- 图鉴到档的奖励 ----

/** 每个人这一页第一次拉到的图鉴奖励条数：之后涨了才是「刚集到新的一档」，第一次拉到的不算 */
let collectSeen: { userId: number | null; collect: number } | null = null
/** 刚多出来的图鉴奖励条数（Mascot.vue 看到了就说一句、清零） */
export const collectReward = ref(0)

function noteCollectReward(userId: number | null, collect: number) {
  if (collectSeen && collectSeen.userId === userId && collect > collectSeen.collect) collectReward.value += collect - collectSeen.collect
  collectSeen = { userId, collect }
}

/** 刚回答了她的问题：先记在手里的这份数上，不等下次拉（不然 30 秒内可能又问一遍） */
export function noteAnswer(questionId: string, key: string) {
  const profile = mascotProfile.value
  if (profile) mascotProfile.value = { ...profile, answers: { ...profile.answers, [questionId]: key } }
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
const GREETINGS = new Set<MascotSituation>(['greet', 'teacher.greet', 'announcement', 'achievement', 'profile'])
const PRAISE = new Set<MascotSituation>(['problem.accepted', 'problem.firstTry', 'problem.finally', 'home.done', 'home.assigned', 'home.free'])

/**
 * 好感档位：一共做对几道（含比赛题，和成就一个数）。点她多少次不算，脚本刷不上去。
 * 门槛按生产库定的（2026-11，最近 60 天交过题的 378 个学生）：做对 p25 是 14 道、中位 25、p75 37、p90 108，
 * 所以前四档大约各占四分之一，最高一档是前一成。档位不显示，学生自己感觉出来
 */
const AFFINITY_TIERS = [10, 25, 40, 100] as const
/** 0 是还不熟（没有额外的话），1～4 对应 lines.ts 的 affinity.1～4（老师听的是 MASCOT_TEACHER_LINES 里那一版）。没拉到数是 0 */
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
  'teacher.greet',
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

/**
 * 这一页会话里翻过的旧账：说完到下次拉回新数之间别再说一遍。真说出口了才记（noteMemorySaid），
 * 被生闷气、越点越烦顶掉的不算
 */
const memorySaid = new Set<MascotSituation>()
export function noteMemorySaid(situation: MascotSituation) {
  if (situation.startsWith('memory.')) memorySaid.add(situation)
}

/** 连着来到第几天才说 */
const STREAK_MIN = 3

function whenText(days: number) {
  return days === 1 ? '昨天' : days === 2 ? '前天' : '前几天'
}

/** 跨天记得的事，有就挑一件：今天升档 > 被惹生气 > 被摸头。每件只翻一次（后端看说没说过） */
function memoryGuide(profile: MascotProfile): Pick<MascotGuide, 'situation' | 'vars'> | null {
  const memory = profile.memory
  if (!memory.closerSaidToday && !memorySaid.has('memory.closer') && tierOf(memory.solvedBeforeToday) < tierOf(profile.solved)) {
    return { situation: 'memory.closer' }
  }
  if (memory.grudgeDaysAgo !== null && !memorySaid.has('memory.grudge')) {
    return { situation: 'memory.grudge', vars: { when: whenText(memory.grudgeDaysAgo) } }
  }
  if (memory.patDaysAgo !== null && !memorySaid.has('memory.pat')) {
    return { situation: 'memory.pat', vars: { when: whenText(memory.patDaysAgo) } }
  }
  if (memory.streakDays >= STREAK_MIN && !memory.streakSaidToday && !memorySaid.has('memory.streak')) {
    return { situation: 'memory.streak', vars: { n: memory.streakDays } }
  }
  return null
}

/** 点她的时候：按行为把页面给的情况换成更贴这个人的那一组（按钮不变） */
export function personalize(guide: MascotGuide): MascotGuide {
  const profile = mascotProfile.value
  // 有学生举着手：初次见面也先说这个
  if (!profile || guide.situation === 'teacher.help') return guide
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
  /**
   * 做对了这类要说的：不受主动开口的频率上限管，先换上高兴的图，等弹框（点评）关了再说，
   * 跟着换了页面也照说
   */
  priority?: boolean
  /** priority 的话：先换上欢呼的图（做对了用） */
  cheer?: boolean
  /** priority 的话要等一会儿才说：说之前再问一遍还算不算数（比如中文标点已经改掉了就不说了） */
  valid?: () => boolean
  /**
   * priority 的话说的是屏幕上某个地方（第几行代码）：给出那里的视口纵坐标，她滑到屏幕右边那个高度探头说，
   * 说完回原处。拿不到（滚出去了）是 null，就在原地说
   */
  anchorY?: () => number | null
}

/**
 * 主动说过的话（MascotSpeech.key）：同一个 key 一次页面会话只说一回。**真说出口了才记**（Mascot.vue）——
 * 等着开口的时候那处错已经改掉了、没说成的不算，下次再出现还会说。页面挑下一处要说的错时也看它
 */
export const spokenSpeechKeys = new Set<string>()

/** 页面请她主动说一句；说不说、什么时候说由 Mascot.vue 按频率上限定 */
export const speechRequest = shallowRef<MascotSpeech | null>(null)
export function requestSpeech(speech: MascotSpeech) {
  speechRequest.value = speech
}

// ---- 每天一道 ----

/** 这一页会话里提过今天的题没有（一天提一次就够，刷新页面会再提一次） */
let dailyOfferedFor: string | null = null

/** 今天挑的题还没做对、这一页还没提过：给出题号，同时记下「提过了」；不该提就是 null */
export function takeDailyOffer() {
  const daily = mascotProfile.value?.daily
  if (!daily || daily.done || dailyOfferedFor === daily.problemId) return null
  dailyOfferedFor = daily.problemId
  return daily.problemId
}

/** 这道题是不是她今天挑的、还没做对的那道（做对时说多给鱼的那句） */
export function isPendingDaily(problemId: string) {
  const daily = mascotProfile.value?.daily
  return !!daily && !daily.done && daily.problemId === problemId
}

// ---- 不说话的小动作 ----

/**
 * 页面让她摆一会儿的表情（不说话）：跑例子时凑过来看、判题时紧张、敲了好一阵代码给加个油。
 * 只在她闲着的时候摆：说着话、生着闷气、睡着了都不换（Mascot.vue 的 pose）
 */
export const mascotReaction = shallowRef<MascotPose | null>(null)
let reactionTimer: ReturnType<typeof setTimeout> | undefined

/** 摆这个表情；给了 ms 就过这么久收起，不给就一直摆到下一次调用（传 null 收起） */
export function reactMascot(pose: MascotPose | null, ms?: number) {
  clearTimeout(reactionTimer)
  mascotReaction.value = pose
  if (pose && ms) reactionTimer = setTimeout(() => (mascotReaction.value = null), ms)
}
