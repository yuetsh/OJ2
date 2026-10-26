/**
 * Mermaid 文本画成 SVG。渲染器是 pele（obsidianmd/pele），不是 mermaid 本身：
 * 同一套语法，同步渲染、没有依赖，流程图部分 gzip 后 44 kB（mermaid 要 200 kB 以上）。
 * 换之前拿库里全部 2170 张图对过：两边能画的、报错的完全一致。
 *
 * pele 的版本号锁死（不带 ^）：项目 2026-10 才开，小版本也在改排版。
 */

const semanticNodeClasses = ['startNode', 'endNode', 'startEnd', 'input', 'output', 'process', 'decision', 'loop']

const displayStyleId = 'oj-mermaid-display-style'

/** 框的颜色：[class, 底色, 边框]。pele 把 `class n0 startNode` 原样挂在节点的 <g> 上 */
const nodeColors: [string, string, string][] = [
  ['startNode', '#eef8f2', '#18a058'],
  ['startEnd', '#eef8f2', '#18a058'],
  ['endNode', '#eef8f2', '#18a058'],
  ['input', '#eef4fd', '#2f6bc4'],
  ['output', '#eef4fd', '#2f6bc4'],
  ['process', '#ffffff', '#7d828a'],
  ['decision', '#fdf5e6', '#d08a1c'],
  ['loop', '#fdf5e6', '#d08a1c'],
  ['oj-node-palette-0', '#dbeafe', '#2563eb'],
  ['oj-node-palette-1', '#ccfbf1', '#0d9488'],
  ['oj-node-palette-2', '#ede9fe', '#7c3aed'],
  ['oj-node-palette-3', '#ffe4e6', '#e11d48'],
  ['oj-node-palette-4', '#fef3c7', '#d97706'],
  ['oj-node-palette-5', '#dcfce7', '#16a34a'],
]

// !important 是为了压过老提交里 classDef 写进 style 属性的颜色，全站的图一个样
const mermaidDisplayStyle = `
.oj-mermaid-flowchart {
  --pele-bg: #ffffff;
  --pele-fg: #0f172a;
  --pele-line: #64748b;
  --pele-surface: #f8fafc;
  --pele-border: #2563eb;
  --pele-muted: #334155;
}

.oj-mermaid-flowchart .pele-node > :not(text) {
  stroke-width: 2px !important;
  filter: drop-shadow(0 6px 12px rgba(15, 23, 42, 0.12));
}
${nodeColors
  .map(
    ([cls, fill, stroke]) => `
.oj-mermaid-flowchart .pele-node.${cls} > :not(text) {
  fill: ${fill} !important;
  stroke: ${stroke} !important;
}`,
  )
  .join('')}

.oj-mermaid-flowchart .pele-node text {
  fill: #0f172a !important;
}

.oj-mermaid-flowchart .pele-edge > path:not(.pele-marker) {
  stroke-width: 2.4px;
}

.oj-mermaid-flowchart .pele-edge-label rect {
  fill: rgba(255, 255, 255, 0.94);
  stroke: #cbd5e1;
}

.oj-mermaid-flowchart .pele-edge-label text {
  fill: #334155;
  font-weight: 600;
}
`

const svgNamespace = 'http://www.w3.org/2000/svg'

function applyFlowchartDisplayStyle(container: HTMLElement) {
  container.classList.add('oj-mermaid-surface')

  const svg = container.querySelector('svg')
  if (!svg) return

  svg.classList.add('oj-mermaid-flowchart')

  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.pele-node'))

  // Assign palette indices by label so same label → same color, different labels → different colors
  const labelPaletteMap = new Map<string, number>()
  let paletteCounter = 0

  nodes.forEach((node) => {
    const hasSemanticClass = semanticNodeClasses.some((className) => node.classList.contains(className))
    if (!hasSemanticClass) {
      const label = node.querySelector('.pele-label')?.textContent?.trim() ?? ''
      if (!labelPaletteMap.has(label)) {
        labelPaletteMap.set(label, paletteCounter % 6)
        paletteCounter++
      }
      node.classList.add(`oj-node-palette-${labelPaletteMap.get(label)}`)
    }
  })

  svg.querySelector(`#${displayStyleId}`)?.remove()
  const style = document.createElementNS(svgNamespace, 'style')
  style.setAttribute('id', displayStyleId)
  style.textContent = mermaidDisplayStyle
  svg.insertBefore(style, svg.firstChild)
}

export function useMermaid() {
  const renderError = ref<string | null>(null)
  const renderSuccess = ref(false)
  let renderGeneration = 0

  const renderFlowchart = async (container: HTMLElement | null, mermaidCode: string) => {
    renderError.value = null
    renderSuccess.value = false

    if (container) container.innerHTML = ''

    if (!container || !mermaidCode?.trim()) return

    const gen = ++renderGeneration
    try {
      // pele/lazy 按图的类型现拉对应的模块，题目里绝大多数是流程图，只拉那一块
      const { renderAsync } = await import('pele/lazy')
      const { svg } = await renderAsync(mermaidCode, {
        // 量字宽用页面真实的字体，否则框会比字窄或宽
        fontFamily: getComputedStyle(container).fontFamily,
        // 题目是老师写的、提交是学生写的，图里的链接和外链图片一律不画
        links: false,
        images: false,
      })
      if (gen !== renderGeneration) return
      container.innerHTML = svg
      applyFlowchartDisplayStyle(container)
      renderSuccess.value = true
    } catch (error) {
      if (gen !== renderGeneration) return
      renderError.value = error instanceof Error ? error.message : '流程图渲染失败，请检查代码格式'
    }
  }

  const clearError = () => {
    renderError.value = null
  }

  return {
    renderError: readonly(renderError),
    renderSuccess: readonly(renderSuccess),
    renderFlowchart,
    clearError,
  }
}
