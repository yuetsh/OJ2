<script setup lang="ts">
/**
 * 看板娘，兼站内的引导员。现在只有一个形象（鲸鱼娘，全身 Q 版）。
 *
 * 立绘一个姿势一张，取自 Sutera-Diffusus/dsh-whale-musume（MIT），哪种情况摆哪个姿势、
 * 节日换装都在 shared/mascot/poses.ts。平时那张跟页面一起下，别的用到才下，下好再换。
 *
 * - 常驻在前台页面的角落，能拖；松手按「四分之一区」贴边：中心落在左/右四分之一就贴左/右缘，
 *   上/下四分之一就贴上/下缘，中间保持松手的位置。两个方向各判各的，所以能贴进角落。
 * - 在屏幕左半边时整体镜像，脸总朝着页面中间。
 * - 按下去像玩偶一样压扁（底边不动），松手弹回。
 * - 点一下冒气泡：一句话加最多三个按钮，按页面、按情况变（页面经 shared/mascot/guide.ts 告诉她），
 *   台词在 shared/mascot/lines.ts。比赛里点她不弹气泡。再点一下、点别处、换页面都收起。
 * - 对学生按行为挑话（常犯的错、今天做了几道、熟不熟，见 shared/mascot/behavior.ts）。好感按一共做对几道分五档，
 *   高档多几组软一点的话、也更耐烦（档位不显示）。跨天记得几件事（前几天惹她生气、摸过头、今天升了档），
 *   今天第一次闲聊时翻一次旧账；
 *   题目页上有几件事她会主动开口，频率上限在下面 SPEAK_GAP_MS。
 * - 闲聊：对学生，没人理她时隔 CHAT_GAP_* 自己说一句（说什么见 shared/mascot/chat.ts），会问同学问题、
 *   带按钮回答。正在敲键盘、刚冒过气泡、比赛里都不说；睡着了说梦话，不醒。
 * - 摆弄：拖着一甩松手会飞出去，撞边回弹、落到底边晕一会儿；拎着来回摇会被摇晕；鼠标不按键在她身上
 *   来回蹭是挠痒；藏在屏幕边上被点到，说「被发现了」。
 * - 互动都记进 mascot_event（点开、点按钮、主动开口、摸头、嫌烦、被拖走）。
 * - 一句一句地刷（两次点开隔不到 BURST_GAP_MS）：第 3 次起不耐烦、第 5 次起炸毛、第 7 次背过身去，
 *   生 SULK_MS 的闷气，这期间点她只蹦不说话。生闷气时连点摸到头就哄好了。上线第一天六成的点开
 *   离上一次不到 15 秒，学生是在刷台词，所以台词也按副牌抽（pick），一组听完才会重复。
 * - 姿势：被拖着是「被拎起来」，被摸头是「被摸」那张加上一下一下揉的动作，冒气泡时按说的那组话换，
 *   生闷气时冒黑气。
 * - 彩蛋：连着快点，有时候（每轮三分之一的机会）点到第 4～8 下（也是随机的）会被摸摸头，摸的时候接着点就一直摸。
 *
 * 位置只是这台电脑上的个人偏好，存 localStorage（读写都包 try/catch，拿不到就用默认位置）。
 * 定位一律用 transform 的像素值：贴右缘时若换成 right:0，过渡没法在 auto 和数值之间插值，会瞬移。
 */
