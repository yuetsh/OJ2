<script setup lang="ts">
/**
 * 看板娘，兼站内的引导员。现在只有一个形象（鲸鱼娘）。
 *
 * 形象取自 MeteorNOX/DeepSeek-Balance-Whale-Widget 的 assets/DSniang1.png（裁掉透明边、缩到 2 倍显示尺寸转 webp）。
 * 那个仓库的代码是 MIT，但 assets/ 下的图不在 MIT 里（见它的 PROVENANCE.md）。
 *
 * - 常驻在前台页面的角落，能拖；松手按「四分之一区」贴边：中心落在左/右四分之一就贴左/右缘，
 *   上/下四分之一就贴上/下缘，中间保持松手的位置。两个方向各判各的，所以能贴进角落。
 * - 在屏幕左半边时整体镜像，脸总朝着页面中间。
 * - 按下去像玩偶一样压扁（底边不动），松手弹回。
 * - 点一下冒气泡：一句话加最多三个按钮，按页面、按情况变（页面经 shared/mascot/guide.ts 告诉她），
 *   台词在 shared/mascot/lines.ts。比赛里点她不弹气泡。再点一下、点别处、换页面都收起。
 * - 对学生按行为挑话（常犯的错、今天做了几道、熟不熟，见 shared/mascot/behavior.ts）。好感按一共做对几道分五档，
 *   高档多几组软一点的话、也更耐烦（档位不显示）；
 *   题目页上有几件事她会主动开口，频率上限在下面 SPEAK_GAP_MS。
 * - 互动都记进 mascot_event（点开、点按钮、主动开口、摸头、嫌烦、被拖走）。
 * - 一句一句地刷（两次点开隔不到 BURST_GAP_MS）：第 3 次起不耐烦、第 5 次起炸毛、第 7 次背过身去，
 *   生 SULK_MS 的闷气，这期间点她只蹦不说话。生闷气时连点摸到头就哄好了。上线第一天六成的点开
 *   离上一次不到 15 秒，学生是在刷台词，所以台词也按副牌抽（pick），一组听完才会重复。
 * - 彩蛋：连着快点，有时候（每轮三分之一的机会）点到第 4～8 下（也是随机的）会被摸摸头（同一个仓库的 assets/rua.gif），摸的时候接着点就一直摸。
 *
 * 位置只是这台电脑上的个人偏好，存 localStorage（读写都包 try/catch，拿不到就用默认位置）。
 * 定位一律用 transform 的像素值：贴右缘时若换成 right:0，过渡没法在 auto 和数值之间插值，会瞬移。
 */
import { TIME_ZONE_OFFSET_MINUTES } from '@oj2/contract'
import imageUrl from 'shared/assets/mascot/whale.webp'
import patUrl from 'shared/assets/mascot/whale-pat.gif'
import { MASCOT_LINES, type MascotSituation } from 'shared/mascot/lines'
import { currentMascotGuide, fillLine, mascotBox, type MascotAction, type MascotGuide } from 'shared/mascot/guide'
import { affinityTier, logMascotEvent, notePoke, personalize, refreshMascotProfile, speechRequest } from 'shared/mascot/behavior'
import { useAuthModalStore } from 'shared/store/authModal'
import { useCollabStore } from 'shared/store/collab'
import { useUserStore } from 'shared/store/user'

const WIDTH = 132
const HEIGHT = 140 // 图是 264×280
const MARGIN = 12
const TOP_GAP = 72 // 贴上缘时让开顶栏
const STORAGE_KEY = 'oj-mascot'
// 摸头动图是 128×128，人只占右下角、上面是手。放大到人和静态图一样大，
// 右边、人的下沿（第 117 行像素）对齐静态图，手伸出框外
const PAT_SIZE = 182
const PAT_BOTTOM = -Math.round((PAT_SIZE * 11) / 128)
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

type HAnchor = 'left' | 'right' | null
type VAnchor = 'top' | 'bottom' | null
interface Place {
  h: HAnchor
  v: VAnchor
  x: number // 未贴边时的 left
  y: number // 未贴边时的 top
}

