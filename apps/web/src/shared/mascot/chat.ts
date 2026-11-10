import { TIME_ZONE_OFFSET_MINUTES } from '@oj2/contract'
import { MASCOT_LINES, type MascotSituation } from './lines'
import { pick, type MascotPose } from './poses'

/**
 * 闲聊：没人点她的时候，她隔几分钟自己说一句（节奏在 Mascot.vue 的 CHAT_GAP_*）。
 * 这里只管说哪一种：跟手上在做的事配套的、自言自语、饿了困了、季节、冷知识、问同学一个问题、
 * 翻出同学以前的回答。按情况说的正事（错了、卡住了）走题目页的 requestSpeech，比闲聊优先。
 *
 * 学生、老师都聊。老师那边把编程冷知识换成课堂上的闲话（teacher.chat），问的问题也有几道不一样（MascotQuestion.only）。
 */

export interface MascotQuestion {
  /** 记进 mascot_event 的 situation 是 `ask.<id>`，改了就认不出以前的回答，别改 */
  id: string
  text: string
  /** 只问学生 / 只问老师；不写就都问 */
  only?: 'student' | 'teacher'
  /** 两三个选项。key 落库，别改；label 是按钮上的字 */
  options: readonly {
    key: string
    label: string
    /** 选完她接的话 */
    reply: readonly string[]
    /** 以后翻出来说 */
    recall: readonly string[]
    /** 接话时摆的姿势，不写就是平时那张 */
    pose?: MascotPose
  }[]
}