import { TIME_ZONE_OFFSET_MINUTES } from '@oj2/contract'
import { dailyPose, festivalPose, napPose, PEEK_SIZE, pick as pickOne, poseUrl, situationPose, type MascotPose } from 'shared/mascot/poses'
import { MASCOT_LINES, type MascotSituation } from 'shared/mascot/lines'
import { chooseChat, type MascotQuestion } from 'shared/mascot/chat'
import { currentMascotGuide, fillLine, mascotBox, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import {
  affinityTier,
  logMascotEvent,
  mascotProfile,
  noteAnswer,
  noteMemorySaid,
  notePoke,
  personalize,
  refreshMascotProfile,
  speechRequest,
} from 'shared/mascot/behavior'
import { useAuthModalStore } from 'shared/store/authModal'
import { useCollabStore } from 'shared/store/collab'
import { useUserStore } from 'shared/store/user'

const WIDTH = 144
const HEIGHT = 177 // 图是 288×354
const MARGIN = 12
const TOP_GAP = 72 // 贴上缘时让开顶栏
const STORAGE_KEY = 'oj-mascot'
const PAT_MS = 1200
// 每轮连点先抽这一轮有没有彩蛋，有的话再抽连点到第几下出。都猜不准才像彩蛋
const PAT_CHANCE = 1 / 3
const PAT_CLICKS_MIN = 4
const PAT_CLICKS_MAX = 8
function rollPatClicks() {
  if (Math.random() >= PAT_CHANCE) return Infinity // 这一轮怎么点都只是蹦
  return PAT_CLICKS_MIN + Math.floor(Math.random() * (PAT_CLICKS_MAX - PAT_CLICKS_MIN + 1))
}
const STREAK_GAP_MS = 600 // 两下之间超过这么久就不算连点
const OVERCLICK = 8 // 一轮连点到这么多下还没摸到头，她就嫌烦了
const QUIET_BUBBLE_MS = 5000 // 没有按钮的气泡（只是一句话）过这么久自己收起
const SPOKEN_BUBBLE_MS = 10_000 // 她主动说的话，有按钮也过这么久收起：没人点她，不该一直挡着
const SPEAK_GAP_MS = 3 * 60_000 // 主动开口至少隔这么久，课上别老打岔
// 连着刷台词。门槛按上线第一天的数定的：隔不到 20 秒算一串的话，到 3 次的串有 129 串、到 5 次的 50、到 7 次的 23。
// 好感越高越耐烦（按档位 0～4 取，见 behavior.ts 的 affinityTier）：最熟的点到第 10 次才背过身
const BURST_GAP_MS = 20_000
const PESTER_MILD = 3
const PESTER_ANGRY = [5, 5, 6, 7, 8] as const
const SULK_AT = [7, 7, 8, 9, 10] as const
const SULK_MS = 30_000
// 没人理她：这么久没碰就换一张日常（之后每隔这么久再换），再久就打盹。比赛页不换
const DAILY_MS = 5 * 60_000
const NAP_MS = 20 * 60_000
// 松手时身子露在屏幕外超过这么多，就缩进那条边只探个头
const PEEK_OUT = 0.35
// 按住下面这一截拖（裙子、尾巴）是揪着尾巴，上面是被拎起来
const TAIL_GRAB = 0.62
// 一直连着摸超过这么久，就被摸得笑出来
const GIGGLE_MS = 1800
// 闲聊：进站后这么久说第一句，之后每隔 4～8 分钟（随机）一句。最近这么久敲过键盘、冒过气泡就往后推
const CHAT_FIRST_MS = 2 * 60_000
const CHAT_GAP_MIN_MS = 4 * 60_000
const CHAT_GAP_MAX_MS = 8 * 60_000
const TYPING_QUIET_MS = 15_000
const CHAT_AFTER_BUBBLE_MS = 2 * 60_000
// 甩出去：松手前那一下快过这个速度（像素/毫秒）才算甩。飞的时候往下掉、撞边回弹、落地蹭着停下
const FLING_SPEED = 1.2
const FLING_MAX_SPEED = 4
const GRAVITY = 0.004
const BOUNCE = 0.5
const FLY_MAX_MS = 3000
// 拎着摇：这么短时间里来回换方向这么多次就晕了
const SHAKE_TURNS = 5
const SHAKE_WINDOW_MS = 900
// 挠痒：鼠标不按键在她身上这么短时间里来回这么多次；挠完隔一会儿才能再挠
const TICKLE_TURNS = 6
const TICKLE_WINDOW_MS = 1200
const TICKLE_MS = 1600
const TICKLE_COOLDOWN_MS = 8000
// 藏在边上被点到，有这么大的机会说「被发现了」（不然照常说页面的事）
const PEEK_FOUND_CHANCE = 0.6

type HAnchor = 'left' | 'right' | null
type VAnchor = 'top' | 'bottom' | null
type PeekSide = keyof typeof PEEK_SIZE
interface Place {
  h: HAnchor
  v: VAnchor
  x: number // 未贴边时的 left；探头在下边时是探头图的 left
  y: number // 未贴边时的 top；探头在左右时是探头图的 top
  /** 缩在哪条边上只探个头，没缩是 null */
  peek: PeekSide | null
}

function loadPlace(): Place {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Place>
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const peek = p.peek && p.peek in PEEK_SIZE ? p.peek : null
        return { h: p.h ?? null, v: p.v ?? null, x: p.x, y: p.y, peek }
      }
    }
  } catch {
    // 隐私窗口、禁了站点数据：用默认位置
  }
  return { h: 'right', v: 'bottom', x: 0, y: 0, peek: null }
}

function savePlace(p: Place) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // 存不下就算了，下次回到默认位置
  }
}

const place = loadPlace()
const pos = reactive({ x: 0, y: 0 })
const dragging = ref(false)
const pressed = ref(false)
const patting = ref(false)
const flipped = ref(false)
/** 缩在哪条边上（同 place.peek，响应式的一份） */
const peek = ref<PeekSide | null>(place.peek)
/** 框的大小：探头时换成探头图的大小 */
const size = computed(() => (peek.value ? PEEK_SIZE[peek.value] : { width: WIDTH, height: HEIGHT }))
/** 生闷气：背过身去（镜像反过来），点她不说话 */
const sulking = ref(false)
const body = ref<HTMLElement>()
const squashEl = ref<HTMLElement>()
const bubbleEl = ref<HTMLElement>()

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** 按锚点算出实际坐标。窗口变了也走这里，贴边的照旧贴边 */
function settle() {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  if (peek.value) {
    const { width, height } = PEEK_SIZE[peek.value]
    pos.x = peek.value === 'left' ? 0 : peek.value === 'right' ? vw - width : clamp(place.x, MARGIN, vw - width - MARGIN)
    pos.y = peek.value === 'bottom' ? vh - height : clamp(place.y, TOP_GAP, vh - height)
    flipped.value = false
    return
  }
  pos.x = place.h === 'left' ? MARGIN : place.h === 'right' ? vw - WIDTH - MARGIN : clamp(place.x, MARGIN, vw - WIDTH - MARGIN)
  // 图的下沿是裁断的半身，贴底时直接坐在屏幕底边上，不留空
  pos.y = place.v === 'top' ? TOP_GAP : place.v === 'bottom' ? vh - HEIGHT : clamp(place.y, TOP_GAP, vh - HEIGHT)
  flipped.value = pos.x + WIDTH / 2 < vw / 2
}

// 第一帧之前就算好位置。挪到 onMounted 里算的话，第一帧画在 (0,0)，
// 接着位置一变就触发过渡，看上去是从左上角飞过去的
settle()

