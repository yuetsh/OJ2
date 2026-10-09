<script setup lang="ts">
import {
  AST_NODE_TARGETS_BY_LANGUAGE,
  AST_OPERATOR_TARGETS_BY_LANGUAGE,
  AST_SUPPORTED_LANGUAGES,
} from "@oj2/contract"
import { useThemeVars } from "naive-ui"
import { errorMessage } from "utils/api"
import type { AstRule, AstRules, LANGUAGE } from "utils/types"
import { checkAstRules } from "../../api"
import type { AstCheckState } from "./editorTypes"

interface Props {
  modelValue: AstRules | null
  languages: LANGUAGE[]
  /** 各语言的标准答案（学生那段代码，不套模板）：拿来自测规则 */
  answers: Partial<Record<LANGUAGE, string>>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: "update:modelValue", value: AstRules | null): void
}>()

// 判题机只认 C / Python，别的语言配了规则也一条都不会跑（judge/ast.ts 的
// loadLanguage 返回 null 就直接放行）。原来这里按题目的全部语言开 tab，老师给
// C++ 配的规则存得下、题目页也照常显示成「要求」，判题却从不检查。
const supportedLanguages = computed(() =>
  props.languages.filter((lang) => AST_SUPPORTED_LANGUAGES.includes(lang)),
)
const unsupportedLanguages = computed(() =>
  props.languages.filter((lang) => !AST_SUPPORTED_LANGUAGES.includes(lang)),
)

const activeTab = ref(supportedLanguages.value[0] || "Python")

const theme = useThemeVars()

// ---------------------------------------------------------------- 自测

/**
 * 规则配错（节点类型对不上）时完全静默：「必须使用 X」永远失败、「不能使用 X」永远通过。
 * 拿标准答案先跑一遍，标准答案自己都过不了，多半是规则配错了。顺带拿到学生看到的那句话
 */
const checks = defineModel<AstCheckState>("checks", { default: () => ({}) })

let generation = 0

async function runChecks() {
  const mine = ++generation
  const next: AstCheckState = {}
  for (const lang of supportedLanguages.value) {
    const rules = getRulesForLang(lang)
    if (!rules.length) continue
    try {
      next[lang] = await checkAstRules({
        language: lang as "C" | "C++" | "Python",
        code: props.answers[lang] ?? "",
        rules,
      })
    } catch (err) {
      next[lang] = { error: errorMessage(err, "这组规则检查不了") }
    }
  }
  // 跑的过程中又改了：这一轮作废，新的那轮另有一次
  if (mine === generation) checks.value = next
}

watchDebounced(() => [props.modelValue, props.answers, supportedLanguages.value], runChecks, {
  debounce: 500,
  deep: true,
  immediate: true,
})

function checkOf(lang: string, index: number) {
  const state = checks.value[lang]
  if (!state || "error" in state) return null
  return state.rules[index] ?? null
}

function countOf(lang: string) {
  return getRulesForLang(lang).length
}

const ENGINE_OPTIONS: SelectOption[] = [
  {
    label: "节点检查",
    type: "group",
    key: "node_group",
    children: [
      { label: "必须存在", value: "must_exist_node" },
      { label: "不能存在", value: "must_not_exist_node" },
      { label: "出现次数", value: "count_node" },
    ],
  },
  {
    label: "函数调用",
    type: "group",
    key: "func_group",
    children: [
      { label: "必须调用函数", value: "must_call_function" },
      { label: "不能调用函数", value: "must_not_call_function" },
      { label: "函数调用次数", value: "count_function_call" },
    ],
  },
  {
    label: "方法调用",
    type: "group",
    key: "method_group",
    children: [
      { label: "必须调用方法", value: "must_call_method" },
      { label: "不能调用方法", value: "must_not_call_method" },
    ],
  },
  {
    label: "运算符",
    type: "group",
    key: "op_group",
    children: [{ label: "必须使用运算符", value: "must_use_operator" }],
  },
]

