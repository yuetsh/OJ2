<script setup lang="ts">
import { Icon } from "@iconify/vue"
import { useThemeVars } from "naive-ui"
import { resetAvatar, uploadAvatar } from "oj/api"
import RankAvatar from "shared/components/RankAvatar.vue"
import { useUserStore } from "shared/store/user"

/**
 * 换头像（设置并进主页之后的入口）：选一张图，拖圆圈选一块，旁边就是它在领奖台、
 * 排名里的大小；也能退回「名字的字」。
 *
 * 裁剪在浏览器里做完、只传一张 256×256 的 JPEG 上去 —— 原来直接传原图、靠
 * object-fit 居中截，脸常常被截掉一半；手机拍的照片也动辄好几 MB，过不了 2 MB 的限制。
 */
const props = defineProps<{ username: string; avatar: string | null }>()
const emit = defineEmits<{ changed: [] }>()
const show = defineModel<boolean>("show", { required: true })

const theme = useThemeVars()
const message = useMessage()
const userStore = useUserStore()

const STAGE = 280
const OUTPUT = 256

const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const src = ref("")
let image: HTMLImageElement | null = null
/** 图片在 280×280 舞台里的位置（等比缩放、居中） */
const fit = reactive({ x: 0, y: 0, w: 0, h: 0, scale: 1 })
/** 圆圈：圆心和半径，舞台坐标 */
const circle = reactive({ cx: 0, cy: 0, r: 0 })
const saving = ref(false)

const maxR = computed(() => Math.min(fit.w, fit.h) / 2)
const minR = computed(() => Math.min(24, maxR.value))

function clamp() {
  circle.r = Math.min(maxR.value, Math.max(minR.value, circle.r))
  circle.cx = Math.min(fit.x + fit.w - circle.r, Math.max(fit.x + circle.r, circle.cx))
  circle.cy = Math.min(fit.y + fit.h - circle.r, Math.max(fit.y + circle.r, circle.cy))
}

function pick() {
  fileInput.value?.click()
}

function clear() {
  if (src.value) URL.revokeObjectURL(src.value)
  src.value = ""
  image = null
}

watch(show, (open) => {
  if (!open) clear()
})
onBeforeUnmount(clear)

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  if (!file.type.startsWith("image/")) {
    message.warning("要选一张图片")
    return
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    clear()
    image = img
    src.value = url
    const scale = Math.min(STAGE / img.naturalWidth, STAGE / img.naturalHeight)
    fit.scale = scale
    fit.w = img.naturalWidth * scale
    fit.h = img.naturalHeight * scale
    fit.x = (STAGE - fit.w) / 2
    fit.y = (STAGE - fit.h) / 2
    circle.cx = STAGE / 2
    circle.cy = STAGE / 2
    circle.r = maxR.value * 0.9
    clamp()
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    message.warning("这张图打不开，换一张试试")
  }
  img.src = url
}

let drag: { x: number; y: number; cx: number; cy: number } | null = null

function onDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, cx: circle.cx, cy: circle.cy }
}

function onMove(event: PointerEvent) {
  if (!drag) return
  circle.cx = drag.cx + event.clientX - drag.x
  circle.cy = drag.cy + event.clientY - drag.y
  clamp()
}

function onUp() {
  drag = null
}

function onWheel(event: WheelEvent) {
  circle.r -= event.deltaY * 0.1
  clamp()
}

/** 「大小」滑块：0–100 对应最小到最大的半径 */
const size = computed({
  get: () =>
    maxR.value > minR.value
      ? Math.round(((circle.r - minR.value) / (maxR.value - minR.value)) * 100)
      : 100,
  set: (value: number) => {
    circle.r = minR.value + ((maxR.value - minR.value) * value) / 100
    clamp()
  },
})

/** 预览：同一块按目标大小缩放，用背景图画，不用再开一个 canvas */
function previewStyle(px: number) {
  const k = px / (circle.r * 2)
  return {
    width: `${px}px`,
    height: `${px}px`,
    backgroundImage: `url(${src.value})`,
    backgroundSize: `${fit.w * k}px ${fit.h * k}px`,
    backgroundPosition: `${-(circle.cx - circle.r - fit.x) * k}px ${-(circle.cy - circle.r - fit.y) * k}px`,
  }
}