let start: { px: number; py: number; x: number; y: number } | null = null
let moved = false
/** 这一下拖是拎着上半身还是揪着尾巴 */
const grabbedTail = ref(false)
/** 这一下拖着被来回摇晕了 */
const shaken = ref(false)
/** 甩出去正在飞 */
const flying = ref(false)

// 最近一小段指针轨迹：松手时算甩的速度
let trail: { t: number; x: number; y: number }[] = []
// 来回摇：两个方向各记上一步往哪走，换方向就记一次
let shakeTurns: number[] = []
let lastStep = { x: 0, y: 0, dirX: 0, dirY: 0 }

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 不拦的话，第一下甩得快时浏览器会拿光标新位置底下的东西（比如题目列表的链接）开始原生拖拽，
  // 随即发 pointercancel，看板娘就卡在半路
  e.preventDefault()
  // 飞着被接住：停在手里接着拖
  if (flying.value) stopFlying()
  body.value?.setPointerCapture(e.pointerId)
  start = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
  moved = false
  pressed.value = true
  grabbedTail.value = !peek.value && e.clientY - pos.y > HEIGHT * TAIL_GRAB
  shaken.value = false
  trail = []
  shakeTurns = []
  lastStep = { x: e.clientX, y: e.clientY, dirX: 0, dirY: 0 }
  touched()
}

/** 拖着来回摇：任一方向一步走够 4 像素才算数，换方向记一次 */
function trackShake(e: PointerEvent, now: number) {
  const stepX = e.clientX - lastStep.x
  const stepY = e.clientY - lastStep.y
  for (const [step, key] of [
    [stepX, 'dirX'],
    [stepY, 'dirY'],
  ] as const) {
    if (Math.abs(step) < 4) continue
    const dir = Math.sign(step)
    if (lastStep[key] && dir !== lastStep[key]) shakeTurns.push(now)
    lastStep[key] = dir
  }
  if (Math.abs(stepX) >= 4) lastStep.x = e.clientX
  if (Math.abs(stepY) >= 4) lastStep.y = e.clientY
  shakeTurns = shakeTurns.filter((t) => now - t < SHAKE_WINDOW_MS)
  if (shakeTurns.length >= SHAKE_TURNS) shaken.value = true
}

// ---- 挠痒：鼠标不按键在她身上来回蹭 ----
const tickled = ref(false)
let tickleTurns: number[] = []
let tickleLast = { x: 0, dir: 0 }
let tickleReadyAt = 0
let tickleTimer: ReturnType<typeof setTimeout> | undefined

function onHover(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.buttons || peek.value) return
  const step = e.clientX - tickleLast.x
  if (Math.abs(step) < 3) return
  tickleLast.x = e.clientX
  const dir = Math.sign(step)
  const now = performance.now()
  if (tickleLast.dir && dir !== tickleLast.dir) tickleTurns.push(now)
  tickleLast.dir = dir
  tickleTurns = tickleTurns.filter((t) => now - t < TICKLE_WINDOW_MS)
  if (tickleTurns.length < TICKLE_TURNS || now < tickleReadyAt || patting.value || dragging.value) return
  tickleTurns = []
  tickleReadyAt = now + TICKLE_COOLDOWN_MS
  napping.value = false
  touched()
  tickled.value = true
  clearTimeout(tickleTimer)
  tickleTimer = setTimeout(() => (tickled.value = false), TICKLE_MS)
  // 生着闷气被挠只笑不说话，气不消（哄好还得摸头）
  const text = sulking.value ? undefined : pick('play.tickle')
  if (text) say({ text, pose: 'giggle', situation: 'play.tickle' })
  logMascotEvent({ kind: 'play', action: 'tickle', line: text })
}

function onLeave() {
  tickleTurns = []
  tickleLast.dir = 0
}

function onMove(e: PointerEvent) {
  if (!start) return onHover(e)
  const dx = e.clientX - start.px
  const dy = e.clientY - start.py
  const now = performance.now()
  trail.push({ t: now, x: e.clientX, y: e.clientY })
  if (trail.length > 8) trail.shift()
  if (!moved && dx * dx + dy * dy < 9) return
  trackShake(e, now)
  if (!moved && peek.value) {
    // 从边上拖出来：整个人出来，按住的地方大致还在手底下
    const was = PEEK_SIZE[peek.value]
    start.x += (was.width - WIDTH) / 2
    start.y += was.height - HEIGHT
    peek.value = null
  }
  moved = true
  dragging.value = true
  pressed.value = false
  napping.value = false
  pos.x = start.x + dx
  pos.y = start.y + dy
  flipped.value = pos.x + WIDTH / 2 < document.documentElement.clientWidth / 2
}

/** 松手时露在屏幕外多少：超过 PEEK_OUT 就缩进那条边。下边优先（多半是往下拖藏起来） */
function peekSideFor(vw: number, vh: number): PeekSide | null {
  if (pos.y + HEIGHT - vh > HEIGHT * PEEK_OUT) return 'bottom'
  if (-pos.x > WIDTH * PEEK_OUT) return 'left'
  if (pos.x + WIDTH - vw > WIDTH * PEEK_OUT) return 'right'
  return null
}

/** 按松手的位置贴边（「四分之一区」），记下来 */
function putDown() {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const cx = pos.x + WIDTH / 2
  const cy = pos.y + HEIGHT / 2
  place.h = cx < vw / 4 ? 'left' : cx > (vw * 3) / 4 ? 'right' : null
  place.v = cy < vh / 4 ? 'top' : cy > (vh * 3) / 4 ? 'bottom' : null
  place.x = pos.x
  place.y = pos.y
  place.peek = null
  peek.value = null
  settle()
  savePlace(place)
}

