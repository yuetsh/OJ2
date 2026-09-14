<script setup lang="ts">
import { formatISO } from "date-fns"
import TextEditor from "shared/components/TextEditor.vue"
import { fromPickerValue, parseTime, toPickerValue } from "utils/functions"
import type { BlankContest } from "utils/types"
import { createContest, editContest, getContest } from "../api"

interface Props {
  contestID?: string
}

function getTimes() {
  const timestamp = Date.now()
  const rounded = timestamp - (timestamp % 60000) // 确保秒数为0
  const t1 = rounded + waitMins.value * 60000
  const t2 = t1 + durationMins.value * 60000
  return [t1, t2]
}

// 创建的时候
const waitMins = ref(5) // 顺延5分钟
const durationMins = ref(10) // 比赛默认时长10分钟

watch([waitMins, durationMins], () => {
  const times = getTimes()
  contest.startTime = formatISO(times[0])
  contest.endTime = formatISO(times[1])
})

// 编辑的时候。这两个 ref 绑给 n-date-picker，值要平移过（见 utils/functions.ts
// 的 toPickerValue）—— 选择器按浏览器本地渲染，不换算的话非东八区的老师看到的是
// 自己时区的钟点，存进去就成了另一个时刻。
const startTime = ref(0)
const endTime = ref(0)

watch([startTime, endTime], (values) => {
  contest.startTime = formatISO(fromPickerValue(values[0]))
  contest.endTime = formatISO(fromPickerValue(values[1]))
})

const route = useRoute()
const router = useRouter()
const message = useMessage()
const props = defineProps<Props>()

const [ready, toggleReady] = useToggle()

const tags: SelectOption[] = [
  { label: "练习", value: "练习" },
  { label: "期中", value: "期中" },
  { label: "期末", value: "期末" },
]

const contest = reactive<BlankContest & { id: number }>({
  id: 0,
  title: "",
  description: "",
  tag: "练习",
  startTime: "",
  endTime: "",
  password: "",
  visible: false,
})

async function getContestDetail() {
  if (!props.contestID) {
    const times = getTimes()
    contest.startTime = formatISO(times[0])
    contest.endTime = formatISO(times[1])
    toggleReady(true)
    return
  }
  const data = await getContest(props.contestID)
  toggleReady(true)
  contest.id = data.id
  contest.title = data.title
  contest.description = data.description
  contest.tag = data.tag
  contest.startTime = data.startTime
  contest.endTime = data.endTime
  contest.password = data.password
  contest.visible = data.visible

  // 显示：交给选择器之前先平移成「北京墙上时间」
  startTime.value = toPickerValue(Date.parse(data.startTime))
  endTime.value = toPickerValue(Date.parse(data.endTime))
}

async function submit() {
  if (contest.description === "<p><br></p>") {
    contest.description = contest.title
  }
  const api = {
    "admin contest create": createContest,
    "admin contest edit": editContest,
  }[route.name as string]
  try {
    await api!(contest)
    if (route.name === "admin contest create") {
      message.success("成功新建比赛 💐")
    } else {
      message.success("修改已保存")
    }
    router.push({ name: "admin contest list" })
  } catch (err: any) {
    message.error(err.data)
  }
}

onMounted(getContestDetail)
</script>

<template>
  <n-flex class="titleWrapper" align="center">
    <h2 class="title">
      {{ route.name === "admin contest create" ? "新建比赛" : "编辑比赛" }}
    </h2>
    <template v-if="!props.contestID">
      <n-alert type="success">
        <template #header>
          开始时间 {{ parseTime(contest.startTime, "YYYY年M月D日 HH:mm:ss") }}
        </template>
      </n-alert>
      <n-alert type="warning">
        <template #header>
          结束时间 {{ parseTime(contest.endTime, "YYYY年M月D日 HH:mm:ss") }}
        </template>
      </n-alert>
    </template>
  </n-flex>
  <n-form inline>
    <n-form-item label="标题">
      <n-input style="width: 300px" v-model:value="contest.title" />
    </n-form-item>
    <n-form-item label="标签">
      <n-select
        style="width: 100px"
        :options="tags"
        v-model:value="contest.tag"
      />
    </n-form-item>
    <template v-if="props.contestID">
      <n-form-item label="开始">
        <n-date-picker
          style="width: 200px"
          v-model:value="startTime"
          type="datetime"
        />
      </n-form-item>
      <n-form-item label="结束">
        <n-date-picker
          style="width: 200px"
          v-model:value="endTime"
          type="datetime"
        />
      </n-form-item>
    </template>
    <template v-else>
      <n-form-item label="几分钟后开始">
        <n-input-number style="width: 120px" v-model:value="waitMins" />
      </n-form-item>
      <n-form-item label="比赛时长">
        <n-input-number
          style="width: 120px"
          step="5"
          v-model:value="durationMins"
        />
      </n-form-item>
    </template>
    <n-form-item label="密码">
      <n-input style="width: 160px" v-model:value="contest.password" />
    </n-form-item>
    <n-form-item label="可见">
      <n-switch v-model:value="contest.visible" />
    </n-form-item>
  </n-form>
  <TextEditor
    v-if="ready"
    title="描述"
    v-model:value="contest.description"
    :min-height="200"
  />
  <n-flex style="margin-bottom: 100px" justify="end">
    <n-button type="primary" @click="submit">保存</n-button>
  </n-flex>
</template>

<style scoped>
.titleWrapper {
  margin-bottom: 16px;
}

.title {
  margin: 0;
}
</style>
