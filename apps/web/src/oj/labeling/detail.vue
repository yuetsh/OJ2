<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useThemeVars } from 'naive-ui'
import type { AnswerLabelingResponse, LabelingDetail, LabelingSpan } from '@oj2/contract'
import Markdown from 'shared/components/Markdown.vue'
import { useAuthModalStore } from 'shared/store/authModal'
import { useUserStore } from 'shared/store/user'
import { errorMessage } from 'utils/api'
import { answerLabeling, getLabeling, resetLabeling } from 'oj/api'
import LabelingImage from './components/LabelingImage.vue'
import SpanPicker from './components/SpanPicker.vue'
import SpanText from './components/SpanText.vue'
import { labelColor, titlePieces } from './utils/colors'

/**
 * 学生做一节「数据标注」（画布 LabelStudent / LabelSpanStudent），手机为先：
 * 一次一条，只能往前；分类点一下标签就判，实体标注标完点「提交」才判。
 * 错了只说「不对」（实体标注说哪类问题），可以再改；对了显示理由，点「下一条」。
 * 做完了显示一次就对几条和错题，不重做（老师有「重来」）。规则见设计文档第 4、8 节和 3.5 节。
 */
const props = defineProps<{ labelingID: string }>()

const theme = useThemeVars()
const isDark = useDark()
const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const userStore = useUserStore()
const authModal = useAuthModalStore()

const labelingId = computed(() => Number(props.labelingID))
const detail = ref<LabelingDetail | null>(null)
const notFound = ref(false)

/** 这一条交过之后的结果；换下一条时清空 */
const verdict = ref<AnswerLabelingResponse | null>(null)
/** 分类：点过的标签（错的那个标橙，对的标绿） */
const picked = ref<string | null>(null)
const spans = ref<LabelingSpan[]>([])
const sending = ref(false)

const current = computed(() => detail.value?.current ?? null)
/** 实体标注：标题里的类别名铺颜色；标题没写全类别，就在标题下补一行带色块的类别（设计稿 LabelSpanDesk） */
const title = computed(() => {
  const d = detail.value
  if (!d || d.kind !== 'span') return { pieces: [{ text: d?.title ?? '', label: null }], missing: false }
  return titlePieces(d.title, d.labels)
})
const result = computed(() => detail.value?.result ?? null)
const correct = computed(() => verdict.value?.correct === true)

async function load() {
  try {
    detail.value = await getLabeling(labelingId.value)
    verdict.value = null
    picked.value = null
    spans.value = []
  } catch {
    notFound.value = true
  }
}

function needLogin() {
  if (userStore.isAuthed) return false
  authModal.openLoginModal()
  return true
}

async function send(body: { label?: string; spans?: LabelingSpan[] }) {
  if (!current.value || sending.value || correct.value || needLogin()) return
  sending.value = true
  try {
    verdict.value = await answerLabeling(labelingId.value, current.value.id, body)
  } catch (err) {
    message.error(errorMessage(err, '没交上'))
  } finally {
    sending.value = false
  }
}

function pick(label: string) {
  picked.value = label
  send({ label })
}

function submitSpans() {
  send({ spans: spans.value })
}

// 改了标注，上一次的「不对」就不算数了
watch(spans, () => {
  if (verdict.value && !verdict.value.correct) verdict.value = null
})

function optionClass(label: string) {
  if (picked.value !== label || !verdict.value) return { dim: correct.value }
  return verdict.value.correct ? 'ok' : 'no'
}

const progressPercent = computed(() => {
  const d = detail.value
  if (!d?.total) return 0
  return ((d.passedCount + (correct.value ? 1 : 0)) / d.total) * 100
})

