<script setup lang="ts">
import PageHeader from "admin/components/PageHeader.vue"
import { useThemeVars } from "naive-ui"
import type { AdminTag, TagCategory } from "utils/types"
import { deleteTag, getTagAdminList, renameTag, setTagCategory } from "../api"
import TagProblemsModal from "./components/TagProblemsModal.vue"

const message = useMessage()
const dialog = useDialog()
const theme = useThemeVars()

const tags = ref<AdminTag[]>([])
const keyword = ref("")

// 搜索在后端做（getTagAdminList 带 keyword），这里只是一份引用，两栏和待归类都从它分
const visibleTags = computed(() => tags.value)

const editingId = ref<number | null>(null)
const editingName = ref("")

const activeTag = ref<AdminTag | null>(null)
const [showTagProblems, toggleTagProblems] = useToggle(false)

function openTagProblems(tag: AdminTag) {
  activeTag.value = tag
  toggleTagProblems(true)
}

/**
 * 两栏：知识点 / 主题（设计稿「后台标签」TagA）。原来是一张宽表，每行一组单选按钮切分类、
 * 两颗按钮，ID 一列、页头一段说明。现在一行一个标签 + 挂了几道题（条的长短看出哪个用得多），
 * 点名字看这个标签下的题，改名 / 换分类 / 删除直接摆在行尾（用户说的：不要收进 ⋯）。
 * 还没归类的单独一条放最上面
 */
const columnsOf = computed(() => {
  const confirmed = visibleTags.value.filter((t) => t.categoryConfirmed)
  return [
    {
      key: "knowledge" as const,
      title: "知识点",
      tags: confirmed.filter((t) => t.category === "knowledge"),
    },
    { key: "theme" as const, title: "主题", tags: confirmed.filter((t) => t.category === "theme") },
  ].map((col) => ({
    ...col,
    tags: [...col.tags].sort((a, b) => b.problemCount - a.problemCount),
    max: Math.max(1, ...col.tags.map((t) => t.problemCount)),
  }))
})
const pendingTags = computed(() => visibleTags.value.filter((t) => !t.categoryConfirmed))

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
    title: `删除「${tag.name}」？`,
    content: tag.problemCount
      ? `${tag.problemCount} 道题会摘掉这个标签，题目本身不动。`
      : "没有题目挂着它。",
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
  <PageHeader title="标签">
    <template #filters>
      <n-input v-model:value="keyword" style="width: 220px" placeholder="搜标签" clearable />
    </template>
  </PageHeader>

  <div v-if="pendingTags.length" class="pending">
    <b>还没归类</b>
    <div v-for="tag in pendingTags" :key="tag.id" class="pending-item">
      <n-button text type="primary" @click="openTagProblems(tag)">{{ tag.name }}</n-button>
      <span class="muted">{{ tag.problemCount }} 道</span>
      <n-button size="small" @click="changeCategory(tag, 'knowledge')">算知识点</n-button>
      <n-button size="small" @click="changeCategory(tag, 'theme')">算主题</n-button>
    </div>
  </div>

  <div class="columns">
    <section v-for="col in columnsOf" :key="col.key" class="column">
      <div class="column-head">
        <b>{{ col.title }}</b>
        <span class="muted">{{ col.tags.length }} 个</span>
      </div>
      <div class="list">
        <n-empty v-if="!col.tags.length" size="small" description="没有" class="empty" />
        <div v-for="tag in col.tags" :key="tag.id" class="row">
          <template v-if="editingId === tag.id">
            <n-input
              v-model:value="editingName"
              size="small"
              autofocus
              class="rename"
              @keyup.enter="saveTag(tag)"
              @keyup.esc="cancelEdit"
            />
            <n-button size="small" type="primary" @click="saveTag(tag)">保存</n-button>
            <n-button size="small" @click="cancelEdit">取消</n-button>
          </template>
          <template v-else>
            <button type="button" class="name" :title="tag.name" @click="openTagProblems(tag)">
              {{ tag.name }}
            </button>
            <span class="bar"
              ><i :style="{ width: `${(tag.problemCount / col.max) * 100}%` }"></i
            ></span>
            <span class="count">{{ tag.problemCount }} 道</span>
            <n-button size="tiny" quaternary @click="startEdit(tag)">改名</n-button>
            <n-button
              size="tiny"
              quaternary
              @click="changeCategory(tag, tag.category === 'theme' ? 'knowledge' : 'theme')"
            >
              {{ tag.category === "theme" ? "改成知识点" : "改成主题" }}
            </n-button>
            <n-button size="tiny" quaternary type="error" @click="confirmDelete(tag)"
              >删除</n-button
            >
          </template>
        </div>
      </div>
    </section>
  </div>

  <TagProblemsModal
    v-model:show="showTagProblems"
    :tag-id="activeTag?.id ?? 0"
    :tag-name="activeTag?.name ?? ''"
    @changed="listTags"
  />
</template>

<style scoped>
.pending {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(240, 160, 32, 0.45);
  background: rgba(240, 160, 32, 0.08);
}

.pending-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.columns {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.column {
  flex: 1 1 0;
  min-width: 0;
}

.column-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 16px;
}

.list {
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 8px;
  padding: 2px 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 4px 0 8px;
  border-bottom: 1px solid v-bind("theme.dividerColor");
}

.row:last-child {
  border-bottom: 0;
}

/* 斑马底纹，和后台其它列表一样（用户要的） */
.row:nth-child(even) {
  background: v-bind("theme.tableColorStriped");
}

.name {
  flex: 0 0 120px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 15px;
  text-align: left;
  color: v-bind("theme.primaryColor");
  cursor: pointer;
}

.name:hover {
  text-decoration: underline;
}

.bar {
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: v-bind("theme.actionColor");
  overflow: hidden;
}

.bar i {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: v-bind("theme.successColorSuppl");
}

.count {
  width: 52px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: v-bind("theme.textColor3");
}

.rename {
  flex: 1 1 auto;
}

.muted {
  font-size: 13px;
  color: v-bind("theme.textColor3");
}

.empty {
  margin: 16px 0;
}

/* 手机：两栏上下排；题数条不画，名字吃剩下的宽度，三个按钮放得下 */
@media (max-width: 768px) {
  .columns {
    flex-direction: column;
    align-items: stretch;
  }

  .column {
    flex: none;
  }

  .row {
    gap: 6px;
    padding: 0 0 0 6px;
  }

  .name {
    flex: 1 1 auto;
  }

  .bar {
    display: none;
  }

  .count {
    width: auto;
    white-space: nowrap;
  }
}
</style>
