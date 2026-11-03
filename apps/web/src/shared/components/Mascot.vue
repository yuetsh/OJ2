<script setup lang="ts">
/**
 * 看板娘。只陪着，不干别的。现在只有一个形象（大肥鱼）。
 *
 * 形象取自 MeteorNOX/DeepSeek-Balance-Whale-Widget 的 assets/DSniang1.png（裁掉透明边、缩到 2 倍显示尺寸转 webp）。
 * 那个仓库的代码是 MIT，但 assets/ 下的图不在 MIT 里（见它的 PROVENANCE.md）。
 *
 * - 常驻在前台页面的角落，能拖；松手按「四分之一区」贴边：中心落在左/右四分之一就贴左/右缘，
 *   上/下四分之一就贴上/下缘，中间保持松手的位置。两个方向各判各的，所以能贴进角落。
 * - 在屏幕左半边时整体镜像，脸总朝着页面中间。
 * - 按下去像玩偶一样压扁（底边不动），松手弹回；点一下蹦一下。
 * - 彩蛋：连着快点，有时候（每轮三分之一的机会）点到第 4～8 下（也是随机的）会被摸摸头（同一个仓库的 assets/rua.gif），摸的时候接着点就一直摸。
 *
 * 位置只是这台电脑上的个人偏好，存 localStorage（读写都包 try/catch，拿不到就用默认位置）。
 * 定位一律用 transform 的像素值：贴右缘时若换成 right:0，过渡没法在 auto 和数值之间插值，会瞬移。
 */
import imageUrl from 'shared/assets/mascot/whale.webp'
import patUrl from 'shared/assets/mascot/whale-pat.gif'

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
const hop = ref(false)
const patting = ref(false)
const flipped = ref(false)
const root = ref<HTMLElement>()

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

let start: { px: number; py: number; x: number; y: number } | null = null
let moved = false

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 不拦的话，第一下甩得快时浏览器会拿光标新位置底下的东西（比如题目列表的链接）开始原生拖拽，
  // 随即发 pointercancel，看板娘就卡在半路
  e.preventDefault()
  root.value?.setPointerCapture(e.pointerId)
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

// 动图 94KB，不在每个页面一打开就下：连点到第 2 下才预载，最少也还要再点两下才用得上
let patPreloaded = false
function preloadPat() {
  if (patPreloaded) return
  patPreloaded = true
  new Image().src = patUrl
}

let patTimer: ReturnType<typeof setTimeout> | undefined
let hopTimer: ReturnType<typeof setTimeout> | undefined
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
    return
  }
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
    hop.value = false
    patting.value = true
    clearTimeout(patTimer)
    patTimer = setTimeout(() => {
      patting.value = false
      streak = 0
    }, PAT_MS)
    return
  }

  // 平时：蹦一下。连点就从头再蹦
  hop.value = false
  clearTimeout(hopTimer)
  requestAnimationFrame(() => {
    hop.value = true
    hopTimer = setTimeout(() => (hop.value = false), 500)
  })
}

onMounted(() => {
  settle()
  window.addEventListener('resize', settle, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', settle)
  clearTimeout(patTimer)
  clearTimeout(hopTimer)
})
</script>

<template>
  <div
    ref="root"
    class="mascot"
    :class="{ dragging, pressed, hop, patting, flipped }"
    :style="{ width: `${WIDTH}px`, height: `${HEIGHT}px`, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }"
    aria-hidden="true"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @dragstart.prevent
  >
    <div class="flip">
      <div class="squash">
        <div class="breathe">
          <img v-if="patting" class="pat" :src="patUrl" :width="PAT_SIZE" :height="PAT_SIZE" :style="{ bottom: `${PAT_BOTTOM}px` }" alt="" draggable="false" />
          <img v-else :src="imageUrl" :width="WIDTH" :height="HEIGHT" alt="" draggable="false" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mascot {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 900; /* 压在页面上，但让弹框、消息、烟花盖住它 */
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1);
  will-change: transform;
}
.mascot.dragging {
  cursor: grabbing;
  transition: none;
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
.hop .squash {
  animation: mascot-hop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
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

@keyframes mascot-hop {
  0% {
    transform: translateY(0) scale(1.05, 0.88);
  }
  45% {
    transform: translateY(-16px) scale(0.97, 1.05);
  }
  100% {
    transform: translateY(0) scale(1, 1);
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