export const MASCOT_QUESTIONS: readonly MascotQuestion[] = [
  {
    id: 'language',
    text: 'C 和 Python，你喜欢哪个？',
    options: [
      { key: 'c', label: 'C', reply: ['分号别忘了', '哼，硬核'], recall: ['你说过喜欢 C 的，今天分号齐了吗', '喜欢 C 的人，大括号配对了没'] },
      {
        key: 'python',
        label: 'Python',
        reply: ['缩进对齐就是好朋友', '我也觉得'],
        recall: ['你说喜欢 Python 的，缩进今天对齐了吗', 'Python 派的，今天也写得很短吧'],
      },
      {
        key: 'neither',
        label: '都不喜欢',
        reply: ['那你天天来干嘛', '嘴硬'],
        recall: ['说不喜欢编程的人，今天又来了', '都不喜欢还做这么多题？'],
        pose: 'doubt',
      },
    ],
  },
  {
    id: 'name',
    text: '你平时叫我什么？',
    options: [
      { key: 'whale', label: '小鲸鱼', reply: ['嗯，乖', '这还差不多'], recall: ['你叫我小鲸鱼的，记得'], pose: 'blush' },
      {
        key: 'fat',
        label: '大肥鱼',
        reply: ['你再说一遍？！', '谁肥了！', '我记住你了'],
        recall: ['上次叫我大肥鱼的是你吧', '大肥鱼的账还没算呢'],
        pose: 'angry',
      },
    ],
  },
  {
    id: 'pet',
    text: '猫和狗，喜欢哪个？',
    options: [
      { key: 'cat', label: '猫', reply: ['……猫吃鱼的', '离我远点'], recall: ['喜欢猫的，离我远点', '你家猫吃鱼吗……别告诉我'], pose: 'shock' },
      { key: 'dog', label: '狗', reply: ['狗还行，不吃鱼', '还挺乖'], recall: ['喜欢狗的，今天也很老实', '你说喜欢狗的'] },
      { key: 'whale', label: '鲸鱼', reply: ['……算你有眼光', '哼，知道就好'], recall: ['你说最喜欢鲸鱼的……我记着呢'], pose: 'blush' },
    ],
  },
  {
    id: 'sleep',
    text: '昨晚几点睡的？',
    options: [
      { key: 'early', label: '十一点前', reply: ['乖', '怪不得精神'], recall: ['早睡的那个，今天也早点睡'] },
      { key: 'late', label: '半夜', reply: ['怪不得这么困', '熬夜会变笨的'], recall: ['昨晚又熬夜了？', '你说你半夜睡的，今天早点'], pose: 'unimpressed' },
    ],
  },
  {
    id: 'hard',
    only: 'student',
    text: '这里的题，你觉得难吗？',
    options: [
      { key: 'easy', label: '不难', reply: ['口气不小', '那多做几道'], recall: ['说题不难的，今天做了几道', '不是说不难吗'], pose: 'smirk' },
      { key: 'hard', label: '有点难', reply: ['难就对了，慢慢来', '不会就举手，不丢人'], recall: ['觉得难的话，先挑简单的', '你说有点难的……现在呢'] },
    ],
  },
  {
    id: 'break',
    only: 'student',
    text: '下课一般干嘛？',
    options: [
      { key: 'game', label: '玩游戏', reply: ['带我一个', '玩完记得做题'], recall: ['下课又要去玩游戏了吧'], pose: 'gaming' },
      { key: 'sleep', label: '趴着睡', reply: ['我也想', '睡饱了再来'], recall: ['下课又要趴着睡了吧'], pose: 'sleepy' },
      { key: 'code', label: '接着做题', reply: ['骗鬼呢', '……真的假的'], recall: ['说下课也做题的，今天做了吗'], pose: 'doubt' },
    ],
  },
  {
    id: 'season',
    text: '冬天和夏天，你喜欢哪个？',
    options: [
      { key: 'winter', label: '冬天', reply: ['可以堆雪人', '冷死了还喜欢'], recall: ['喜欢冬天的，今天冷不冷'], pose: 'snow' },
      { key: 'summer', label: '夏天', reply: ['有西瓜吃', '热死了还喜欢'], recall: ['喜欢夏天的，还要等好久呢'], pose: 'picnic' },
    ],
  },
  {
    id: 'job',
    only: 'student',
    text: '以后想当程序员吗？',
    options: [
      { key: 'yes', label: '想', reply: ['那题得多做点', '有志气'], recall: ['想当程序员的，今天的题做了吗', '未来的程序员，加油……随口说的'], pose: 'bold' },
      { key: 'no', label: '不想', reply: ['那想干嘛', '也行，会一点总没坏处'], recall: ['不想当程序员也来做题，行吧'] },
      { key: 'unsure', label: '还没想好', reply: ['慢慢想，不急', '先把题做了'], recall: ['想好以后干嘛了没'], pose: 'ponder' },
    ],
  },
  {
    id: 'mood',
    text: '今天心情怎么样？',
    options: [
      { key: 'good', label: '还行', reply: ['那就好', '我也还行'], recall: ['上次你说心情还行，今天呢'] },
      { key: 'bad', label: '不太好', reply: ['……我陪你一会儿', '做道简单的，换换心情'], recall: ['上次你说心情不好，现在好点没'], pose: 'touched' },
    ],
  },
  // ---- 只问老师的 ----
  {
    id: 'kids',
    only: 'teacher',
    text: '今天的学生听话吗？',
    options: [
      { key: 'good', label: '听话', reply: ['难得', '那就好，省心'], recall: ['上次说学生听话，今天呢', '学生还听话吧'] },
      {
        key: 'bad',
        label: '不听话',
        reply: ['……辛苦了', '我帮你盯着，谁摸鱼我都知道'],
        recall: ['上次说学生不听话，今天好点没', '不听话的那几个，今天交题了吗'],
        pose: 'unimpressed',
      },
    ],
  },
  {
    id: 'tired',
    only: 'teacher',
    text: '上一天课，累不累？',
    options: [
      {
        key: 'yes',
        label: '累',
        reply: ['坐会儿，喝口水', '……辛苦了，随口说的'],
        recall: ['上次说上课累，今天少讲两句', '累了就让学生自己做题，我看着'],
        pose: 'touched',
      },
      { key: 'no', label: '还行', reply: ['嘴硬', '那再加一节？'], recall: ['上次说不累的，今天还撑得住吗'], pose: 'smirk' },
    ],
  },
  {
    id: 'teach',
    only: 'teacher',
    text: '教 C 和教 Python，哪个省心？',
    options: [
      { key: 'c', label: 'C', reply: ['分号、大括号，你不嫌烦？', '硬核'], recall: ['你说教 C 省心的，今天学生漏分号了吗'] },
      { key: 'python', label: 'Python', reply: ['缩进错的也不少吧', '我也觉得'], recall: ['你说教 Python 省心的，今天缩进都对齐了吗'] },
      { key: 'neither', label: '都不省心', reply: ['……辛苦了', '学生也这么想'], recall: ['上次说教哪个都不省心，今天呢'], pose: 'sweat' },
    ],
  },
]