/** 松手那一刻的速度（像素/毫秒），够快才算甩，不够或者停住了再松手就是 null */
function releaseVelocity() {
  const now = performance.now()
  const recent = trail.filter((it) => now - it.t < 80)
  if (recent.length < 2) return null
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const dt = last.t - first.t
  if (dt < 10 || now - last.t > 50) return null
  const vx = (last.x - first.x) / dt
  const vy = (last.y - first.y) / dt
  if (Math.hypot(vx, vy) < FLING_SPEED) return null
  const cap = (v: number) => clamp(v, -FLING_MAX_SPEED, FLING_MAX_SPEED)
  return { vx: cap(vx), vy: cap(vy) }
}

let flyFrame = 0
/** 甩出去：往下掉，撞到四边回弹，落在底边上蹭着停下，然后晕一会儿 */
function fling(vx: number, vy: number) {
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const minX = MARGIN
  const maxX = vw - WIDTH - MARGIN
  const minY = TOP_GAP
  const maxY = vh - HEIGHT
  pos.x = clamp(pos.x, minX, maxX)
  pos.y = clamp(pos.y, minY, maxY)
  peek.value = null
  flying.value = true
  const startedAt = performance.now()
  let last = startedAt
  const step = (now: number) => {
    const dt = Math.min(32, now - last)
    last = now
    vy += GRAVITY * dt
    pos.x += vx * dt
    pos.y += vy * dt
    if (pos.x < minX || pos.x > maxX) {
      pos.x = clamp(pos.x, minX, maxX)
      vx = -vx * BOUNCE
    }
    if (pos.y < minY) {
      pos.y = minY
      vy = -vy * BOUNCE
    }
    const onFloor = pos.y >= maxY
    if (onFloor) {
      pos.y = maxY
      vy = vy > 0.25 ? -vy * BOUNCE : 0
      vx *= Math.pow(0.99, dt)
    }
    flipped.value = pos.x + WIDTH / 2 < vw / 2
    if ((onFloor && vy === 0 && Math.abs(vx) < 0.03) || now - startedAt > FLY_MAX_MS) {
      stopFlying()
      putDown()
      logMascotEvent({ kind: 'move', line: `${place.h ?? '-'} ${place.v ?? '-'}` })
      dizzy(shaken.value ? 'shake' : 'fling')
      return
    }
    flyFrame = requestAnimationFrame(step)
  }
  flyFrame = requestAnimationFrame(step)
}

function stopFlying() {
  cancelAnimationFrame(flyFrame)
  flying.value = false
}

/** 被甩晕、摇晕了说一句。生闷气时不说话，只记一笔 */
function dizzy(how: 'fling' | 'shake') {
  const situation = how === 'fling' ? 'play.fling' : 'play.shake'
  const text = sulking.value ? undefined : pick(situation)
  if (text) say({ text, pose: 'dizzy', situation })
  logMascotEvent({ kind: 'play', action: how, line: text })
}

/**
 * 每点一下都压扁再弹回来一次。按住时的压扁靠 .pressed 的过渡，可快速点一下从按下到松开只有几十毫秒，
 * 过渡还没走到位就松了，连点时看上去像卡住。用 Web Animations 播一遍完整的，每下都从头播
 */
const reducedMotion = usePreferredReducedMotion()
function boing() {
  if (reducedMotion.value === 'reduce') return
  squashEl.value?.animate([{ transform: 'scale(1.06, 0.86)' }, { transform: 'scale(0.97, 1.04)', offset: 0.55 }, { transform: 'scale(1, 1)' }], {
    duration: 280,
    easing: 'ease-out',
  })
}

let patTimer: ReturnType<typeof setTimeout> | undefined
let patStartedAt = 0
/** 摸了好一会儿，被摸得笑出来了 */
const giggling = ref(false)
let streak = 0
let patClicks = rollPatClicks()
let lastClick = 0
function onUp() {
  if (!start) return
  start = null
  pressed.value = false
  if (moved) {
    dragging.value = false
    const velocity = releaseVelocity()
    if (velocity && reducedMotion.value !== 'reduce') return fling(velocity.vx, velocity.vy)
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const side = peekSideFor(vw, vh)
    if (side) {
      // 探头图对着她原来的中间放
      const { width, height } = PEEK_SIZE[side]
      place.x = pos.x + (WIDTH - width) / 2
      place.y = pos.y + (HEIGHT - height) / 2
      place.peek = side
      peek.value = side
      settle()
      savePlace(place)
    } else putDown()
    logMascotEvent({ kind: 'move', line: side ? `peek ${side}` : `${place.h ?? '-'} ${place.v ?? '-'}` })
    if (shaken.value) dizzy('shake')
    return
  }
  boing()
  const now = performance.now()
  if (now - lastClick <= STREAK_GAP_MS) streak++
  else {
    streak = 1
    patClicks = rollPatClicks()
  }
  lastClick = now

  // 正在被摸，或者连点到数了：摸摸头，从这一下再摸满一轮
  if (patting.value || streak >= patClicks) {
    if (!patting.value && sulking.value) {
      // 生着闷气被摸了头：哄好了
      endSulk()
      const text = pick('sulk.forgive')
      say({ text, pose: 'blush' })
      logMascotEvent({ kind: 'pat', situation: 'sulk.forgive', line: text })
    } else if (!patting.value) {
      const text = pick('patting')
      say({ text, pose: situationPose('patting') })
      logMascotEvent({ kind: 'pat', line: text })
    }
    napping.value = false
    if (!patting.value) patStartedAt = now
    else if (now - patStartedAt > GIGGLE_MS) giggling.value = true
    patting.value = true
    clearTimeout(patTimer)
    patTimer = setTimeout(() => {
      patting.value = false
      giggling.value = false
      streak = 0
    }, PAT_MS)
    return
  }
  // 一轮里只有第一下开关气泡，后面连着点是在找彩蛋，不跟着一开一关
  if (streak === 1) toggleBubble()
  else if (streak === OVERCLICK) {
    const text = sulking.value ? undefined : pick('overclick')
    if (text) say({ text, pose: situationPose('overclick') })
    logMascotEvent({ kind: 'overclick', situation: sulking.value ? 'sulk' : undefined, line: text })
  }
}