function reset() {
  dialog.warning({
    title: '重来？',
    content: '清掉你自己在这一节的作答，从第 1 条重新做。学生的不受影响。',
    positiveText: '重来',
    negativeText: '算了',
    onPositiveClick: async () => {
      try {
        await resetLabeling(labelingId.value)
        await load()
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

onMounted(load)
</script>

<template>
  <div class="oj-page labelingPage">
    <n-empty v-if="notFound" description="这一节不存在" />
    <n-spin v-else-if="!detail" size="small" />
    <template v-else>
      <router-link :to="{ name: 'labelings' }" class="back"><Icon icon="ph:caret-left-bold" />数据标注</router-link>
      <h1 class="title">
        <span
          ><template v-for="(p, i) in title.pieces" :key="i"
            ><span
              v-if="p.label"
              class="titleMark"
              :style="{ background: labelColor(detail.labels, p.label, isDark).bg, color: labelColor(detail.labels, p.label, isDark).fg }"
              >{{ p.text }}</span
            ><template v-else>{{ p.text }}</template></template
          ></span
        >
        <n-tag v-if="!detail.isPublic" size="small" :bordered="false" type="warning">没公开</n-tag>
      </h1>

      <div v-if="detail.kind === 'span' && title.missing" class="legend">
        <span v-for="label in detail.labels" :key="label" class="legendItem"
          ><span class="swatch" :style="{ background: labelColor(detail.labels, label, isDark).swatch }"></span>{{ label }}</span
        >
      </div>

      <div v-if="userStore.isTeacherOrAbove" class="teacherBar">
        <n-button v-if="detail.canReset && (detail.passedCount || result)" @click="reset">重来</n-button>
        <n-button @click="router.push({ name: 'labeling progress', params: { labelingID } })">看全班</n-button>
        <n-button @click="router.push({ name: 'admin labeling edit', params: { labelingID } })">编辑</n-button>
      </div>

      <Markdown v-if="detail.description.trim() && current?.index === 1" :content="detail.description" class="desc" />

      <n-empty v-if="!detail.total" description="这一节还没有数据" />

      <!-- 做完了 -->
      <template v-else-if="result">
        <section class="card summary">
          <span class="doneText">做完了</span>
          <span class="sec">一次就对</span>
          <span class="big"
            >{{ result.firstCorrect }}<span class="of"> / {{ detail.total }}</span></span
          >
        </section>
        <section v-if="result.wrong.length" class="card wrongList">
          <b class="wrongHead">第一次{{ detail.kind === 'span' ? '没全对' : '标错' }}的 {{ result.wrong.length }} 条</b>
          <div v-for="w in result.wrong" :key="w.id" class="wrong">
            <template v-if="detail.kind === 'span'">
              <div class="lab">应该是</div>
              <SpanText :text="w.text" :spans="w.spans" :labels="detail.labels" class="line" />
              <div class="lab">你第一次标的</div>
              <SpanText :text="w.text" :spans="w.firstSpans ?? []" :labels="detail.labels" class="line" />
            </template>
            <template v-else>
              <div v-if="w.hasImage" class="thumb"><LabelingImage :labeling-id="detail.id" :item-id="w.id" /></div>
              <div v-else class="line">{{ w.text }}</div>
              <div class="picks">
                <span class="pickNo">你选了 {{ w.firstLabel }}</span>
                <span class="pickOk">应该是 {{ w.answer }}</span>
              </div>
            </template>
            <div v-if="w.reason" class="reason">{{ w.reason }}</div>
          </div>
        </section>
      </template>

      <!-- 一次一条 -->
      <template v-else-if="current">
        <div class="progress">
          <span class="track"><span class="fill" :style="{ width: `${progressPercent}%` }"></span></span>
          <span
            ><b>{{ current.index }}</b> / {{ detail.total }}</span
          >
        </div>

        <template v-if="detail.kind === 'span'">
          <SpanPicker v-model="spans" :text="current.text" :labels="detail.labels" :disabled="correct" />
        </template>
        <template v-else>
          <div v-if="current.hasImage" class="card imageBox"><LabelingImage :labeling-id="detail.id" :item-id="current.id" /></div>
          <div v-else class="card dataText">{{ current.text }}</div>
          <div class="options" :class="{ grid: detail.labels.length > 2 }">
            <button v-for="label in detail.labels" :key="label" type="button" class="opt" :class="optionClass(label)" :disabled="sending" @click="pick(label)">
              <Icon v-if="correct && picked === label" icon="ph:check-bold" />{{ label }}
            </button>
          </div>
        </template>

        <div v-if="verdict && !verdict.correct" class="say no">{{ verdict.feedback }}</div>
        <div v-if="correct && verdict?.reason" class="say ok">{{ verdict.reason }}</div>

        <n-button v-if="correct" type="primary" size="large" block class="mainBtn" @click="load">下一条</n-button>
        <n-button v-else-if="detail.kind === 'span'" type="primary" size="large" block class="mainBtn" :loading="sending" @click="submitSpans">提交</n-button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.labelingPage {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 15px;
  color: var(--oj-link);
  text-decoration: none;
  align-self: flex-start;
}

.title {
  margin: 0;
  font-size: 20px;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.titleMark {
  padding: 1px 5px;
  margin: 0 2px;
  border-radius: 5px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 15px;
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.desc {
  font-size: 15px;
}

.teacherBar {
  display: flex;
  gap: 10px;
}

.teacherBar > * {
  flex: 1 1 0;
}

.card {
  border: 1px solid v-bind('theme.borderColor');
  border-radius: 10px;
  background: v-bind('theme.cardColor');
}

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.track {
  flex: 1 1 auto;
  height: 8px;
  border-radius: 4px;
  background: v-bind('theme.dividerColor');
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: v-bind('theme.primaryColor');
  transition: width 0.3s;
}

.dataText {
  padding: 22px 18px;
  font-size: 19px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.imageBox {
  overflow: hidden;
  height: min(60vw, 360px);
  min-height: 220px;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.options.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.opt {
  min-height: 54px;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1.5px solid v-bind('theme.borderColor');
  border-radius: 8px;
  background: v-bind('theme.cardColor');
  font: inherit;
  font-size: 18px;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.opt.ok {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.12);
  color: v-bind('theme.primaryColor');
  font-weight: 700;
}

.opt.no {
  border-color: #e08a00;
  background: rgba(240, 160, 32, 0.12);
}

.opt.dim {
  opacity: 0.45;
}

.say {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 16px;
  line-height: 1.7;
}

.say.ok {
  background: rgba(24, 160, 88, 0.12);
}

.say.no {
  background: rgba(240, 160, 32, 0.16);
  font-weight: 600;
}

.mainBtn {
  margin-top: 6px;
  height: 52px;
  font-size: 18px;
}

.summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 18px 16px;
}

.doneText {
  font-size: 16px;
  font-weight: 600;
  color: v-bind('theme.primaryColor');
}

.big {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.of {
  font-size: 22px;
  font-weight: 400;
  color: v-bind('theme.textColor3');
}

.sec {
  color: v-bind('theme.textColor3');
  font-size: 15px;
}

.wrongList {
  padding: 14px 16px 4px;
  display: flex;
  flex-direction: column;
}

.wrongHead {
  font-size: 16px;
  padding-bottom: 6px;
}

.wrong {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid v-bind('theme.dividerColor');
}

.line {
  font-size: 16px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.lab {
  font-size: 13px;
  color: v-bind('theme.textColor3');
}

.thumb {
  height: 160px;
  border-radius: 6px;
  overflow: hidden;
  background: v-bind('theme.actionColor');
}

.picks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 15px;
}

.pickNo {
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(240, 160, 32, 0.16);
}

.pickOk {
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(24, 160, 88, 0.14);
  font-weight: 600;
}

.reason {
  font-size: 15px;
  line-height: 1.6;
  color: v-bind('theme.textColor3');
}
</style>
