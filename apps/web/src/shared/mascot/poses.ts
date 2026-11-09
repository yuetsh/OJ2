import { TIME_ZONE_OFFSET_MINUTES } from '@oj2/contract'
import type { MascotSituation } from './lines'

/**
 * 看板娘的立绘：一个姿势一张图，按她当下在干什么、说的是哪一组话挑。
 *
 * 图取自 Sutera-Diffusus/dsh-whale-musume 的 assets/generated/（MIT，许可原文在
 * shared/assets/mascot/LICENSE），92 张用了 91 张：state-tool 那张跟别的不是一套画风，
 * 原图就带着绿幕抠图的残边和左右两块硬切的碎片，没要。原图 512×512 透明底、人物站位一致：
 * 统一裁掉左右各 48 像素、缩到 2 倍显示尺寸（288×354）转 webp；左右放不下的那十几张
 * （钓鱼竿、扫帚、课桌……）整体缩小后放进同样大的框，脚底对齐。三张探头图另裁，见 PEEK_SIZE。
 * 文件按姿势起名，不按原文件名：换形象时同名换图就行。
 *
 * 只有平时那张跟着页面一起下载，别的用到才下（Mascot.vue 先下好再换，不闪白）。
 */
const URLS = import.meta.glob<string>('../assets/mascot/*.webp', { eager: true, query: '?url', import: 'default' })

export type MascotPose =
  // 平时、打招呼
  | 'idle'
  | 'greet'
  | 'curious'
  | 'wave'
  | 'teasing'
  | 'wink'
  | 'bold'
  | 'playful'
  | 'excited'
  | 'running'
  // 被摆弄
  | 'lifted'
  | 'tail-grabbed'
  | 'patted'
  | 'giggle'
  | 'blush'
  | 'heart'
  | 'touched'
  | 'dizzy'
  // 越点越烦
  | 'doubt'
  | 'unimpressed'
  | 'angry'
  | 'fuming'
  // 做对了
  | 'happy'
  | 'thumbs'
  | 'yes'
  | 'deploy'
  | 'smug'
  | 'smirk'
  | 'cool'
  | 'cheer'
  | 'party'
  | 'done'
  | 'sweep'
  | 'star'
  | 'trophy'
  | 'worship'
  | 'levelup'
  | 'achievement'
  // 做错了、卡住了
  | 'sad'
  | 'lose'
  | 'broke'
  | 'empty'
  | 'cry'
  | 'fluster'
  | 'omg'
  | 'shock'
  | 'ram'
  | 'sweat'
  | 'thinking'
  | 'ponder'
  | 'idea'
  | 'waiting'
  | 'melt'
  | 'calm'
  | 'debug'
  | 'review'
  | 'sneak'
  // 老师那边
  | 'lecture'
  // 时间
  | 'coffee'
  | 'eat'
  | 'snack'
  | 'sleepy'
  | 'hurry'
  | 'night'
  | 'pajama'
  | 'stretch'
  | 'nap-desk'
  | 'nap-laptop'
  // 闲着的日常
  | 'cooking'
  | 'fishing'
  | 'gaming'
  | 'painting'
  | 'picnic'
  | 'bath'
  | 'music'
  | 'tail-swing'
  | 'phone'
  | 'slack'
  // 季节
  | 'snow'
  | 'cold'
  | 'umbrella'
  | 'rain'
  | 'thunder'
  // 节日装
  | 'festival-spring'
  | 'festival-mid-autumn'
  | 'festival-christmas'
  | 'festival-halloween'
  | 'festival-valentine'
  // 缩在屏幕边上只探个头
  | 'peek-bottom'
  | 'peek-left'
  | 'peek-right'

export function poseUrl(pose: MascotPose): string {
  return URLS[`../assets/mascot/${pose}.webp`] ?? URLS['../assets/mascot/idle.webp']!
}

/** 探头图的显示尺寸（图是这个的 2 倍）。下边那张是头和扒着边的手，左右两张是半个身子 */
export const PEEK_SIZE = {
  bottom: { width: 150, height: 132 },
  left: { width: 88, height: 177 },
  right: { width: 82, height: 177 },
} as const

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