// ---- 气泡 ----

const route = useRoute()
const userStore = useUserStore()
const collabStore = useCollabStore()
const authModal = useAuthModalStore()

interface Bubble {
  text: string
  /** 说这句时摆的姿势，气泡收起就回平时那张 */
  pose?: MascotPose
  actions?: MascotAction[]
  /** 记互动时带上，看哪种情况下的按钮有人点 */
  situation?: string
  /** 按钮是她问的问题的几个选项：一样的样式，不突出第一个（不然像在替同学选） */
  choices?: boolean
}
const bubble = ref<Bubble | null>(null)
let quietTimer: ReturnType<typeof setTimeout> | undefined
/** 上一次冒气泡（点开、主动说、摆弄）的时刻：闲聊要离它远一点 */
let lastBubbleAt = -Infinity

/** 比赛、测验里不说话：「运行例子」「举手」这类按钮在考试时算不算帮忙，干脆不弹 */
const silent = computed(() => String(route.name ?? '').startsWith('contest '))

function say(next: Bubble, closeAfter = next.actions?.length ? 0 : QUIET_BUBBLE_MS) {
  if (silent.value) return
  bubble.value = next
  lastBubbleAt = performance.now()
  clearTimeout(quietTimer)
  if (closeAfter) quietTimer = setTimeout(close, closeAfter)
}

function close() {
  bubble.value = null
  clearTimeout(quietTimer)
}

function toggleBubble() {
  if (bubble.value) return close()
  if (silent.value) return
  let guide = resolveGuide()
  if (!userStore.isTeacherOrAbove) guide = personalize(guide)
  const serious = SERIOUS.has(guide.situation)
  if (napping.value) {
    napping.value = false
    // 睡着了被点醒：先说这一句，再点才说正事。要紧的事（有人举手、卡住了）直接说
    if (!serious) {
      const text = pick('wake')
      say({ text, pose: situationPose('wake'), situation: 'wake' })
      logMascotEvent({ kind: 'open', situation: 'wake', line: text })
      return
    }
  }
  if (sulking.value) {
    // 生着闷气只蹦一下。要紧的事（有人举手、卡住了）照说，气也就消了
    if (!serious) return
    endSulk()
  }
  const now = performance.now()
  burst = now - lastOpenAt < BURST_GAP_MS ? burst + 1 : 1
  lastOpenAt = now
  if (!serious) guide = pester(guide)
  // 藏在边上被找到了（越点越烦的那几句照说）
  if (peek.value && !serious && !PESTERED.has(guide.situation) && Math.random() < PEEK_FOUND_CHANCE) {
    guide = { situation: 'peek.found', actions: guide.actions }
  }
  const { text, situation } = pickFor(guide)
  say({ text, actions: guide.actions?.slice(0, 3), situation: guide.situation, pose: situationPose(situation) })
  if (guide.situation === 'sulk') startSulk()
  noteMemorySaid(guide.situation)
  notePoke()
  logMascotEvent({ kind: 'open', situation: guide.situation, line: text })
}

// ---- 连着刷：越点越烦，点多了生闷气 ----
let burst = 0
let lastOpenAt = -Infinity
let sulkTimer: ReturnType<typeof setTimeout> | undefined

/** 按这一串点到第几次换成不耐烦、炸毛的话；页面的按钮照给，真有事的还能办。背过身去就不给了 */
function pester(guide: MascotGuide): MascotGuide {
  const tier = affinityTier()
  if (burst >= SULK_AT[tier]!) return { situation: 'sulk' }
  const situation = burst >= PESTER_ANGRY[tier]! ? 'pester.angry' : burst >= PESTER_MILD ? 'pester.mild' : null
  return situation ? { situation, actions: guide.actions } : guide
}

function startSulk() {
  sulking.value = true
  clearTimeout(sulkTimer)
  sulkTimer = setTimeout(endSulk, SULK_MS)
}

function endSulk() {
  sulking.value = false
  burst = 0
  clearTimeout(sulkTimer)
}

/** 先看全站的：没登录、老师这边有人举手；再问页面；都没有就打个招呼 */
function resolveGuide(): MascotGuide {
  if (!userStore.isAuthed) return { situation: 'guest', actions: [{ label: '登录', run: authModal.openLoginModal }] }
  const teacher = userStore.isTeacherOrAbove
  if (teacher && collabStore.isTeacher && collabStore.pendingCount > 0) {
    return { situation: 'teacher.help', n: collabStore.pendingCount, actions: [{ label: '去看看', run: () => (collabStore.helpPanelOpen = true) }] }
  }
  return currentMascotGuide() ?? { situation: teacher ? 'teacher.greet' : 'greet' }
}

