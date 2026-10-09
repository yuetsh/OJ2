<script setup lang="ts">
import { useThemeVars } from "naive-ui"
import PageHeader from "admin/components/PageHeader.vue"
import { errorMessage } from "utils/api"
import { fromPickerValue, parseTime, toPickerValue, zonedParts } from "utils/functions"
import type { AdminProblemRow, AdminProblemSet, AdminProblemSetBadge } from "utils/types"
import {
  addProblemsToSet,
  createProblemSet,
  createProblemSetBadge,
  deleteProblemSet,
  deleteProblemSetBadge,
  editProblemSet,
  editProblemSetBadge,
  getLibraryProblemList,
  getProblemSetBadges,
  getProblemSetDetail,
  getProblemSetProblems,
  removeProblemFromSet,
  reorderProblemSetProblems,
  setProblemRequired,
  type BadgeBody,
} from "../api"
import BadgeModal from "./components/BadgeModal.vue"

/**
 * 新建 / 编辑题单，一屏做完（设计稿「题单重设计」后台那块）：左边名字、说明、布置期、公开；
 * 右边题目（搜题号或一次粘贴好几个、拖动排序、点一下切选做）和奖章。
 *
 * 布置期：选「布置到哪天」，布置期内这几道题学生以前交的代码先藏起来（防抄），不拦做题。
 * 新建时题目先攒在页面上，保存时建好题单再一次加进去；编辑时加、删、排、切选做当场生效。
 */
const props = defineProps<{ problemSetId?: string }>()

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const theme = useThemeVars()

const editing = computed(() => !!props.problemSetId)
const id = computed(() => Number(props.problemSetId))
const ready = ref(false)
const saving = ref(false)
const current = ref<AdminProblemSet | null>(null)

const form = reactive({ title: "", description: "", visible: true })

// ---------------------------------------------------------------- 布置期

const DAY = 86_400_000
const OFFSET = 8 * 3_600_000
const CHOICES = [
  { days: 7, label: "一周" },
  { days: 14, label: "两周" },
  { days: 28, label: "四周" },
]
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]

/** 东八区某一天结束的时刻（23:59:59.999） */
function endOfDay(ms: number) {
  const parts = zonedParts(new Date(ms))!
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - OFFSET - 1
}

/** "none" 不布置 / 天数 / "pick" 自己选日期 */
const choice = ref<"none" | "pick" | number>(14)
const picked = ref(toPickerValue(Date.now() + 14 * DAY))

const untilMs = computed(() => {
  if (choice.value === "none") return null
  if (choice.value === "pick") return endOfDay(fromPickerValue(picked.value))
  return endOfDay(Date.now() + choice.value * DAY)
})

function dayText(ms: number) {
  const iso = new Date(ms).toISOString()
  return `${parseTime(iso, "M月D日")} 周${WEEKDAYS[new Date(ms + OFFSET).getUTCDay()]}`
}

const running = computed(() => !!current.value?.assigning)
const expired = computed(
  () => !!current.value && !current.value.assigning && !!current.value.assignedUntil,
)

const assignHint = computed(() => {
  if (untilMs.value === null) {
    return running.value
      ? "保存后马上结束布置，以前的代码都放出来。"
      : "不布置：学生照样能加入、做题，只是不藏以前的代码。"
  }
  if (untilMs.value <= Date.now()) return "这一天已经过了，选个以后的日子。"
  const head = `布置到 ${dayText(untilMs.value)}。`
  return running.value
    ? `${head}这一轮从 ${parseTime(current.value!.assignedAt!, "M月D日")} 开始，改日期只是延长或提前结束。`
    : `${head}${expired.value ? "上一轮已经结束，保存就是再布置一次。" : ""}`
})

const disabledDate = (ts: number) => fromPickerValue(ts) + DAY <= Date.now()

// ---------------------------------------------------------------- 题目

type Item = { id: number; displayId: string; title: string; isRequired: boolean }
const items = ref<Item[]>([])

async function loadProblems() {
  const rows = await getProblemSetProblems(id.value)
  items.value = rows.map((row) => ({
    id: row.id,
    displayId: row.problemDisplayId,
    title: row.title,
    isRequired: row.isRequired,
  }))
}