/** 说哪一组话时摆哪个姿势；给了几张的随机挑一张。没列的就是平时那张 */
const SITUATION_POSE: Partial<Record<MascotSituation, readonly MascotPose[]>> = {
  // 打招呼、问路
  greet: ['greet', 'wave', 'slack'],
  'first.meet': ['greet'],
  'teacher.greet': ['greet', 'wave'],
  'home.back': ['cry', 'greet'],
  guest: ['curious'],
  problems: ['curious'],
  notFound: ['curious', 'sweep'],
  announcement: ['curious'],
  'home.newAnnouncement': ['curious'],
  submissions: ['curious', 'sneak'],
  'submission.detail': ['debug', 'review'],
  'contests.none': ['curious'],
  'teacher.problem': ['curious', 'review'],
  // 傲娇怼人、催着跑例子
  'problem.unsubmitted': ['teasing'],
  'problem.solvedBefore': ['teasing', 'unimpressed'],
  'habit.noSamples': ['teasing'],
  'habit.weekNoSamples': ['teasing'],
  'home.assigned': ['teasing'],
  'teacher.home.unassigned': ['teasing', 'empty'],
  rank: ['teasing'],
  'rank.gap': ['teasing', 'running'],
  profile: ['teasing', 'smirk'],
  'home.free': ['wink', 'playful'],
  tutorial: ['wink', 'lecture'],
  'learn.continue': ['wink'],
  'learn.fresh': ['wink', 'lecture'],
  'affinity.1': ['wink', 'playful'],
  'affinity.2': ['wink', 'playful'],
  'problem.samplesPassed': ['yes', 'deploy'],
  'problem.challenge': ['bold'],
  'contests.live': ['bold', 'running'],
  'home.contestSoon': ['excited'],
  pk: ['bold', 'playful'],
  // 越点越烦
  'pester.mild': ['doubt', 'unimpressed'],
  familiar: ['doubt', 'unimpressed'],
  'habit.aiHintMany': ['doubt'],
  'problem.easyWrong': ['doubt'],
  'habit.neverHelp': ['doubt'],
  'pester.angry': ['angry'],
  // 快点到嫌烦是被点晕了；背过身那会儿冒黑气
  overclick: ['dizzy'],
  sulk: ['fuming'],
  'memory.grudge': ['angry'],
  // 被摸完头
  patting: ['blush', 'heart', 'touched'],
  // 做对了
  'problem.accepted': ['happy', 'thumbs'],
  'problem.finally': ['happy', 'cheer'],
  'home.done': ['done', 'sweep'],
  'tutorial.passed': ['happy', 'thumbs'],
  'flowchart.good': ['happy', 'cool'],
  'today.count': ['happy', 'thumbs'],
  'problem.firstTry': ['smug', 'smirk', 'cool'],
  'rank.top': ['trophy'],
  'class.firstSolver': ['cheer'],
  'problemset.done': ['party'],
  'home.knowledgeUp': ['levelup'],
  achievement: ['achievement'],
  'achievement.near': ['star'],
  'problemset.lastOne': ['star'],
  'home.knowledgeNext': ['star'],
  // 做错了、卡住了
  'problem.wrong': ['sad', 'lose'],
  'problem.samplesFailed': ['sad', 'lose'],
  'flowchart.low': ['sad', 'broke'],
  'class.manyDone': ['sad'],
  'learn.wrongExercise': ['sad'],
  'problem.compileError': ['fluster', 'omg'],
  'problem.runtimeError': ['shock', 'ram'],
  'problem.timeout': ['shock', 'sweat'],
  'teacher.help': ['shock'],
  rare: ['shock', 'thumbs'],
  'problem.blank': ['thinking', 'ponder'],
  'problem.inSet': ['thinking', 'ponder'],
  'problem.flowchart': ['thinking'],
  'idle.stuck': ['thinking', 'ponder'],
  'problem.hardWrong': ['thinking'],
  'class.fewDone': ['thinking'],
  'problem.hintReady': ['idea'],
  'problemsets.unfinished': ['waiting', 'empty'],
  'problemset.unfinished': ['waiting'],
  'teacher.task.assigned': ['waiting', 'lecture'],
  'teacher.task.unassigned': ['empty'],
  'teacher.problems': ['review'],
  'teacher.task.errorPile': ['debug', 'review'],
  'teacher.task.stuck': ['sweat', 'thinking'],
  'teacher.task.stuckRise': ['shock', 'omg'],
  'teacher.task.idle': ['unimpressed', 'sleepy'],
  'teacher.task.idleOne': ['unimpressed', 'sleepy'],
  'teacher.task.allDone': ['party', 'cheer'],
  'teacher.task.challenging': ['bold', 'playful'],
  'teacher.home.progress': ['review'],
  'teacher.home.progressDone': ['done', 'party'],
  'teacher.submissions': ['review', 'sweat'],
  'teacher.statistics': ['review'],
  // 软下来的时候
  'affinity.3': ['blush', 'touched'],
  'affinity.4': ['worship'],
  'memory.closer': ['blush'],
  'memory.pat': ['blush'],
  'sulk.forgive': ['blush', 'touched'],
  'gentle.wrong': ['calm'],
  'problem.stuck': ['blush', 'melt'],
  // 时间彩蛋
  'time.firstClass': ['coffee'],
  'time.lunch': ['eat', 'snack'],
  'time.afternoon': ['sleepy'],
  'time.lastClass': ['hurry'],
  offHours: ['night', 'pajama'],
  wake: ['stretch'],
  // 闲聊（跟手上那件事配套的 chat.pose.*、梦话 chat.sleep 不换图，接着摆当时那张）
  'chat.self': ['slack', 'tail-swing', 'phone', 'curious'],
  'chat.hungry': ['eat', 'snack'],
  'chat.sleepy': ['sleepy'],
  'chat.trivia': ['idea', 'lecture'],
  'chat.season.autumn': ['stretch', 'curious'],
  'chat.season.winter': ['cold', 'snow'],
  'chat.season.spring': ['picnic', 'umbrella'],
  'chat.season.summer': ['melt', 'thunder'],
  // 被摆弄
  'play.fling': ['dizzy'],
  'play.shake': ['dizzy'],
  'play.tickle': ['giggle'],
}

