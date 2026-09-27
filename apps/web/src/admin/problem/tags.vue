<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { NButton, NFlex, NInput, NRadioButton, NRadioGroup, NTag } from "naive-ui"
import type { AdminTag, TagCategory } from "utils/types"
import { deleteTag, getTagAdminList, renameTag, setTagCategory } from "../api"
import TagProblemsModal from "./components/TagProblemsModal.vue"

const message = useMessage()
const dialog = useDialog()

const tags = ref<AdminTag[]>([])
const keyword = ref("")

type CategoryFilter = "" | "pending" | TagCategory
const categoryFilter = ref<CategoryFilter>("")

// 出题时新建的标签默认算「知识点」、还没人确认过，数出来挂在页头提醒
const pendingCount = computed(() => tags.value.filter((t) => !t.categoryConfirmed).length)

// 标签总共几十个，分类筛选在前端做，不必为它再加一个 query 参数
const visibleTags = computed(() => {
  const filter = categoryFilter.value
  if (!filter) return tags.value
  if (filter === "pending") return tags.value.filter((t) => !t.categoryConfirmed)
  return tags.value.filter((t) => t.category === filter)
})

const categoryOptions = computed(() => [
  { label: "全部分类", value: "" },
  { label: `待归类（${pendingCount.value}）`, value: "pending" },
  { label: "知识点", value: "knowledge" },
  { label: "主题", value: "theme" },
])
const editingId = ref<number | null>(null)
const editingName = ref("")

const activeTag = ref<AdminTag | null>(null)
const [showTagProblems, toggleTagProblems] = useToggle(false)

function openTagProblems(tag: AdminTag) {
  activeTag.value = tag
  toggleTagProblems(true)
}

const columns: DataTableColumn<AdminTag>[] = [
  { title: "ID", key: "id", width: 80 },
  {
    title: "标签名",
    key: "name",
    minWidth: 200,
    render: (row) =>
      editingId.value === row.id
        ? h(NInput, {
            value: editingName.value,
            autofocus: true,
            size: "small",
            style: "max-width: 240px",
            onUpdateValue: (v: string) => (editingName.value = v),
            onKeyup: (e: KeyboardEvent) => {
              if (e.key === "Enter") saveTag(row)
              if (e.key === "Escape") cancelEdit()
            },
          })
        : h(NFlex, { size: 8, align: "center" }, () => [
            h(
              NButton,
              {
                text: true,
                type: "primary",
                onClick: () => openTagProblems(row),
              },
              () => row.name,
            ),
            row.categoryConfirmed
              ? null
              : h(NTag, { size: "small", type: "warning", bordered: false }, () => "待归类"),
          ]),
  },
  {
    // 前台题目列表按这一列把标签分成「知识点」「主题」两组
    title: "分类",
    key: "category",
    width: 240,
    render: (row) =>
      h(NFlex, { size: 8, align: "center", wrap: false }, () => [
        h(
          NRadioGroup,
          {
            size: "small",
            value: row.category,
            onUpdateValue: (v: TagCategory) => changeCategory(row, v),
          },
          () => [
            h(NRadioButton, { value: "knowledge" }, () => "知识点"),
            h(NRadioButton, { value: "theme" }, () => "主题"),
          ],
        ),
        // 新标签默认已经是「知识点」，点它不会触发 update，所以单给一个确认按钮
        row.categoryConfirmed
          ? null
          : h(
              NButton,
              {
                size: "small",
                type: "primary",
                secondary: true,
                onClick: () => changeCategory(row, row.category),
              },
              () => "确认",
            ),
      ]),
  },
  {
    title: "题目数",
    key: "problem_count",
    width: 100,
    render: (row) =>
      h(NButton, { text: true, type: "primary", onClick: () => openTagProblems(row) }, () =>
        String(row.problemCount),
      ),
  },
  {
    title: "选项",
    key: "actions",
    width: 200,
    render: (row) =>
      h(NFlex, { size: 8 }, () =>
        editingId.value === row.id
          ? [
              h(
                NButton,
                { size: "small", type: "primary", onClick: () => saveTag(row) },
                () => "保存",
              ),
              h(NButton, { size: "small", onClick: cancelEdit }, () => "取消"),
            ]
          : [
              h(NButton, { size: "small", onClick: () => startEdit(row) }, () => "重命名"),
              h(
                NButton,
                {
                  size: "small",
                  type: "error",
                  onClick: () => confirmDelete(row),
                },
                () => "删除",
              ),
            ],
      ),
  },
]

async function listTags() {
  const res = await getTagAdminList(keyword.value)
  tags.value = res
}

function startEdit(tag: AdminTag) {
  editingId.value = tag.id
  editingName.value = tag.name
}

function cancelEdit() {
  editingId.value = null
  editingName.value = ""
}

async function saveTag(tag: AdminTag) {
  const name = editingName.value.trim()
  if (!name) {
    message.error("标签名不能为空")
    return
  }
  if (name === tag.name) {
    cancelEdit()
    return
  }
  const res = await renameTag(tag.id, name)
  if (res.merged) {
    message.success(`已合并到「${res.name}」，影响 ${res.affectedCount} 道题`)
  } else {
    message.success("已重命名")
  }
  cancelEdit()
  listTags()
}

async function changeCategory(tag: AdminTag, category: TagCategory) {
  await setTagCategory(tag.id, category)
  tag.category = category
  tag.categoryConfirmed = true
  message.success(`「${tag.name}」已归到${category === "theme" ? "主题" : "知识点"}`)
}

function confirmDelete(tag: AdminTag) {
  dialog.warning({
    title: "删除标签",
    content: `确定删除标签「${tag.name}」吗？当前有 ${tag.problemCount} 道题在使用它，删除后这些题目会失去该标签。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      await deleteTag(tag.id)
      message.success("已删除")
      listTags()
    },
  })
}

onMounted(listTags)

watchDebounced(keyword, listTags, { debounce: 500, maxWait: 1000 })
</script>

<template>
  <PageHeader title="标签管理">
    <template #filters>
      <n-input v-model:value="keyword" style="width: 220px" placeholder="搜索标签" clearable />
      <n-select v-model:value="categoryFilter" :options="categoryOptions" style="width: 160px" />
    </template>
  </PageHeader>
  <n-alert v-if="pendingCount > 0" type="warning" :bordered="false" class="pending-alert">
    有 {{ pendingCount }} 个新标签还没归类（出题时新建的标签默认算「知识点」）。
    前台题目列表按分类把标签分成「知识点」「主题」两组，选好分类或点「确认」即可。
  </n-alert>
  <n-data-table striped :columns="columns" :data="visibleTags" />
  <TagProblemsModal
    v-model:show="showTagProblems"
    :tag-id="activeTag?.id ?? 0"
    :tag-name="activeTag?.name ?? ''"
    @changed="listTags"
  />
</template>

<style scoped>
.pending-alert {
  margin-bottom: 12px;
}
</style>
