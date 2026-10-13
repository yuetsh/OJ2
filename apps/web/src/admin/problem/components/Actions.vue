<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import { errorCode, errorMessage } from "utils/api"
import { deleteContestProblem, deleteProblem, makeProblemPublic } from "admin/api"
import download from "utils/download"

/**
 * 题目列表一行的操作（设计稿「后台题目列表」PlA）：常用的「编辑」常驻，其余收进 ⋯ ——
 * 原来是四颗彩色按钮（编辑 / 查看 / 删除 / 下载）并排，1366 宽的屏上把「可见」开关挤出了屏幕。
 * 有人交过的题删不掉（服务端也拦），「删除」直接灰掉并写明为什么，不用点了才知道
 */
interface Props {
  problemID: number
  problemDisplayID: string
  /** 做过这道题的人数，> 0 就删不掉 */
  triedUsers?: number
}
const props = defineProps<Props>()
const dialog = useDialog()
const emit = defineEmits(["updated"])

const route = useRoute()
const router = useRouter()
const message = useMessage()

const isContestProblem = computed(() => route.name === "admin contest problem list")

const showMakePublicModal = ref(false)
const newDisplayID = ref("")

async function handleDeleteProblem() {
  try {
    if (route.name === "admin contest problem list") {
      await deleteContestProblem(props.problemID)
    } else {
      await deleteProblem(props.problemID)
    }
    message.success("删除成功")
    emit("updated")
  } catch (err) {
    if (errorCode(err) === "problem-has-submissions") {
      message.error("这道题有提交之后，就不能被删除")
    } else {
      message.error("删除失败")
    }
  }
}

function downloads() {
  download(`problems/${props.problemID}/test-cases`)
}

function goEdit() {
  const name = route.name!.toString().replace("list", "edit")
  router.push({ name, params: { problemID: props.problemID } })
}

function goCheck() {
  let data = router.resolve("/problem/" + props.problemDisplayID)
  if (route.name === "admin contest problem list") {
    data = router.resolve({
      name: "contest problem",
      params: {
        contestID: route.params.contestID,
        problemID: props.problemDisplayID,
      },
    })
  }
  window.open(data.href, "_blank")
}

const menuOptions = computed<DropdownOption[]>(() => [
  { label: "在前台看", key: "view" },
  { label: "下载测试数据", key: "download" },
  ...(isContestProblem.value ? [{ label: "转成公开题", key: "public" }] : []),
  { type: "divider", key: "divider" },
  props.triedUsers
    ? { label: `删除（有 ${props.triedUsers} 人交过）`, key: "delete", disabled: true }
    : { label: "删除", key: "delete" },
])

function onMenu(key: string) {
  if (key === "view") goCheck()
  else if (key === "download") downloads()
  else if (key === "public") openMakePublicModal()
  else if (key === "delete") {
    dialog.warning({
      title: `删除 ${props.problemDisplayID}？`,
      content: "删掉就找不回来了。",
      positiveText: "删除",
      negativeText: "不删",
      onPositiveClick: handleDeleteProblem,
    })
  }
}

function openMakePublicModal() {
  newDisplayID.value = ""
  showMakePublicModal.value = true
}

async function handleMakePublic() {
  if (!newDisplayID.value.trim()) {
    message.error("请输入新的题目编号")
    return
  }

  try {
    await makeProblemPublic(props.problemID, newDisplayID.value.trim())
    message.success("已成功转为公开题目（需要手动设置可见）")
    showMakePublicModal.value = false
    emit("updated") // 刷新列表
  } catch (err) {
    if (errorCode(err) === "display-id-exists") {
      message.error("该题目编号已存在，请使用其他编号")
    } else if (errorCode(err) === "already-public") {
      message.error("该题目已经是公开题目")
    } else {
      message.error("转换失败：" + errorMessage(err, "未知错误"))
    }
  }
}
</script>
<template>
  <n-flex :size="4" justify="end" :wrap="false">
    <n-button size="small" @click="goEdit">编辑</n-button>
    <n-dropdown trigger="click" placement="bottom-end" :options="menuOptions" @select="onMenu">
      <n-button size="small" quaternary aria-label="更多">
        <template #icon><Icon icon="ph:dots-three-bold" /></template>
      </n-button>
    </n-dropdown>
  </n-flex>

  <n-modal
    v-model:show="showMakePublicModal"
    preset="card"
    title="转为公开题目"
    style="width: 500px"
  >
    <n-space vertical>
      <p>将竞赛题目转为公开题目后，会创建一个新的公开题目副本，原题目保持不变。</p>
      <n-form>
        <n-form-item label="新的题目编号" required>
          <n-input
            v-model:value="newDisplayID"
            placeholder="例如: 1001"
            clearable
            @keyup.enter="handleMakePublic"
          />
        </n-form-item>
      </n-form>
      <n-alert type="info" title="提示：请输入一个未被使用的题目编号"> </n-alert>
    </n-space>
    <template #footer>
      <n-flex justify="end">
        <n-button @click="showMakePublicModal = false">取消</n-button>
        <n-button type="primary" @click="handleMakePublic">确认</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
