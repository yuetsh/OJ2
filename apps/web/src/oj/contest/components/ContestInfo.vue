<script setup lang="ts">
import { useContestStore } from 'oj/store/contest'
import { parseTime } from 'utils/functions'
import ContestAccessTag from 'shared/components/ContestAccessTag.vue'
import Markdown from 'shared/components/Markdown.vue'

const contestStore = useContestStore()
</script>

<template>
  <!-- 点开而不是悬停：正文里的图点开放大时，放大层盖住了弹框，悬停会当成鼠标离开把弹框连同放大层一起收掉 -->
  <n-popover v-if="contestStore.contest" trigger="click" placement="bottom-end" :show-arrow="false">
    <template #trigger>
      <n-button>比赛信息</n-button>
    </template>
    <!-- 后台富文本存的 HTML，和题面一样走 Markdown：贴进来的截图不会被压扁、点开能放大 -->
    <div class="desc">
      <Markdown html :content="contestStore.contest.description" />
    </div>
    <n-descriptions bordered label-placement="left" :column="1">
      <n-descriptions-item label="开始时间">
        {{ parseTime(contestStore.contest.startTime, 'YYYY年M月D日 HH:mm:ss') }}
      </n-descriptions-item>
      <n-descriptions-item label="结束时间">
        {{ parseTime(contestStore.contest.endTime, 'YYYY年M月D日 HH:mm:ss') }}
      </n-descriptions-item>
      <n-descriptions-item label="比赛类型">
        <ContestAccessTag :contest="contestStore.contest" />
      </n-descriptions-item>
      <n-descriptions-item label="发起人">
        {{ contestStore.contest.createdBy.username }}
      </n-descriptions-item>
    </n-descriptions>
  </n-popover>
</template>

<style scoped>
/* 截图按原宽会把弹框撑得和屏幕一样宽 */
.desc {
  max-width: min(480px, calc(100vw - 48px));
  margin-bottom: 12px;
}

.desc :deep(.oj-markdown) {
  font-size: 14px;
}
</style>