async function save() {
  if (!image) return
  const canvas = document.createElement("canvas")
  canvas.width = OUTPUT
  canvas.height = OUTPUT
  const ctx = canvas.getContext("2d")!
  // 透明底的 PNG 存成 JPEG 会变黑，先铺白
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, OUTPUT, OUTPUT)
  const side = (circle.r * 2) / fit.scale
  ctx.drawImage(
    image,
    (circle.cx - circle.r - fit.x) / fit.scale,
    (circle.cy - circle.r - fit.y) / fit.scale,
    side,
    side,
    0,
    0,
    OUTPUT,
    OUTPUT,
  )
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  )
  if (!blob) {
    message.error("没处理好这张图，换一张试试")
    return
  }
  saving.value = true
  try {
    await uploadAvatar(new File([blob], "avatar.jpg", { type: "image/jpeg" }))
    message.success("头像换好了")
    userStore.getMyProfile()
    emit("changed")
    show.value = false
  } catch {
    message.error("没传上去，再试一次")
  } finally {
    saving.value = false
  }
}

async function useLetter() {
  saving.value = true
  try {
    await resetAvatar()
    message.success("改成名字的字了")
    userStore.getMyProfile()
    emit("changed")
    show.value = false
  } catch {
    message.error("没改成，再试一次")
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="换头像"
    :style="{ width: '520px', maxWidth: 'calc(100vw - 32px)' }"
    :bordered="false"
  >
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
    <div class="body">
      <div
        v-if="src"
        class="stage"
        :style="{ width: `${STAGE}px`, height: `${STAGE}px` }"
        @wheel.prevent="onWheel"
      >
        <img
          :src="src"
          alt=""
          draggable="false"
          :style="{
            left: `${fit.x}px`,
            top: `${fit.y}px`,
            width: `${fit.w}px`,
            height: `${fit.h}px`,
          }"
        />
        <span
          class="circle"
          role="slider"
          aria-label="拖动选一块"
          :aria-valuenow="size"
          :style="{
            left: `${circle.cx - circle.r}px`,
            top: `${circle.cy - circle.r}px`,
            width: `${circle.r * 2}px`,
            height: `${circle.r * 2}px`,
          }"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        ></span>
      </div>
      <button v-else type="button" class="stage empty" @click="pick">
        <RankAvatar :username="username" :avatar="avatar" :size="160" me />
        <span class="pick"><Icon icon="ph:image" :width="18" />选一张图片</span>
      </button>

      <div class="side">
        <template v-if="src">
          <span class="muted">拖动圆圈选一块</span>
          <span class="preview"><span class="dot" :style="previewStyle(56)"></span>领奖台</span>
          <span class="preview"><span class="dot" :style="previewStyle(28)"></span>排名、顶栏</span>
          <label class="size">
            <span class="muted">大小</span>
            <n-slider v-model:value="size" :step="1" :tooltip="false" />
          </label>
          <n-button size="small" class="fit" @click="pick">
            <template #icon><Icon icon="ph:image" /></template>换一张
          </n-button>
        </template>
        <template v-else>
          <span class="preview">
            <RankAvatar :username="username" :avatar="avatar" :size="56" me />领奖台
          </span>
          <span class="preview">
            <RankAvatar :username="username" :avatar="avatar" :size="28" me />排名、顶栏
          </span>
        </template>
        <a
          v-if="avatar || src"
          href="#"
          class="link"
          :class="{ disabled: saving }"
          @click.prevent="!saving && useLetter()"
        >
          不用图片，用名字的字
        </a>
      </div>
    </div>
    <template #footer>
      <div class="footer">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :disabled="!src" :loading="saving" @click="save">
          用这张
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.body {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
}

.stage {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 6px;
  background: v-bind("theme.actionColor");
  touch-action: none;
  user-select: none;
}

.stage img {
  position: absolute;
  pointer-events: none;
}

.circle {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 600px rgba(0, 0, 0, 0.5);
  cursor: move;
}

.stage.empty {
  width: 280px;
  height: 280px;
  border: 1px dashed v-bind("theme.borderColor");
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  cursor: pointer;
  font: inherit;
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #18a058;
  font-size: var(--oj-fs-sec);
}

.side {
  flex: 1;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--oj-fs-meta);
}

.muted {
  color: v-bind("theme.textColor3");
}

.preview {
  display: flex;
  align-items: center;
  gap: 10px;
  color: v-bind("theme.textColor3");
}

.dot {
  flex-shrink: 0;
  border-radius: 50%;
  background-repeat: no-repeat;
}

.size {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fit {
  align-self: flex-start;
}

.link {
  color: #18a058;
  text-decoration: none;
}

.link.disabled {
  opacity: 0.5;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
