<script setup lang="ts">
import type { LearningReport } from "@oj2/contract"
import { useThemeVars } from "naive-ui"

/** 全部知识点：做对过的标绿写几道，做过没做对的写「还没做对」，没碰过的虚线。点进题目列表按它筛 */
const props = defineProps<{ knowledge: LearningReport["knowledge"] }>()

const theme = useThemeVars()
const touched = computed(() => props.knowledge.filter((item) => item.tried).length)
</script>

<template>
  <section class="card">
    <h3>
      知识点<small>做过 {{ touched }} / {{ knowledge.length }} 个</small>
    </h3>
    <div class="grid">
      <router-link
        v-for="item in knowledge"
        :key="item.name"
        :to="{ path: '/problem', query: { tag: item.name } }"
        class="cell"
        :class="item.solved ? 'solved' : item.tried ? 'tried' : 'untouched'"
      >
        <span class="name">{{ item.name }}</span>
        <span class="sub">
          {{ item.solved ? `做对 ${item.solved} 道` : item.tried ? "还没做对" : "还没做过" }}
        </span>
      </router-link>
    </div>
  </section>
</template>

<style scoped>
.card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: var(--oj-radius);
  background: v-bind("theme.cardColor");
}

h3 {
  margin: 0;
  font-size: var(--oj-fs-h2);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

h3 small {
  font-size: var(--oj-fs-meta);
  font-weight: 400;
  color: v-bind("theme.textColor3");
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-decoration: none;
  color: v-bind("theme.textColor1");
  min-width: 0;
}

.name {
  font-size: var(--oj-fs-sec);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  font-size: 12px;
}

.solved {
  background: rgba(24, 160, 88, 0.12);
}

.solved .name {
  font-weight: 600;
}

.solved .sub {
  color: #18a058;
}

.tried {
  background: rgba(240, 160, 32, 0.12);
}

.tried .sub {
  color: #b86e00;
}

.untouched {
  border: 1px dashed v-bind("theme.borderColor");
  color: v-bind("theme.textColor3");
}
</style>