// 选项按语言生成。原来是一张 C/Python 混合的 15 条表整份铺开，给 C 题也能选到
// 列表推导式、f-string 这些 C 根本没有的东西 —— 存得进去，判题时永远失败
// （或者反过来，「不能使用 f-string」永远通过），两头都不报错。
function nodeTargetOptions(lang: string): SelectOption[] {
  return Object.entries(AST_NODE_TARGETS_BY_LANGUAGE[lang] ?? {}).map(([value, entry]) => ({
    label: entry.label,
    value,
  }))
}

// 逻辑名 and/or/not 在 C 里显示成 && / || / !，存进去的还是逻辑名
function operatorTargetOptions(lang: string): SelectOption[] {
  return Object.entries(AST_OPERATOR_TARGETS_BY_LANGUAGE[lang] ?? {}).map(([value, label]) => ({
    label: label === value ? value : `${label}（${value}）`,
    value,
  }))
}

const NODE_ENGINES = ["must_exist_node", "must_not_exist_node", "count_node"]
const FUNCTION_ENGINES = ["must_call_function", "must_not_call_function", "count_function_call"]
const METHOD_ENGINES = ["must_call_method", "must_not_call_method"]
const OPERATOR_ENGINES = ["must_use_operator"]
const COUNT_ENGINES = ["count_node", "count_function_call"]

function isNodeEngine(engine: string) {
  return NODE_ENGINES.includes(engine)
}
function isFunctionEngine(engine: string) {
  return FUNCTION_ENGINES.includes(engine)
}
function isMethodEngine(engine: string) {
  return METHOD_ENGINES.includes(engine)
}
function isOperatorEngine(engine: string) {
  return OPERATOR_ENGINES.includes(engine)
}
function isCountEngine(engine: string) {
  return COUNT_ENGINES.includes(engine)
}

const COUNT_MODE_OPTIONS: SelectOption[] = [
  { label: "正好", value: "exact" },
  { label: "范围", value: "range" },
]

function getCountMode(rule: AstRule): "exact" | "range" {
  return rule.exact !== undefined ? "exact" : "range"
}

function updateCountMode(lang: string, index: number, mode: "exact" | "range") {
  const rules = [...getRulesForLang(lang)]
  const rule = { ...rules[index] }
  if (mode === "exact") {
    rule.exact = rule.min ?? 1
    delete rule.min
    delete rule.max
  } else {
    // 留空的 count 规则恒真（rangePassed 三个字段全 undefined 就返回 true），
    // 描述还会退化成光秃秃一个「for 循环」。切过来先给个 1
    rule.min = rule.min ?? 1
    delete rule.exact
  }
  rules[index] = rule
  updateRules(lang, rules)
}

function updateExactCount(lang: string, index: number, v: number | null) {
  const rules = [...getRulesForLang(lang)]
  const rule = { ...rules[index] }
  if (v === null) delete rule.exact
  else rule.exact = v
  rules[index] = rule
  updateRules(lang, rules)
}

function needsTargetDropdown(engine: string) {
  return isNodeEngine(engine)
}
function needsTargetInput(engine: string) {
  return isFunctionEngine(engine) || isMethodEngine(engine)
}
function needsOperatorDropdown(engine: string) {
  return isOperatorEngine(engine)
}

function getRulesForLang(lang: string): AstRule[] {
  if (!props.modelValue) return []
  return props.modelValue[lang] || []
}

function updateRules(lang: string, rules: AstRule[]) {
  const current = { ...props.modelValue }
  if (rules.length === 0) {
    delete current[lang]
  } else {
    current[lang] = rules
  }
  emit("update:modelValue", Object.keys(current).length > 0 ? current : null)
}

function getTargetLabel(lang: string, engine: string, target: string): string | undefined {
  if (isNodeEngine(engine)) return AST_NODE_TARGETS_BY_LANGUAGE[lang]?.[target]?.label
  // 运算符不写 label：判题结果的文案按语言翻译（astOperatorLabel），
  // 存一个固定 label 反而会把 C 的 && 钉死成 and
  return undefined
}