/** 这几种情况要紧，不拿彩蛋换掉 */
const SERIOUS = new Set<MascotSituation>(['guest', 'teacher.help', 'problem.stuck', 'first.meet'])
/** 越说越烦的那几句也不拿彩蛋换：不然炸毛炸到一半突然「服务器繁忙」 */
const PESTERED = new Set<MascotSituation>(['pester.mild', 'pester.angry', 'sulk'])
const RARE_CHANCE = 0.03
const TIME_CHANCE = 0.15

function pickFor(guide: MascotGuide) {
  let situation = guide.situation
  if (!SERIOUS.has(situation) && !PESTERED.has(situation) && situation !== 'memory.closer' && guide.n === undefined && !guide.vars) {
    const timely = timeSituation()
    if (Math.random() < RARE_CHANCE) situation = 'rare'
    else if (timely && !userStore.isTeacherOrAbove && Math.random() < TIME_CHANCE) situation = timely
  }
  return { text: fillLine(pick(situation), guide), situation }
}

/**
 * 每组台词洗成一副牌，抽完再洗：一组听完之前不会重复。新洗的一副头一张不和上一句一样。
 * 牌放在内存里，换页面不丢（看板娘挂在布局上），刷新才重洗
 */
const decks = new Map<MascotSituation, string[]>()
let lastLine = ''
function pick(situation: MascotSituation) {
  let deck = decks.get(situation)
  if (!deck?.length) {
    deck = [...MASCOT_LINES[situation]]
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    // 从末尾往前抽，所以要错开的是最后一张
    if (deck.length > 1 && deck[deck.length - 1] === lastLine) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1]!, deck[0]!]
    decks.set(situation, deck)
  }
  lastLine = deck.pop()!
  return lastLine
}

/**
 * 按东八区的钟点挑时间彩蛋。节次是估的（第一节 8:00、午饭 11:20、下午第一节 13:30、
 * 最后一节 15:50 前后），对不上学校作息就改这里
 */
function timeSituation(): MascotSituation | null {
  const wall = new Date(Date.now() + TIME_ZONE_OFFSET_MINUTES * 60_000)
  const day = wall.getUTCDay()
  const minutes = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  const within = (from: string, to: string) => {
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    return minutes >= fh! * 60 + fm! && minutes < th! * 60 + tm!
  }
  if (day === 0 || day === 6 || !within('07:00', '18:00')) return 'offHours'
  if (within('08:00', '08:50')) return 'time.firstClass'
  if (within('11:20', '12:10')) return 'time.lunch'
  if (within('13:30', '14:20')) return 'time.afternoon'
  if (within('15:50', '16:40')) return 'time.lastClass'
  if (day === 1) return 'day.monday'
  if (day === 5) return 'day.friday'
  return null
}

async function runAction(action: MascotAction) {
  logMascotEvent({ kind: 'action', action: action.label, situation: bubble.value?.situation })
  close()
  await action.run()
}

// ---- 主动开口：页面经 requestSpeech 请她说，这里卡频率 ----
let lastSpokeAt = -Infinity
const spokenKeys = new Set<string>()
watch(speechRequest, (speech) => {
  if (!speech || silent.value || sulking.value || dragging.value || bubble.value) return
  if (document.visibilityState !== 'visible' || spokenKeys.has(speech.key)) return
  if (performance.now() - lastSpokeAt < SPEAK_GAP_MS) return
  lastSpokeAt = performance.now()
  spokenKeys.add(speech.key)
  napping.value = false
  const text = fillLine(pick(speech.situation), speech)
  say({ text, actions: speech.actions?.slice(0, 3), situation: speech.situation, pose: situationPose(speech.situation) }, SPOKEN_BUBBLE_MS)
  logMascotEvent({ kind: 'speak', situation: speech.situation, line: text })
})

// ---- 闲聊：没人理她，隔几分钟自己说一句（只对学生）----
let nextChatAt = performance.now() + CHAT_FIRST_MS
let lastKeyAt = -Infinity
// 敲代码、打字时别插嘴。捕获阶段听，编辑器拦了冒泡也听得到
useEventListener(window, 'keydown', () => (lastKeyAt = performance.now()), { capture: true, passive: true })

useIntervalFn(() => {
  const now = performance.now()
  if (now < nextChatAt) return
  if (!userStore.isAuthed || userStore.isTeacherOrAbove) return
  if (silent.value || dragging.value || flying.value || sulking.value || patting.value || bubble.value) return
  if (document.visibilityState !== 'visible') return
  // 不到时候就等下一轮再看，不重新抽间隔
  if (now - lastKeyAt < TYPING_QUIET_MS || now - lastBubbleAt < CHAT_AFTER_BUBBLE_MS) return
  nextChatAt = now + CHAT_GAP_MIN_MS + Math.random() * (CHAT_GAP_MAX_MS - CHAT_GAP_MIN_MS)
  chat()
}, 10_000)

function chat() {
  const profile = mascotProfile.value
  const next = chooseChat({
    idlePose: idlePose.value,
    napping: napping.value,
    tier: affinityTier(),
    todaySolved: profile?.todaySolved ?? 0,
    answers: profile?.answers ?? null,
  })
  if (next.type === 'ask') {
    const question = next.question
    const situation = `ask.${question.id}`
    const actions = question.options.map((option) => ({ label: option.label, run: () => answer(question, option) }))
    say({ text: question.text, pose: 'curious', situation, actions, choices: true }, SPOKEN_BUBBLE_MS)
    logMascotEvent({ kind: 'speak', situation, line: question.text })
    return
  }
  if (next.type === 'recall') {
    say({ text: next.text, pose: next.pose, situation: 'chat.recall' })
    logMascotEvent({ kind: 'speak', situation: 'chat.recall', line: next.text })
    return
  }
  const text = fillLine(pick(next.situation), { n: profile?.todaySolved })
  // 跟手上那件事配套的话、梦话：接着摆当时那张
  say({ text, situation: next.situation, pose: next.keepPose ? undefined : situationPose(next.situation) })
  logMascotEvent({ kind: 'speak', situation: next.situation, line: text })
}

