<script setup lang="ts">
import {
  AST_SUPPORTED_LANGUAGES,
  CHALLENGE_RULES_MAX,
  CHALLENGE_WORDING_MAX,
  CHALLENGES_PER_LANGUAGE_MAX,
  type AstRules,
  type ChallengeInput,
  type ChallengeSuggestionsResponse,
} from '@oj2/contract'
import { errorMessage } from 'utils/api'
import type { LANGUAGE } from 'utils/types'
import { getChallengeSuggestions } from '../../api'
import AstRulesEditor from './AstRulesEditor.vue'

/**
 * 出题页的「挑战」：做对之后，同一道题加一条写法上的限制再做一遍（设计稿 StkAdmin）。
 * 判定就是语法要求那套规则，所以每条挑战底下直接摆一个规则编辑器（只开这一种语言）。
 *
 * 「从做对的代码里找」把这道题历史上做对的代码挖一遍，列出「一批人用另一种写法也做对了」
 * 的地方。机械挖出来的会有坏的（拆掉 elif 换成一串 if 也算「不用 elif」），所以每条带一份
 * 做到的人的真实代码，好不好老师看了再加。新建的题还没人做过，不给这个按钮。
 */
const props = defineProps<{
  modelValue: Record<string, ChallengeInput[]> | null
  languages: LANGUAGE[]
  answers: Partial<Record<LANGUAGE, string>>
  /** 编辑已有的题才有；新建的题没有做对的代码可挖 */
  problemId: number | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, ChallengeInput[]> | null): void
}>()

const languages = computed(() => props.languages.filter((lang) => AST_SUPPORTED_LANGUAGES.includes(lang)))
const tab = ref<string>(languages.value[0] ?? 'Python')
watch(languages, (list) => {
  if (!list.includes(tab.value as LANGUAGE)) tab.value = list[0] ?? 'Python'
})

const list = computed(() => props.modelValue?.[tab.value] ?? [])

function update(next: ChallengeInput[]) {
  const value = { ...props.modelValue }
  if (next.length) value[tab.value] = next
  else delete value[tab.value]
  emit('update:modelValue', Object.keys(value).length ? value : null)
}

function patch(index: number, change: Partial<ChallengeInput>) {
  update(list.value.map((item, i) => (i === index ? { ...item, ...change } : item)))
}

function remove(index: number) {
  update(list.value.filter((_, i) => i !== index))
}

function add(item: ChallengeInput = { wording: '', rules: [] }) {
  update([...list.value, item])
}

/** AstRulesEditor 按语言分组收发，这里只给它一种语言 */
function rulesModel(item: ChallengeInput): AstRules {
  return { [tab.value]: item.rules }
}
function onRules(index: number, value: AstRules | null) {
  patch(index, { rules: (value?.[tab.value] ?? []).slice(0, CHALLENGE_RULES_MAX) })
}

const full = computed(() => list.value.length >= CHALLENGES_PER_LANGUAGE_MAX)

// ---------------------------------------------------------------- 候选

const suggestions = ref<Record<string, ChallengeSuggestionsResponse>>({})
const loading = ref(false)
const error = ref('')

async function findSuggestions() {
  if (!props.problemId) return
  loading.value = true
  error.value = ''
  try {
    suggestions.value = {
      ...suggestions.value,
      [tab.value]: await getChallengeSuggestions(props.problemId, tab.value),
    }
  } catch (err) {
    error.value = errorMessage(err, '没找成')
  } finally {
    loading.value = false
  }
}

const current = computed(() => suggestions.value[tab.value] ?? null)

/** 已经加上的不再列 */
const shown = computed(() => {
  const taken = list.value.map((item) => JSON.stringify(item.rules))
  return (current.value?.suggestions ?? []).filter((item) => !taken.includes(JSON.stringify(item.rules)))
})
</script>

<template>
  <div class="challenge-editor">
    <n-radio-group v-if="languages.length > 1" v-model:value="tab" size="small">
      <n-radio-button v-for="lang in languages" :key="lang" :value="lang">
        {{ lang }}{{ modelValue?.[lang]?.length ? ` ${modelValue[lang]!.length} 条` : '' }}
      </n-radio-button>
    </n-radio-group>

    <div v-for="(item, index) in list" :key="`${tab}-${item.id ?? index}`" class="item">
      <div class="itemHead">
        <span class="index">{{ index + 1 }}</span>
        <n-input
          :value="item.wording"
          :maxlength="CHALLENGE_WORDING_MAX"
          placeholder="给学生看的说法，例如「整首歌只用 1 次 print」"
          :status="item.wording.trim() ? undefined : 'warning'"
          @update:value="(value: string) => patch(index, { wording: value })"
        />
        <n-button size="small" quaternary @click="remove(index)">删掉</n-button>
      </div>
      <AstRulesEditor
        :model-value="rulesModel(item)"
        :languages="[tab as LANGUAGE]"
        :answers="answers"
        challenge
        @update:model-value="(value) => onRules(index, value)"
      />
    </div>

    <n-text v-if="!languages.length" depth="3" class="note"> 只有 Python、C、C++ 能配挑战，先在「学生怎么写」里勾上其中一种。 </n-text>
    <template v-else>
      <div class="actions">
        <n-button size="small" :disabled="full" @click="add()">+ 自己写一条</n-button>
        <n-button v-if="problemId" size="small" :loading="loading" :disabled="full" @click="findSuggestions"> 从做对的代码里找 </n-button>
      </div>
      <n-text v-if="error" type="error" class="note">{{ error }}</n-text>

      <div v-if="current" class="suggestions">
        <n-text depth="3" class="note"> {{ current.acCount }} 个人用 {{ tab }} 做对过，下面是有一批人换了种写法也做对的地方 </n-text>
        <n-text v-if="!shown.length" depth="3" class="note">没找到别的写法</n-text>
        <div v-for="item in shown" :key="JSON.stringify(item.rules)" class="suggestion">
          <div class="suggestionHead">
            <div class="suggestionText">
              <b>{{ item.wording }}</b>
              <n-text depth="3" class="note">
                {{ item.did }} 人这样做对<template v-if="item.firstShare !== null">，第一次做对时 {{ item.firstShare }}% 这样写</template>
              </n-text>
            </div>
            <n-button size="small" :disabled="full" @click="add({ wording: item.wording, rules: item.rules })"> 加上 </n-button>
          </div>
          <pre class="example">{{ item.example }}</pre>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.challenge-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(91, 52, 196, 0.3);
  border-radius: 6px;
}

.itemHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.index {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: rgba(91, 52, 196, 0.12);
  color: #5b34c4;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.actions {
  display: flex;
  gap: 8px;
}

.note {
  font-size: 12px;
}

.suggestions {
  display: flex;
  flex-direction: column;
}

.suggestion {
  padding: 10px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}

.suggestionHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.suggestionText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.example {
  margin: 6px 0 0;
  padding: 6px 10px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
  overflow-x: auto;
  max-height: 180px;
}
</style>