export type MascotChat =
  /** 说一句。keepPose：接着摆当时那张（日常、睡着），不换说这组话的图 */
  | { type: 'line'; situation: MascotSituation; keepPose?: boolean }
  /** 问一个问题，按钮是选项 */
  | { type: 'ask'; question: MascotQuestion }
  /** 翻出以前的回答说一句 */
  | { type: 'recall'; text: string; pose?: MascotPose }

interface ChatContext {
  /** 闲着时换上的那张，没换就是 null */
  idlePose: MascotPose | null
  napping: boolean
  /** 好感档位 0～4（behavior.ts） */
  tier: number
  todaySolved: number
  /** 穿着同学拿小鱼干换的衣服 */
  dressed: boolean
  /** 问过的问题和回答（id → 选项键）；还没拉到就是 null，这时不问也不翻 */
  answers: Record<string, string> | null
  /** 在跟老师聊 */
  teacher: boolean
}

/** 东八区的月份、钟点 */
function wallClock() {
  const wall = new Date(Date.now() + TIME_ZONE_OFFSET_MINUTES * 60_000)
  return { month: wall.getUTCMonth() + 1, hour: wall.getUTCHours() }
}

function seasonSituation(month: number): MascotSituation {
  if (month === 12 || month <= 2) return 'chat.season.winter'
  if (month <= 5) return 'chat.season.spring'
  if (month <= 8) return 'chat.season.summer'
  return 'chat.season.autumn'
}

function weighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0)
  let r = Math.random() * total
  for (const [item, w] of items) {
    r -= w
    if (r < 0) return item
  }
  return items[items.length - 1]![0]
}

/** 这一回闲聊说什么 */
export function chooseChat(ctx: ChatContext): MascotChat {
  if (ctx.napping) return { type: 'line', situation: 'chat.sleep', keepPose: true }
  // 换上了日常那张：多半说手上这件事
  const posed = ctx.idlePose ? (`chat.pose.${ctx.idlePose}` as MascotSituation) : null
  if (posed && posed in MASCOT_LINES && Math.random() < 0.7) return { type: 'line', situation: posed, keepPose: true }

  const { month, hour } = wallClock()
  const questions = MASCOT_QUESTIONS.filter((q) => !q.only || q.only === (ctx.teacher ? 'teacher' : 'student'))
  const unasked = ctx.answers ? questions.filter((q) => !(q.id in ctx.answers!)) : []
  const answered = ctx.answers ? questions.filter((q) => q.id in ctx.answers!) : []
  type Kind = 'self' | 'hungry' | 'sleepy' | 'season' | 'trivia' | 'ask' | 'recall' | 'affinity' | 'today' | 'outfit'
  const kind = weighted<Kind>([
    ['self', 20],
    ['hungry', hour >= 11 && hour < 13 ? 20 : hour >= 16 ? 10 : 4],
    ['sleepy', hour >= 13 && hour < 15 ? 15 : 4],
    ['season', 6],
    ['trivia', 22],
    ['ask', unasked.length ? 18 : 0],
    ['recall', answered.length ? 8 : 0],
    ['affinity', ctx.tier > 0 ? 10 : 0],
    ['today', ctx.todaySolved >= 3 ? 6 : 0],
    ['outfit', ctx.dressed ? 12 : 0],
  ])
  switch (kind) {
    case 'hungry':
      return { type: 'line', situation: 'chat.hungry' }
    case 'sleepy':
      return { type: 'line', situation: 'chat.sleepy' }
    case 'season':
      return { type: 'line', situation: seasonSituation(month) }
    case 'trivia':
      return { type: 'line', situation: ctx.teacher ? 'teacher.chat' : 'chat.trivia' }
    case 'ask':
      return { type: 'ask', question: pick(unasked) }
    case 'recall': {
      const question = pick(answered)
      const option = question.options.find((it) => it.key === ctx.answers![question.id])
      if (option) return { type: 'recall', text: pick(option.recall), pose: option.pose }
      return { type: 'line', situation: 'chat.self' }
    }
    case 'affinity':
      return { type: 'line', situation: `affinity.${ctx.tier}` as MascotSituation }
    case 'today':
      return { type: 'line', situation: 'today.count' }
    case 'outfit':
      return { type: 'line', situation: 'chat.outfit', keepPose: true }
    default:
      return { type: 'line', situation: 'chat.self' }
  }
}
