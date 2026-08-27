import type { Edge, Node } from "@vue-flow/core"

/**
 * 把画布上的节点/连线裁成「可持久化」的形状。
 *
 * 画布里的 node 是 vue-flow 的 GraphNode：除了我们自己塞进去的字段，它还挂着
 * `dimensions` / `computedPosition` / `handleBounds` / `selected` / `dragging` /
 * `resizing` / `initialized` / `isParent` / `events` 一堆运行时内部状态（见
 * vue-flow 的 parseNode）。这些东西会跟着一起：
 *
 *   - 写进 localStorage（每次改动都写一次）
 *   - 进 20 份历史快照，每份都要 JSON 深拷贝一遍
 *   - 压缩后提交进数据库，长期存着
 *
 * 实测一个两节点的图就能撑到 600+ 字节，其中大半是 handleBounds。而重新挂载时
 * 这些字段全都会被重新计算，存下来没有任何意义 —— 还会把存档格式和 vue-flow
 * 的内部实现绑死，将来升级或迁移数据都要跟着动。
 *
 * `style` 保留：它是建节点时按类型算好的（见 useNodeStyles），丢了会让恢复出来
 * 的图变样。
 */
export function toPortableNodes(nodes: Node[]) {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: {
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    },
    data: node.data,
    style: node.style,
  })) as Node[]
}

export function toPortableEdges(edges: Edge[]) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    type: edge.type,
    label: edge.label,
  })) as Edge[]
}