function loadPlace(): Place {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Place>
      if (typeof p.x === 'number' && typeof p.y === 'number') return { h: p.h ?? null, v: p.v ?? null, x: p.x, y: p.y }
    }
  } catch {
    // 隐私窗口、禁了站点数据：用默认位置
  }
  return { h: 'right', v: 'bottom', x: 0, y: 0 }
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

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 不拦的话，第一下甩得快时浏览器会拿光标新位置底下的东西（比如题目列表的链接）开始原生拖拽，
  // 随即发 pointercancel，看板娘就卡在半路
  e.preventDefault()
  body.value?.setPointerCapture(e.pointerId)
  start = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
  moved = false
  pressed.value = true
}

function onMove(e: PointerEvent) {
  if (!start) return
  const dx = e.clientX - start.px
  const dy = e.clientY - start.py
  if (!moved && dx * dx + dy * dy < 9) return
  moved = true
  dragging.value = true
  pressed.value = false
  pos.x = start.x + dx
  pos.y = start.y + dy
  flipped.value = pos.x + WIDTH / 2 < document.documentElement.clientWidth / 2
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

// 动图 94KB，不在每个页面一打开就下：连点到第 2 下才预载，最少也还要再点两下才用得上
let patPreloaded = false
function preloadPat() {
  if (patPreloaded) return
  patPreloaded = true
  new Image().src = patUrl
}

let patTimer: ReturnType<typeof setTimeout> | undefined
let streak = 0
let patClicks = rollPatClicks()
let lastClick = 0
function onUp() {
  if (!start) return
  start = null
  pressed.value = false
  if (moved) {
    dragging.value = false
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const cx = pos.x + WIDTH / 2
    const cy = pos.y + HEIGHT / 2
    place.h = cx < vw / 4 ? 'left' : cx > (vw * 3) / 4 ? 'right' : null
    place.v = cy < vh / 4 ? 'top' : cy > (vh * 3) / 4 ? 'bottom' : null
    place.x = pos.x
    place.y = pos.y
    settle()
    savePlace(place)
    logMascotEvent({ kind: 'move', line: `${place.h ?? '-'} ${place.v ?? '-'}` })
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
  if (streak >= 2) preloadPat()

  // 正在被摸，或者连点到数了：摸摸头，从这一下再摸满一轮
  if (patting.value || streak >= patClicks) {
    if (!patting.value && sulking.value) {
      // 生着闷气被摸了头：哄好了
      endSulk()
      say({ text: pick('sulk.forgive') })
      logMascotEvent({ kind: 'pat', situation: 'sulk.forgive' })
    } else if (!patting.value) {
      say({ text: pick('patting') })
      logMascotEvent({ kind: 'pat' })
    }
    patting.value = true
    clearTimeout(patTimer)
    patTimer = setTimeout(() => {
      patting.value = false
      streak = 0
    }, PAT_MS)
    return
  }
  // 一轮里只有第一下开关气泡，后面连着点是在找彩蛋，不跟着一开一关
  if (streak === 1) toggleBubble()
  else if (streak === OVERCLICK) {
    if (!sulking.value) say({ text: pick('overclick') })
    logMascotEvent({ kind: 'overclick', situation: sulking.value ? 'sulk' : undefined })
  }
}

// ---- 气泡 ----

const route = useRoute()
const userStore = useUserStore()
const collabStore = useCollabStore()
const authModal = useAuthModalStore()

interface Bubble {
  text: string
  actions?: MascotAction[]
  /** 记互动时带上，看哪种情况下的按钮有人点 */
  situation?: string
}
const bubble = ref<Bubble | null>(null)
let quietTimer: ReturnType<typeof setTimeout> | undefined

/** 比赛、测验里不说话：「运行例子」「举手」这类按钮在考试时算不算帮忙，干脆不弹 */
const silent = computed(() => String(route.name ?? '').startsWith('contest '))

function say(next: Bubble, closeAfter = next.actions?.length ? 0 : QUIET_BUBBLE_MS) {
  if (silent.value) return
  bubble.value = next
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
  if (sulking.value) {
    // 生着闷气只蹦一下。要紧的事（有人举手、卡住了）照说，气也就消了
    if (!serious) return
    endSulk()
  }
  const now = performance.now()
  burst = now - lastOpenAt < BURST_GAP_MS ? burst + 1 : 1
  lastOpenAt = now
  if (!serious) guide = pester(guide)
  const text = pickFor(guide)
  say({ text, actions: guide.actions?.slice(0, 3), situation: guide.situation })
  if (guide.situation === 'sulk') startSulk()
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
  if (!SERIOUS.has(situation) && !PESTERED.has(situation) && guide.n === undefined && !guide.vars) {
    const timely = timeSituation()
    if (Math.random() < RARE_CHANCE) situation = 'rare'
    else if (timely && !userStore.isTeacherOrAbove && Math.random() < TIME_CHANCE) situation = timely
  }
  return fillLine(pick(situation), guide)
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
  if (!speech || silent.value || sulking.value || dragging.value || bubble.value || userStore.isTeacherOrAbove) return
  if (document.visibilityState !== 'visible' || spokenKeys.has(speech.key)) return
  if (performance.now() - lastSpokeAt < SPEAK_GAP_MS) return
  lastSpokeAt = performance.now()
  spokenKeys.add(speech.key)
  const text = fillLine(pick(speech.situation), speech)
  say({ text, actions: speech.actions?.slice(0, 3), situation: speech.situation }, SPOKEN_BUBBLE_MS)
  logMascotEvent({ kind: 'speak', situation: speech.situation, line: text })
})

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

// 告诉别的浮层她在哪（成就弹框会让开）
watchEffect(() => Object.assign(mascotBox, { x: pos.x, y: pos.y, width: WIDTH, height: HEIGHT }))

onMounted(() => {
  window.addEventListener('resize', settle, { passive: true })
  mascotBox.shown = true
})
onBeforeUnmount(() => {
  mascotBox.shown = false
  window.removeEventListener('resize', settle)
  clearTimeout(patTimer)
  clearTimeout(quietTimer)
  clearTimeout(sulkTimer)
})
</script>

<template>
  <div class="mascot" :class="{ dragging }" :style="{ width: `${WIDTH}px`, height: `${HEIGHT}px`, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }">
    <div
      ref="body"
      class="body"
      :class="{ pressed, patting, flipped: flipped !== sulking }"
      aria-hidden="true"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dragstart.prevent
    >
      <div class="flip">
        <div ref="squashEl" class="squash">
          <div class="breathe">
            <img
              v-if="patting"
              class="pat"
              :src="patUrl"
              :width="PAT_SIZE"
              :height="PAT_SIZE"
              :style="{ bottom: `${PAT_BOTTOM}px` }"
              alt=""
              draggable="false"
            />
            <img v-else :src="imageUrl" :width="WIDTH" :height="HEIGHT" alt="" draggable="false" />
          </div>
        </div>
      </div>
    </div>
    <Transition name="bubble">
      <div v-if="bubble && !dragging" ref="bubbleEl" class="bubble" :class="{ below: bubbleBelow, left: flipped }" role="status">
        <p class="line">{{ bubble.text }}</p>
        <div v-if="bubble.actions?.length" class="actions">
          <n-button
            v-for="(action, index) in bubble.actions"
            :key="action.label"
            size="small"
            :type="index === 0 ? 'primary' : 'default'"
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
:global(html.dark) .bubble {
  --bubble-line: #7f94d4;
  --bubble-bg: #1f2230;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.bubble::after {
  content: '';
  position: absolute;
  right: 40px;
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
  left: 40px;
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
.dragging .breathe,
.patting .breathe {
  animation-play-state: paused;
}

img {
  display: block;
  pointer-events: none;
  -webkit-user-drag: none;
}
img.pat {
  position: absolute;
  right: 0;
  max-width: none;
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

@media (prefers-reduced-motion: reduce) {
  .breathe {
    animation: none;
  }
}
@media print {
  .mascot {
    display: none;
  }
}
</style>
