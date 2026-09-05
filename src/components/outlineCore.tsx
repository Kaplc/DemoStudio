/**
 * Outline 纯逻辑核心（无 UI / 无管理器依赖）—— 供 Outline.tsx / UiOutline.tsx / 单测共用。
 *
 * 折叠/眼睛 key 采用"稳定 key"：kind + 父链路径 + 节点名（同层重名追加序号）。
 * 资产保存/修改触发预览重建后 Actor 是全新实例（root.id 变化），稳定 key 不变，
 * 折叠与展开状态得以跨重建保持（tests/outlineCore.test.tsx 锁定该行为）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 大纲树 Actor 的最小结构约束（引擎 Actor / 单测桩均满足） */
export interface OutlineActorLike {
  root: { id: number }
  previewHidden: boolean
  setPreviewHidden(hidden: boolean): void
}

/** 大纲树节点的最小结构约束（SceneTreeNode / 运行中 UI 树节点均满足） */
export interface OutlineNodeLike {
  depth: number
  name: string
  actor: OutlineActorLike | null
}

/** 折叠过滤后的行：节点 + 折叠 key + 是否有子节点 + 是否折叠 */
export interface OutlineRow<T extends OutlineNodeLike = OutlineNodeLike> {
  node: T
  /** 折叠 key（稳定 key），避免不同树/页签互相干扰 */
  key: string
  hasChildren: boolean
  collapsed: boolean
}

/**
 * 计算先序扁平树每行的稳定折叠 key（与渲染顺序一一对应）：
 * kind + 父链路径（父行 key）+ 节点名；同层同名兄弟追加序号保证唯一。
 * key 只依赖树结构本身，与 Actor 实例/root.id 无关 → 跨预览重建保持稳定。
 */
export function computeStableKeys<T extends OutlineNodeLike>(tree: T[], kind: string): string[] {
  const keys: string[] = []
  /** 每个深度最近一个兄弟的路径（不含 kind 前缀，用于拼接父链路径） */
  const lastPathAtDepth: string[] = []
  /** 同层同名兄弟的计数器（追加序号用） */
  const dupCounter = new Map<string, number>()
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    // 回退到当前深度对应的父链状态
    lastPathAtDepth.length = node.depth
    const parentPath = node.depth > 0 ? (lastPathAtDepth[node.depth - 1] ?? '') : ''
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    const dup = dupCounter.get(path) ?? 0
    dupCounter.set(path, dup + 1)
    const pathKey = dup === 0 ? path : `${path}#${dup}`
    keys.push(`${kind}:${pathKey}`)
    lastPathAtDepth[node.depth] = pathKey
  }
  return keys
}

/**
 * 应用折叠过滤：跳过被折叠节点的所有后辈，并标注每行的箭头状态。
 * collapsedKeys 为空 → 全部展开（默认）。
 */
export function applyCollapse<T extends OutlineNodeLike>(
  tree: T[],
  collapsedKeys: Set<string>,
  kind: string,
): OutlineRow<T>[] {
  const stableKeys = computeStableKeys(tree, kind)
  const rows: OutlineRow<T>[] = []
  // 折叠祖先的 depth 栈（用于跳过其子树）
  const foldStack: number[] = []
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    // 离开折叠祖先的子树时弹出（当前 depth <= 祖先 depth）
    while (foldStack.length && foldStack[foldStack.length - 1] >= node.depth) foldStack.pop()
    if (foldStack.length) continue
    const key = stableKeys[i]
    const hasChildren = i + 1 < tree.length && tree[i + 1].depth > node.depth
    const collapsed = hasChildren && collapsedKeys.has(key)
    rows.push({ node, key, hasChildren, collapsed })
    if (collapsed) foldStack.push(node.depth)
  }
  return rows
}

/** 模糊匹配：空格分段全部命中（大小写不敏感子串） */
export function matchesQuery(name: string, q: string): boolean {
  if (!q) return true
  const lower = name.toLowerCase()
  return q.split(/\s+/).filter(Boolean).every((w) => lower.includes(w))
}

/** 搜索过滤后的行：节点 + 原树索引 + 是否有子节点（原树口径） */
export interface FilteredOutlineRow<T extends OutlineNodeLike = OutlineNodeLike> {
  node: T
  /** 原树索引（无 actor 节点生成稳定 key 用） */
  index: number
  hasChildren: boolean
}

/**
 * 模糊搜索过滤（先序扁平树）：保留名称命中的节点及其祖先链。
 * 返回行保持先序；hasChildren 按原树相邻深度判断。
 * 搜索模式下调用方应忽略折叠状态（结果全展开）。
 */