/** 回答了她的问题：接一句，记下来（以后翻出来说） */
function answer(question: MascotQuestion, option: MascotQuestion['options'][number]) {
  const text = pickOne(option.reply)
  const situation = `ask.${question.id}`
  say({ text, pose: option.pose, situation })
  logMascotEvent({ kind: 'answer', situation, action: option.key, line: text })
  noteAnswer(question.id, option.key)
}

// 学生的行为数：进站、换页面时拉（30 秒内拉过就不拉），登录换人时重拉
watch(
  () => route.fullPath,
  () => refreshMascotProfile(),
)
watch(
  () => userStore.user?.id,
  () => refreshMascotProfile(true),
  { immediate: true },
)

// 点别处收起；点她自己由 onUp 管（开关），不算「别处」
onClickOutside(bubbleEl, close, { ignore: [body] })
watch(() => route.fullPath, close)
watch(silent, (quiet) => quiet && close())

/** 她靠上时气泡往下冒，免得顶出屏幕；在左半边时气泡贴左对齐 */
const bubbleBelow = computed(() => pos.y < 220)
const bubbleLeft = computed(() => (peek.value ? peek.value === 'left' : flipped.value))
/** 气泡尖角离气泡那一侧多远，对着她的头：全身和下边探头是 50，左右探头的框窄，头更靠边 */
const TAIL_OFFSET: Record<PeekSide | 'full', number> = { full: 50, bottom: 50, left: 24, right: 16 }
const tailOffset = computed(() => `${TAIL_OFFSET[peek.value ?? 'full']}px`)

// 告诉别的浮层她在哪（成就弹框会让开）
watchEffect(() => Object.assign(mascotBox, { x: pos.x, y: pos.y, width: size.value.width, height: size.value.height }))

// ---- 立绘 ----

/** 平时那张：节日当天换节日装。页面开着跨过零点也不换，刷新才换 */
const restPose: MascotPose = festivalPose() ?? 'idle'
const pose = computed<MascotPose>(() => {
  // 缩在边上时一直是探头那张：别的姿势都是全身的，塞不进探头的框
  if (peek.value) return `peek-${peek.value}`
  if (flying.value) return 'omg'
  if (dragging.value) return shaken.value ? 'dizzy' : grabbedTail.value ? 'tail-grabbed' : 'lifted'
  if (patting.value) return giggling.value ? 'giggle' : 'patted'
  if (tickled.value) return 'giggle'
  if (bubble.value?.pose) return bubble.value.pose
  if (sulking.value) return 'fuming'
  return idlePose.value ?? restPose
})

// ---- 没人理她：换日常、打盹 ----

/** 闲着时换的那张（日常或者睡着），被碰一下就回平时那张 */
const idlePose = ref<MascotPose | null>(null)
const napping = ref(false)
let lastTouch = performance.now()
let lastDailyAt = performance.now()
/** 被碰了一下：重新计时。睡着时只是按下去还不算醒，点开（说「没睡」）、拖起来、摸头才醒 */
function touched() {
  lastTouch = performance.now()
  lastDailyAt = lastTouch
  if (!napping.value) idlePose.value = null
}
useIntervalFn(() => {
  if (silent.value || peek.value || bubble.value || sulking.value || dragging.value || flying.value || napping.value) return
  if (document.visibilityState !== 'visible') return
  const now = performance.now()
  if (now - lastTouch >= NAP_MS) {
    napping.value = true
    idlePose.value = napPose()
  } else if (now - lastDailyAt >= DAILY_MS) {
    lastDailyAt = now
    idlePose.value = dailyPose(Date.now(), timeSituation() === 'offHours')
  }
}, 30_000)
// 进了比赛就醒过来、回平时那张（比赛里点她不说话，不先醒就一直睡着）
watch(silent, (quiet) => {
  if (!quiet) return
  napping.value = false
  touched()
})
watch(napping, (asleep) => !asleep && touched())

/**
 * 真正画出来的那张。换姿势时先在后台下好、解码完再换，没下好之前接着显示上一张，不闪白。
 * 机房网慢时换得晚一点，总比空一下强
 */
const shownSrc = ref(poseUrl(pose.value))
const ready = new Set<string>([shownSrc.value])
/** 下好、解码完是 true；没下到（断网、部署后老页面拿旧地址 404）是 false，下次用到再试 */
function preload(url: string): Promise<boolean> {
  if (ready.has(url)) return Promise.resolve(true)
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => {
      ready.add(url)
      return true
    },
    () => false,
  )
}
watch(
  () => poseUrl(pose.value),
  (url) => {
    if (ready.has(url)) shownSrc.value = url
    // 没下到就接着显示上一张，别换成空白
    else preload(url).then((ok) => ok && poseUrl(pose.value) === url && (shownSrc.value = url))
  },
)
// 按下去就该换「被拎起来」、连点就该换「被摸」，等那一下再下就慢了：进页面闲下来以后先把这两张下好
// 三张探头图也先下：缩进边上时框立刻变窄，图没到的话全身那张会挤在窄框里（下面 object-fit 兜着不变形）
// 甩、摇、挠这几下的图也先下：飞出去那一下没图就是一张平时的脸在飞
const PRELOAD_POSES: MascotPose[] = ['lifted', 'tail-grabbed', 'patted', 'peek-bottom', 'peek-left', 'peek-right', 'omg', 'dizzy', 'giggle']