/** 老毛病那几组（habit.NameError …）没一一列，统一是不耐烦的那张 */
export function situationPose(situation: MascotSituation): MascotPose {
  const poses = SITUATION_POSE[situation]
  if (poses) return pick(poses)
  return situation.startsWith('habit.') ? 'doubt' : 'idle'
}

// ---- 没人理她的时候 ----

/** 闲着随机换的日常（每张都有一组 chat.pose.* 的话，chat.ts 按这个对） */
export const DAILY: readonly MascotPose[] = [
  'cooking',
  'fishing',
  'gaming',
  'painting',
  'picnic',
  'bath',
  'music',
  'tail-swing',
  'phone',
  'slack',
  'snack',
  'sweep',
]

/**
 * 闲着时换哪一张：日常里随机一张，按月份掺上季节的（冬天下雪、怕冷，春夏打伞、踩水，盛夏怕打雷），
 * 晚上和周末掺睡衣
 */
export function dailyPose(now = Date.now(), offHours = false): MascotPose {
  const month = new Date(now + TIME_ZONE_OFFSET_MINUTES * 60_000).getUTCMonth() + 1
  const pool: MascotPose[] = [...DAILY]
  if (month === 12 || month <= 2) pool.push('snow', 'cold')
  if (month >= 4 && month <= 6) pool.push('umbrella', 'rain')
  if (month >= 7 && month <= 8) pool.push('thunder')
  if (offHours) pool.push('pajama', 'night')
  return pick(pool)
}

/** 好久没人理就睡着了 */
export function napPose(): MascotPose {
  return pick(['nap-desk', 'nap-laptop', 'sleepy'] as const)
}

/**
 * 农历节日的公历日期（春节是正月初一，中秋是八月十五），只能查表。用完了往后补几年，
 * 没补上的年份就是不换装，不会出错
 */
const SPRING: Record<number, string> = { 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03' }
const MID_AUTUMN: Record<number, string> = { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12' }
const DAY_MS = 86_400_000

/** 东八区的「月-日」和日序号 */
function wallDay(ms: number) {
  const wall = new Date(ms + TIME_ZONE_OFFSET_MINUTES * 60_000)
  return { year: wall.getUTCFullYear(), md: wall.toISOString().slice(5, 10), day: Math.floor(wall.getTime() / DAY_MS) }
}

/** 离某个农历节日的当天差几天（今天在它前面是负数），这一年没查到就是 null */
function offsetFrom(table: Record<number, string>, now: number) {
  const { year, day } = wallDay(now)
  const md = table[year]
  if (!md) return null
  return day - Math.floor(Date.parse(`${year}-${md}T00:00:00Z`) / DAY_MS)
}

/**
 * 节日当天平时那张换成节日装。春节是除夕到元宵（放寒假了，回来做题的才看得到），
 * 中秋是前一天和当天（放假前最后一天在学校），别的就是那一天
 */
export function festivalPose(now = Date.now()): MascotPose | null {
  const { md } = wallDay(now)
  if (md === '02-14') return 'festival-valentine'
  if (md === '10-31') return 'festival-halloween'
  if (md === '12-24' || md === '12-25') return 'festival-christmas'
  const spring = offsetFrom(SPRING, now)
  if (spring !== null && spring >= -1 && spring <= 14) return 'festival-spring'
  const midAutumn = offsetFrom(MID_AUTUMN, now)
  if (midAutumn !== null && midAutumn >= -1 && midAutumn <= 0) return 'festival-mid-autumn'
  return null
}