export function filterOutlineTree<T extends OutlineNodeLike>(tree: T[], q: string): FilteredOutlineRow<T>[] {
  const all: FilteredOutlineRow<T>[] = tree.map((node, i) => ({
    node,
    index: i,
    hasChildren: i + 1 < tree.length && tree[i + 1].depth > node.depth,
  }))
  if (!q) return all
  // 正向一遍找父索引（最近一个 depth 更小的前驱）
  const parent = new Array<number>(tree.length).fill(-1)
  const stack: number[] = []
  for (let i = 0; i < tree.length; i++) {
    while (stack.length && tree[stack[stack.length - 1]].depth >= tree[i].depth) stack.pop()
    parent[i] = stack.length ? stack[stack.length - 1] : -1
    stack.push(i)
  }
  // 后向传播：命中节点标记其祖先链
  const keep = new Array<boolean>(tree.length).fill(false)
  for (let i = tree.length - 1; i >= 0; i--) {
    if (matchesQuery(tree[i].name, q)) keep[i] = true
    if (keep[i] && parent[i] >= 0) keep[parent[i]] = true
  }
  return all.filter((_, i) => keep[i])
}

/**
 * 计算每行的"有效隐藏"：自身被眼睛隐藏，或任一祖先被隐藏（子树继承置灰）。
 * 与输入行序一一对应；行只能来自 applyCollapse / filterOutlineTree（折叠只去后辈、
 * 搜索只保留祖先链，祖先行必在后代行之前），故按先序 + 深度栈回溯祖先链即可。
 */
export function computeEffectiveHidden(
  rows: ReadonlyArray<{ node: { depth: number }; key: string }>,
  hiddenKeys: Set<string>,
): boolean[] {
  const flags: boolean[] = []
  /** 深度栈：每层最近一个祖先行的有效隐藏态 */
  const stack: Array<{ depth: number; hidden: boolean }> = []
  for (const row of rows) {
    const depth = row.node.depth
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const hidden = (stack.length > 0 && stack[stack.length - 1].hidden) || hiddenKeys.has(row.key)
    stack.push({ depth, hidden })
    flags.push(hidden)
  }
  return flags
}

/** 收集树中所有"有子节点"的折叠 key（与 applyCollapse 的 key 规则一致） */
export function collectKeysWithChildren<T extends OutlineNodeLike>(tree: T[], kind: string): string[] {
  const stableKeys = computeStableKeys(tree, kind)
  const keys: string[] = []
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    if (i + 1 < tree.length && tree[i + 1].depth > node.depth) {
      keys.push(stableKeys[i])
    }
  }
  return keys
}

/**
 * 把先序扁平树渲染为 `|— ` 树形文本（每层一个 `|— ` 前缀，含尾随空格），可粘贴给 AI / 文档。
 * 有 Actor 的节点带 `[类型名]` 后缀（与大纲行内展示一致）；无 actor 节点只输出名称。
 * @param baseDepth 基准深度（默认 0）：低于该深度的层级截平，子树导出时以目标节点为根
 */
export function buildTreeText(tree: OutlineNodeLike[], baseDepth = 0): string {
  const lines: string[] = []
  for (const node of tree) {
    const indent = '|— '.repeat(Math.max(0, node.depth - baseDepth))
    const typeName = node.actor ? ` [${node.actor.constructor.name}]` : ''
    lines.push(`${indent}${node.name}${typeName}`)
  }
  return lines.join('\n')
}

/**
 * 导出单个节点及其全部子节点的树形文本：在先序扁平树中定位目标节点后，
 * 收集所有 depth 更大的后继行，直到回到同级或更浅层级为止。
 * 目标节点重缩进为顶层（导出文本自包含，不带其在大纲中的层级前缀）。
 * @returns 树形文本；目标不存在返回 null（同层重名命中第一个）
 */
export function buildNodeSubtreeText(tree: OutlineNodeLike[], name: string): string | null {
  const start = tree.findIndex((n) => n.name === name)
  if (start < 0) return null
  const rootDepth = tree[start].depth
  let end = start + 1
  while (end < tree.length && tree[end].depth > rootDepth) end++
  return buildTreeText(tree.slice(start, end), rootDepth)
}

/**
 * 默认折叠 hook：keysWithChildren 中首次出现的 key 自动折叠（新树/新节点默认收起）；
 * 已见过的 key 不重置 —— 用户手动展开后，树刷新不会折叠回去。
 * key 稳定（结构 key）时，预览重建前后同一逻辑节点的 key 不变 → 展开状态保持。
 */
export function useDefaultCollapsed(
  keysWithChildren: string[],
): [Set<string>, (key: string) => void] {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = keysWithChildren.filter((k) => !seenRef.current.has(k))
    if (fresh.length === 0) return
    for (const k of fresh) seenRef.current.add(k)
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      for (const k of fresh) next.add(k)
      return next
    })
  }, [keysWithChildren])
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  return [collapsedKeys, toggleCollapsed]
}