onMounted(() => {
  window.addEventListener('resize', settle, { passive: true })
  mascotBox.shown = true
  // 机房 Chrome 105 有 requestIdleCallback，iPad 上的 Safari 没有（宽屏也算电脑）；闲不下来最多等 5 秒
  const warm = () => PRELOAD_POSES.forEach((it) => preload(poseUrl(it)))
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 5000 })
  else setTimeout(warm, 2000)
})
onBeforeUnmount(() => {
  mascotBox.shown = false
  window.removeEventListener('resize', settle)
  clearTimeout(patTimer)
  clearTimeout(quietTimer)
  clearTimeout(sulkTimer)
  clearTimeout(tickleTimer)
  cancelAnimationFrame(flyFrame)
})
</script>

<template>
  <div
    class="mascot"
    :class="{ dragging: dragging || flying }"
    :style="{ width: `${size.width}px`, height: `${size.height}px`, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }"
  >
    <div
      ref="body"
      class="body"
      :class="{ pressed, patting: patting || tickled, flipped: !peek && flipped !== sulking }"
      aria-hidden="true"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onLeave"
      @dragstart.prevent
    >
      <div class="flip">
        <div ref="squashEl" class="squash">
          <div class="breathe">
            <img :src="shownSrc" :width="size.width" :height="size.height" alt="" draggable="false" />
          </div>
        </div>
      </div>
    </div>
    <Transition name="bubble">
      <div
        v-if="bubble && !dragging && !flying"
        ref="bubbleEl"
        class="bubble"
        :class="{ below: bubbleBelow, left: bubbleLeft }"
        :style="{ '--tail': tailOffset }"
        role="status"
      >
        <p class="line">{{ bubble.text }}</p>
        <div v-if="bubble.actions?.length" class="actions">
          <n-button
            v-for="(action, index) in bubble.actions"
            :key="action.label"
            size="small"
            :type="index === 0 && !bubble.choices ? 'primary' : 'default'"
            @click="runAction(action)"
          >
            {{ action.label }}
          </n-button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mascot {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 900; /* 压在页面上，但让弹框、消息、烟花盖住它 */
  transition: transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1);
  will-change: transform;
}
.mascot.dragging {
  transition: none;
}
.body {
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.dragging .body {
  cursor: grabbing;
}

/* 气泡：白底深蓝描边（取她身上线条的颜色），尾巴指着她的头。设计稿「看板娘引导」 */
.bubble {
  --bubble-line: #2b3a6b;
  --bubble-bg: #fff;
  position: absolute;
  right: 14px;
  bottom: calc(100% + 12px);
  width: max-content;
  min-width: 120px;
  max-width: 280px;
  box-sizing: border-box;
  padding: 12px 14px;
  background: var(--bubble-bg);
  border: 2px solid var(--bubble-line);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(20, 30, 60, 0.16);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 别写成 :global(html.dark) .bubble：scoped 会把后半截丢掉，编译成只剩 html.dark，深色从来没生效过 */
html.dark .bubble {
  --bubble-line: #7f94d4;
  --bubble-bg: #1f2230;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.bubble::after {
  content: '';
  position: absolute;
  right: var(--tail);
  bottom: -9px;
  width: 14px;
  height: 14px;
  background: var(--bubble-bg);
  border-right: 2px solid var(--bubble-line);
  border-bottom: 2px solid var(--bubble-line);
  transform: rotate(45deg);
}
.bubble.left {
  right: auto;
  left: 14px;
}
.bubble.left::after {
  right: auto;
  left: var(--tail);
}
.bubble.below {
  bottom: auto;
  top: calc(100% + 12px);
}
.bubble.below::after {
  bottom: auto;
  top: -9px;
  transform: rotate(-135deg);
}
.line {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bubble-enter-active,
.bubble-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.96);
}

.flip,
.squash,
.breathe {
  width: 100%;
  height: 100%;
  transform-origin: 50% 100%;
}

.flip {
  transition: transform 0.3s ease;
}
.flipped .flip {
  transform: scaleX(-1);
}

/* 按压 Q 弹：以底边中点为原点压扁，松手带一点回弹 */
.squash {
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pressed .squash {
  transform: scale(1.05, 0.88);
  transition-duration: 0.1s;
}

/* 平时轻轻地一起一伏 */
.breathe {
  animation: mascot-breathe 3.6s ease-in-out infinite;
}
.dragging .breathe {
  animation-play-state: paused;
}
/* 被摸头：一下一下往下揉 */
.patting .breathe {
  animation: mascot-rub 0.4s ease-in-out infinite;
}

img {
  display: block;
  object-fit: contain;
  object-position: 50% 100%;
  pointer-events: none;
  -webkit-user-drag: none;
}
.breathe {
  position: relative;
}

@keyframes mascot-breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.015, 0.975);
  }
}

@keyframes mascot-rub {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.03, 0.95);
  }
}

@media (prefers-reduced-motion: reduce) {
  .breathe,
  .patting .breathe {
    animation: none;
  }
}
@media print {
  .mascot {
    display: none;
  }
}
</style>