function addRule(lang: string) {
  const rules = [...getRulesForLang(lang)]
  rules.push({
    engine: "must_exist_node",
    target: "for_loop",
    label: getTargetLabel(lang, "must_exist_node", "for_loop"),
    message: "",
  })
  updateRules(lang, rules)
}

function removeRule(lang: string, index: number) {
  const rules = [...getRulesForLang(lang)]
  rules.splice(index, 1)
  updateRules(lang, rules)
}

function updateRule(lang: string, index: number, field: string, value: any) {
  const rules = [...getRulesForLang(lang)]
  const rule = { ...rules[index] }

  if (field === "engine") {
    rule.engine = value
    if (isNodeEngine(value)) {
      rule.target = "for_loop"
      rule.label = getTargetLabel(lang, value, "for_loop")
    } else if (isOperatorEngine(value)) {
      rule.target = "+"
      delete rule.label
    } else {
      rule.target = ""
      delete rule.label
    }
    delete rule.min
    delete rule.max
    delete rule.exact
    // 次数引擎不给默认值的话，存下去就是一条恒真规则
    if (isCountEngine(value)) rule.exact = 1
  } else if (field === "target") {
    rule.target = value
    const lbl = getTargetLabel(lang, rule.engine, value)
    if (lbl) rule.label = lbl
    else delete rule.label
  } else if (field === "min") {
    if (value === null || value === undefined) delete rule.min
    else rule.min = value
  } else if (field === "max") {
    if (value === null || value === undefined) delete rule.max
    else rule.max = value
  } else if (field === "message") {
    rule.message = value
  }

  rules[index] = rule
  updateRules(lang, rules)
}

watch(supportedLanguages, (langs) => {
  if (langs.length && !langs.includes(activeTab.value as LANGUAGE)) {
    activeTab.value = langs[0]
  }
})
</script>