const keyword = ref("")
const results = ref<AdminProblemRow[]>([])
const searching = ref(false)

/** 输入框里粘了好几个题号（空格、逗号、顿号隔开） */
const pasted = computed(() => {
  const parts = keyword.value
    .split(/[\s,，、;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : []
})

watchDebounced(
  keyword,
  async (value) => {
    if (!value.trim() || pasted.value.length) {
      results.value = []
      return
    }
    searching.value = true
    try {
      results.value = (await getLibraryProblemList(0, 8, value.trim())).results
    } finally {
      searching.value = false
    }
  },
  { debounce: 300 },
)

const added = (displayId: string) =>
  items.value.some((item) => item.displayId.toLowerCase() === displayId.toLowerCase())

async function addMany(displayIds: string[], titles = new Map<string, string>()) {
  if (!editing.value) {
    // 新建时先攒着；题目名要查一次，粘贴进来的题号只有号
    for (const typed of displayIds) {
      if (added(typed)) continue
      let displayId = typed
      let title = titles.get(typed)
      if (!title) {
        const found = (await getLibraryProblemList(0, 5, typed)).results.find(
          (row) => row._id.toLowerCase() === typed.toLowerCase(),
        )
        if (!found) {
          message.warning(`题号 ${typed} 找不到（或者没公开）`)
          continue
        }
        title = found.title
        displayId = found._id
      }
      items.value.push({ id: 0, displayId, title, isRequired: true })
    }
    keyword.value = ""
    return
  }
  try {
    const res = await addProblemsToSet(id.value, displayIds)
    const notes = []
    if (res.missing.length) notes.push(`找不到：${res.missing.join("、")}`)
    if (res.duplicate.length) notes.push(`已经在里面：${res.duplicate.join("、")}`)
    if (notes.length) message.warning(notes.join("；"))
    else message.success(`加了 ${res.added.length} 道`)
    keyword.value = ""
    await Promise.all([loadProblems(), reloadSet()])
  } catch (err) {
    message.error(errorMessage(err))
  }
}

function addRow(row: AdminProblemRow) {
  addMany([row._id], new Map([[row._id, row.title]]))
}

async function toggleRequired(item: Item) {
  item.isRequired = !item.isRequired
  if (!editing.value) return
  try {
    await setProblemRequired(id.value, item.id, item.isRequired)
  } catch (err) {
    item.isRequired = !item.isRequired
    message.error(errorMessage(err))
  }
}

function remove(item: Item) {
  if (!editing.value) {
    items.value = items.value.filter((it) => it !== item)
    return
  }
  dialog.warning({
    title: "从题单里拿掉这道题？",
    content: `「${item.title}」。已经加入的 ${current.value?.participantCount ?? 0} 个人的进度会重算，题目本身不受影响。`,
    positiveText: "拿掉",
    negativeText: "不拿",
    onPositiveClick: async () => {
      try {
        await removeProblemFromSet(id.value, item.id)
        await Promise.all([loadProblems(), reloadSet()])
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

// 拖动排序：原生 drag & drop，和比赛出卷那页同一套
const dragging = ref<number | null>(null)
function onDragStart(index: number) {
  dragging.value = index
}
function onDragEnter(index: number) {
  const from = dragging.value
  if (from === null || from === index) return
  const list = [...items.value]
  const [moved] = list.splice(from, 1)
  list.splice(index, 0, moved!)
  items.value = list
  dragging.value = index
}
async function onDragEnd() {
  if (dragging.value === null) return
  dragging.value = null
  if (!editing.value) return
  try {
    await reorderProblemSetProblems(
      id.value,
      items.value.map((item) => item.id),
    )
  } catch (err) {
    message.error(errorMessage(err))
    await loadProblems()
  }
}

const optionalCount = computed(() => items.value.filter((item) => !item.isRequired).length)

// ---------------------------------------------------------------- 奖章

const badges = ref<AdminProblemSetBadge[]>([])
const badgeModal = ref(false)
const editingBadge = ref<AdminProblemSetBadge | null>(null)

function badgeCondition(badge: AdminProblemSetBadge) {
  return badge.conditionType === "all_problems" ? "全部做完" : `做对 ${badge.conditionValue} 道`
}

function openBadge(badge: AdminProblemSetBadge | null) {
  editingBadge.value = badge
  badgeModal.value = true
}

async function saveBadge(data: BadgeBody) {
  try {
    if (editingBadge.value) await editProblemSetBadge(id.value, editingBadge.value.id, data)
    else await createProblemSetBadge(id.value, data)
    badgeModal.value = false
    badges.value = await getProblemSetBadges(id.value)
  } catch (err) {
    message.error(errorMessage(err))
  }
}

function removeBadge(badge: AdminProblemSetBadge) {
  dialog.warning({
    title: `删掉奖章「${badge.name}」？`,
    content: badge.earnedCount
      ? `已经拿到它的 ${badge.earnedCount} 个人也会一起被收回。`
      : "还没有人拿到它。",
    positiveText: "删掉",
    negativeText: "不删",
    onPositiveClick: async () => {
      try {
        await deleteProblemSetBadge(id.value, badge.id)
        badges.value = await getProblemSetBadges(id.value)
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

// ---------------------------------------------------------------- 载入 / 保存

async function reloadSet() {
  current.value = await getProblemSetDetail(id.value)
}

async function load() {
  keyword.value = ""
  if (!editing.value) {
    ready.value = true
    return
  }
  await reloadSet()
  const set = current.value!
  Object.assign(form, { title: set.title, description: set.description, visible: set.visible })
  if (set.assigning) {
    choice.value = "pick"
    picked.value = toPickerValue(Date.parse(set.assignedUntil!))
  } else {
    choice.value = "none"
  }
  await Promise.all([loadProblems(), getProblemSetBadges(id.value).then((b) => (badges.value = b))])
  ready.value = true
}

async function submit() {
  if (!form.title.trim()) {
    message.error("题单还没起名字")
    return
  }
  if (untilMs.value !== null && untilMs.value <= Date.now()) {
    message.error("布置到的日期已经过了")
    return
  }
  const body = {
    title: form.title.trim(),
    description: form.description.trim(),
    visible: form.visible,
    assignedUntil: untilMs.value === null ? null : new Date(untilMs.value).toISOString(),
  }
  saving.value = true
  try {
    if (editing.value) {
      current.value = await editProblemSet(id.value, body)
      message.success("改好了")
      return
    }
    const created = await createProblemSet(body)
    if (items.value.length) {
      await addProblemsToSet(
        created.id,
        items.value.map((item) => item.displayId),
      )
      const optional = items.value.filter((item) => !item.isRequired).map((item) => item.displayId)
      if (optional.length) {
        const rows = await getProblemSetProblems(created.id)
        for (const row of rows.filter((r) => optional.includes(r.problemDisplayId))) {
          await setProblemRequired(created.id, row.id, false)
        }
      }
    }
    message.success(
      items.value.length ? `题单建好了，${items.value.length} 道题都加进去了` : "题单建好了",
    )
    router.replace({ name: "admin problemset edit", params: { problemSetId: created.id } })
  } catch (err) {
    message.error(errorMessage(err))
  } finally {
    saving.value = false
  }
}

function removeSet() {
  const set = current.value!
  dialog.error({
    title: `删除题单「${set.title}」？`,
    content: set.participantCount
      ? `${set.participantCount} 个人的进度和他们拿到的奖章会一起删掉，找不回来。只是不想让学生看到的话，关掉「公开」就行。`
      : "还没有人加入。删掉找不回来。",
    positiveText: "删除",
    negativeText: "不删",
    onPositiveClick: async () => {
      try {
        await deleteProblemSet(set.id)
        router.replace({ name: "admin problemset list" })
      } catch (err) {
        message.error(errorMessage(err))
      }
    },
  })
}

watch(() => props.problemSetId, load)
onMounted(load)
</script>

<template>
  <PageHeader :title="editing ? '编辑题单' : '新建题单'" :back="{ name: 'admin problemset list' }">
    <template v-if="editing" #actions>
      <n-button tag="a" :href="`/problemset/${problemSetId}`" target="_blank">
        到前台看这个题单
      </n-button>
    </template>
  </PageHeader>

  <div v-if="ready" class="cols">
    <section class="card form">
      <div class="field">
        <span class="label">名字</span>
        <n-input v-model:value="form.title" placeholder="比如 字符串方法" maxlength="200" />
      </div>
      <div class="field">
        <span class="label">说明</span>
        <n-input v-model:value="form.description" placeholder="选填，比如：第 5 章 字符串方法" />
      </div>

      <div class="field top">
        <span class="label">布置</span>
        <div class="stack">
          <n-flex :size="6" align="center">
            <button class="chip" :class="{ on: choice === 'none' }" @click="choice = 'none'">
              不布置
            </button>
            <button
              v-for="c in CHOICES"
              :key="c.days"
              class="chip"
              :class="{ on: choice === c.days }"
              @click="choice = c.days"
            >
              {{ c.label }}
            </button>
            <button class="chip" :class="{ on: choice === 'pick' }" @click="choice = 'pick'">
              选日期…
            </button>
            <n-date-picker
              v-if="choice === 'pick'"
              v-model:value="picked"
              type="date"
              :is-date-disabled="disabledDate"
              style="width: 150px"
            />
          </n-flex>
          <span class="hint">{{ assignHint }}</span>
          <span class="hint">
            布置期内，题单里这几道题学生以前交的代码先藏起来（不管加没加入），在题单里做对或者到期后再放出来，防止照着旧答案抄。不拦做题，到期后照样能做、照样算进度。
          </span>
        </div>
      </div>

      <div class="field">
        <span class="label">公开</span>
        <n-switch v-model:value="form.visible" />
        <span class="hint">{{
          form.visible ? "学生能在题单列表里看到" : "藏起来，学生看不到也进不去"
        }}</span>
      </div>

      <div v-if="current" class="stats">
        <span>{{ current.participantCount }} 人加入 · {{ current.completedCount }} 人做完</span>
        <div class="spacer"></div>
        <a :href="`/problemset/${current.id}?tab=class`" target="_blank">看全班情况 ›</a>
      </div>

      <div class="save">
        <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
        <span class="hint"
          >{{ items.length }} 道题<template v-if="optionalCount">
            · {{ optionalCount }} 道选做</template
          ><template v-if="editing"> · {{ badges.length }} 个奖章</template></span
        >
        <div class="spacer"></div>
        <n-button v-if="editing" text type="error" @click="removeSet">删除题单</n-button>
      </div>
    </section>

    <div class="right">
      <section class="card picker">
        <div class="picker-head">
          <b>题目</b>
          <span class="hint">{{ items.length }} 道 · 拖动排顺序 · 点「必做」切成选做</span>
        </div>
        <n-input
          v-model:value="keyword"
          clearable
          :loading="searching"
          placeholder="搜题号或题目名；也能一次粘贴多个题号，如 3065 3066 3067"
          @keyup.enter="pasted.length && addMany(pasted)"
        />
        <div v-if="pasted.length" class="results">
          <div class="result">
            <span class="grow">粘贴了 {{ pasted.length }} 个题号：{{ pasted.join("、") }}</span>
            <n-button size="small" type="primary" @click="addMany(pasted)">全部加进来</n-button>
          </div>
        </div>
        <div v-else-if="results.length" class="results">
          <div v-for="row in results" :key="row.id" class="result">
            <span class="muted num">{{ row._id }}</span>
            <span class="ell grow">{{ row.title }}</span>
            <span v-if="added(row._id)" class="muted tiny">已加入</span>
            <n-button v-else size="small" text type="primary" @click="addRow(row)">+ 加入</n-button>
          </div>
        </div>

        <div v-if="items.length" class="list">
          <div
            v-for="(item, index) in items"
            :key="item.displayId"
            class="item"
            :class="{ dragging: dragging === index }"
            draggable="true"
            @dragstart="onDragStart(index)"
            @dragenter.prevent="onDragEnter(index)"
            @dragover.prevent
            @dragend="onDragEnd"
          >
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <b class="num idx">{{ index + 1 }}</b>
            <span class="muted num tiny pid">{{ item.displayId }}</span>
            <span class="ell grow">{{ item.title }}</span>
            <button
              class="chip small"
              :class="{ dashed: item.isRequired }"
              :title="item.isRequired ? '点一下改成选做' : '点一下改回必做'"
              @click="toggleRequired(item)"
            >
              {{ item.isRequired ? "必做" : "选做" }}
            </button>
            <n-button size="small" text :aria-label="`拿掉 ${item.title}`" @click="remove(item)"
              >✕</n-button
            >
          </div>
        </div>
        <div v-else class="empty hint">还没加题。在上面输入题号，比如 3065</div>
      </section>

      <section class="card picker">
        <div class="picker-head">
          <b>奖章</b>
          <span class="hint">学生做对几道就发；改了条件会按现有进度重发</span>
          <div class="spacer"></div>
          <n-button v-if="editing" size="small" @click="openBadge(null)">+ 加奖章</n-button>
        </div>
        <div v-if="!editing" class="empty hint">先保存题单，再加奖章</div>
        <div v-else-if="badges.length" class="list">
          <div v-for="badge in badges" :key="badge.id" class="item badge">
            <img :src="badge.icon" alt="" class="badge-icon" />
            <b class="ell badge-name">{{ badge.name }}</b>
            <span class="chip small static">{{ badgeCondition(badge) }}</span>
            <span class="muted ell grow tiny">{{ badge.description }}</span>
            <span class="muted num tiny">{{ badge.earnedCount }} 人拿到</span>
            <n-button size="small" text type="primary" @click="openBadge(badge)">改</n-button>
            <n-button
              size="small"
              text
              :aria-label="`删掉 ${badge.name}`"
              @click="removeBadge(badge)"
              >✕</n-button
            >
          </div>
        </div>
        <div v-else class="empty hint">还没有奖章。比如「做对 3 道」发一个、「全部做完」发一个</div>
      </section>
    </div>
  </div>

  <BadgeModal
    v-model:show="badgeModal"
    :badge="editingBadge"
    :problems-count="items.length"
    @save="saveBadge"
  />
</template>

<style scoped>
.cols {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}

.card {
  box-sizing: border-box;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  background: v-bind("theme.cardColor");
}

.form {
  flex: 1 1 420px;
  max-width: 480px;
}

.right {
  flex: 999 1 480px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.picker {
  gap: 10px;
}

.picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.picker-head b {
  font-size: 15px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field.top {
  align-items: flex-start;
}

.field.top .label {
  line-height: 28px;
}

.label {
  width: 40px;
  flex-shrink: 0;
  font-size: 13px;
  color: v-bind("theme.textColor2");
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.grow {
  flex-grow: 1;
  min-width: 0;
}

.spacer {
  flex-grow: 1;
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: v-bind("theme.textColor3");
}

.muted {
  color: v-bind("theme.textColor3");
}

.tiny {
  font-size: 12px;
  flex-shrink: 0;
}

.num {
  font-variant-numeric: tabular-nums;
}

.ell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid v-bind("theme.borderColor");
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: v-bind("theme.textColor2");
  cursor: pointer;
  white-space: nowrap;
}

.chip.on {
  border-color: v-bind("theme.primaryColor");
  color: v-bind("theme.primaryColor");
  font-weight: 600;
}

.chip.small {
  height: 22px;
  padding: 0 8px;
  font-size: 12px;
  flex-shrink: 0;
}

.chip.dashed {
  border-style: dashed;
  color: v-bind("theme.textColor3");
}

.chip.static {
  cursor: default;
}

.stats {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  font-size: 13px;
  background: v-bind("theme.actionColor");
}

.stats a {
  color: v-bind("theme.primaryColor");
  text-decoration: none;
}

.save {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid v-bind("theme.dividerColor");
}

.results {
  margin-top: -4px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

.result {
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.result + .result {
  border-top: 1px solid v-bind("theme.dividerColor");
}

.list {
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 6px;
  overflow: hidden;
}

.item {
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  background: v-bind("theme.cardColor");
}

.item + .item {
  border-top: 1px solid v-bind("theme.dividerColor");
}

.item.dragging {
  opacity: 0.5;
}

.item.badge {
  height: 42px;
}

.grip {
  cursor: grab;
  color: v-bind("theme.textColor3");
  letter-spacing: -3px;
  user-select: none;
}

.idx {
  width: 20px;
  text-align: right;
}

.pid {
  width: 40px;
}

.badge-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.badge-name {
  width: 80px;
  flex-shrink: 0;
}

.empty {
  padding: 16px 0;
  text-align: center;
}
</style>
