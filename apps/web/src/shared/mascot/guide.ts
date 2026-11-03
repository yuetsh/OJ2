import type { Router } from 'vue-router'
import type { MascotSituation } from './lines'

/**
 * 看板娘的「引导」：页面告诉她现在是什么情况、气泡里的按钮各做什么。
 *
 * 每个页面在 setup 里调一次 useMascotGuide，给一个函数；看板娘被点的那一刻才调用它，
 * 所以函数里直接读页面当下的状态就行，不用做成 computed。函数返回 null 就当这页没有专门的话，
 * 看板娘只打招呼。比赛里看板娘不弹气泡，那一层在 Mascot.vue 里按路由判断，页面不用管。
 *
 * 以后要按学生的行为调整她说什么（常错哪一类、习惯先跑例子还是直接交），也是往这一层加信号。
 */
export interface MascotAction {
  label: string
  run: () => unknown
}

export interface MascotGuide {
  situation: MascotSituation
  /** 台词里 `{n}` 换成它：还差几道、第几课、几个人举手 */
  n?: number
  /** 别的占位：`{tag}` 换成 vars.tag（知识点名、成就名、「明天」……） */
  vars?: Record<string, string | number>
  /** 最多三个，第一个是主按钮 */
  actions?: MascotAction[]
}

type GuideProvider = () => MascotGuide | null

/** 后挂上的排在后面；一页只挂一个，嵌套的子组件别再挂 */
const providers = shallowRef<GuideProvider[]>([])

export function useMascotGuide(provider: GuideProvider) {
  onMounted(() => {
    providers.value = [...providers.value, provider]
  })
  onBeforeUnmount(() => {
    providers.value = providers.value.filter((it) => it !== provider)
  })
}

export function currentMascotGuide(): MascotGuide | null {
  const list = providers.value
  for (let i = list.length - 1; i >= 0; i--) {
    const guide = list[i]!()
    if (guide) return guide
  }
  return null
}

/** 把台词里的 `{n}` 和 `{xxx}` 换成真的数和字 */
export function fillLine(line: string, guide: Pick<MascotGuide, 'n' | 'vars'>) {
  return line.replace(/\{(\w+)\}/g, (all, key: string) => {
    if (key === 'n' && guide.n !== undefined) return String(guide.n)
    const value = guide.vars?.[key]
    return value === undefined ? all : String(value)
  })
}

// ---- 几个页面都用得上的按钮 ----

/** 顶栏「输入题号直达」框：看板娘点一下就把光标放进去。ProblemJumpBox 盯着这个数 */
export const jumpFocusRequest = ref(0)

export function focusJumpAction(): MascotAction {
  return { label: '输题号', run: () => jumpFocusRequest.value++ }
}

/** 和题目列表的「随便来一道」同一个接口：不限知识点和类型，按学生惯用的语言挑 */
export function randomProblemAction(router: Router): MascotAction {
  return {
    label: '随便来一道',
    run: async () => {
      const [{ getRandomProblem }, { useCodeStore }] = await Promise.all([import('oj/api'), import('oj/store/code')])
      const id = await getRandomProblem({ tag: '', type: '', language: useCodeStore().preferredLanguage() })
      router.push('/problem/' + id)
    },
  }
}

export function goAction(router: Router, label: string, to: string): MascotAction {
  return { label, run: () => router.push(to) }
}

// ---- 别的浮层要让开她 ----

/**
 * 看板娘现在占的地方（视口坐标，拖动中也跟着变）。不在页面上（手机、没挂载）时 shown 为 false。
 * 成就弹框靠它让开：学生把她拖进右上角时，弹框正好压在她头上。
 */
export const mascotBox = reactive({ shown: false, x: 0, y: 0, width: 0, height: 0 })