<template>
  <div class="astRules">
    <div class="head">
      <span class="label">语法要求</span>
      <div v-if="supportedLanguages.length" class="langs" role="tablist" aria-label="语言">
        <button
          v-for="lang in supportedLanguages"
          :key="lang"
          type="button"
          role="tab"
          :aria-selected="activeTab === lang"
          class="lang"
          :class="{ on: activeTab === lang }"
          @click="activeTab = lang"
        >
          {{ lang }} · {{ countOf(lang) ? `${countOf(lang)} 条` : "没有" }}
        </button>
      </div>
      <div class="grow"></div>
      <n-text depth="3" class="note">提交时逐条检查，不满足算错</n-text>
    </div>
    <n-text v-if="unsupportedLanguages.length" depth="3" class="note">
      {{ unsupportedLanguages.join("、") }} 检查不了语法要求（判题机只认
      {{ AST_SUPPORTED_LANGUAGES.join(" / ") }}）
    </n-text>
    <n-text v-if="!supportedLanguages.length" depth="3" class="note">先选能交的语言</n-text>
    <template v-for="lang in supportedLanguages" :key="lang">
      <div v-if="activeTab === lang" class="rules">
        <div v-if="checks[lang] && 'error' in checks[lang]" class="ruleError">
          {{ (checks[lang] as { error: string }).error }}
        </div>
        <div v-for="(rule, index) in getRulesForLang(lang)" :key="index" class="rule">
          <div class="ruleRow">
            <n-select
              :options="ENGINE_OPTIONS"
              :value="rule.engine"
              size="small"
              class="engine"
              @update:value="(v: string) => updateRule(lang, index, 'engine', v)"
            />
            <n-select
              v-if="needsTargetDropdown(rule.engine)"
              :options="nodeTargetOptions(lang)"
              :value="rule.target"
              size="small"
              class="target"
              filterable
              @update:value="(v: string) => updateRule(lang, index, 'target', v)"
            />
            <n-input
              v-if="needsTargetInput(rule.engine)"
              :value="rule.target"
              size="small"
              class="target"
              placeholder="函数 / 方法名"
              @update:value="(v: string) => updateRule(lang, index, 'target', v)"
            />
            <n-select
              v-if="needsOperatorDropdown(rule.engine)"
              :options="operatorTargetOptions(lang)"
              :value="rule.target"
              size="small"
              class="target"
              @update:value="(v: string) => updateRule(lang, index, 'target', v)"
            />
            <template v-if="isCountEngine(rule.engine)">
              <n-select
                :options="COUNT_MODE_OPTIONS"
                :value="getCountMode(rule)"
                size="small"
                class="mode"
                @update:value="(v: 'exact' | 'range') => updateCountMode(lang, index, v)"
              />
              <n-input-number
                v-if="getCountMode(rule) === 'exact'"
                :value="rule.exact ?? null"
                size="small"
                class="num"
                placeholder="次数"
                :min="1"
                :show-button="false"
                @update:value="(v: number | null) => updateExactCount(lang, index, v)"
              />
              <template v-else>
                <n-input-number
                  :value="rule.min ?? null"
                  size="small"
                  class="num"
                  placeholder="最少"
                  :min="0"
                  :show-button="false"
                  @update:value="(v: number | null) => updateRule(lang, index, 'min', v)"
                />
                <span>～</span>
                <n-input-number
                  :value="rule.max ?? null"
                  size="small"
                  class="num"
                  placeholder="最多"
                  :min="0"
                  :show-button="false"
                  @update:value="(v: number | null) => updateRule(lang, index, 'max', v)"
                />
              </template>
              <span>次</span>
            </template>
            <div class="grow"></div>
            <n-button quaternary size="tiny" @click="removeRule(lang, index)">删掉</n-button>
          </div>
          <div class="ruleRow sub">
            <n-input
              :value="rule.message"
              size="tiny"
              class="message"
              :placeholder="
                checkOf(lang, index)?.description
                  ? `学生看到「${checkOf(lang, index)!.description}」，想换个说法写这里`
                  : '学生看到的话（不填就按规则自动写）'
              "
              @update:value="(v: string) => updateRule(lang, index, 'message', v)"
            />
            <span v-if="checkOf(lang, index)?.passed === true" class="ok">✓ 标准答案过了</span>
            <span v-else-if="checkOf(lang, index)?.passed === false" class="bad">
              ✗ 标准答案自己没过{{
                checkOf(lang, index)!.actual !== undefined
                  ? `（数到 ${checkOf(lang, index)!.actual} 次）`
                  : ""
              }}
            </span>
            <n-text v-else-if="checkOf(lang, index)" depth="3">没有 {{ lang }} 的标准答案</n-text>
          </div>
        </div>
        <div>
          <n-button size="tiny" @click="addRule(lang)">+ 加一条</n-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.astRules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head,
.ruleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.label {
  font-size: 13px;
  color: v-bind("theme.textColor2");
  width: 72px;
  flex: none;
}

.langs {
  display: flex;
  border: 1px solid v-bind("theme.borderColor");
  border-radius: 4px;
  overflow: hidden;
}

.lang {
  height: 24px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: v-bind("theme.textColor3");
  cursor: pointer;
}

.lang + .lang {
  border-left: 1px solid v-bind("theme.borderColor");
}

.lang.on {
  background-color: rgba(24, 160, 88, 0.12);
  color: v-bind("theme.primaryColorPressed");
  font-weight: 600;
}

.grow {
  flex: 1 1 auto;
}

.note {
  font-size: 12px;
}

.rules {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid v-bind("theme.dividerColor");
  border-radius: 4px;
  background-color: rgba(128, 128, 128, 0.04);
  font-size: 13px;
}

.ruleRow.sub {
  font-size: 12px;
  flex-wrap: nowrap;
}

.engine {
  width: 130px;
}

.target {
  width: 140px;
}

.mode {
  width: 72px;
}

.num {
  width: 64px;
}

.message {
  flex: 1 1 auto;
  min-width: 0;
}

.ok {
  color: v-bind("theme.successColor");
  white-space: nowrap;
}

.bad {
  color: v-bind("theme.errorColor");
  white-space: nowrap;
}

.ruleError {
  font-size: 12px;
  color: v-bind("theme.errorColor");
}
</style>
