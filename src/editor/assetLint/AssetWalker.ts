/**
 * assetLint/AssetWalker — 文档遍历 + 派发任务流
 *
 * 区分 scene / blueprint 文档根，产出 DispatchTask[]：
 *   - 场景：doc:scene + 每个 objects[] 节点 → node:<type>
 *   - 蓝图：doc:blueprint + 根 components[] + 递归 children[].components[] → comp:<type>
 *
 * 场景 objects 为扁平数组；蓝图中每个 child 的 components 递归遍历。
 * 每条 task 带 nodePath 定位串（如 'children[0].components[1] (mesh)'）。
 * 未知 type 不抛错（由 engine 记一条 warn）。
 */
import type { CheckerKind } from './types'

export interface DispatchTask {
  kind: CheckerKind
  node: unknown
  nodePath: string
}

export interface WalkResult {
  /** 文档根类型；无法识别时为 null。 */
  rootKind: CheckerKind | null
  tasks: DispatchTask[]
}

/** 识别文档根并产出所有派发任务。 */
export function walkDocument(doc: unknown): WalkResult {
  const tasks: DispatchTask[] = []
  if (!doc || typeof doc !== 'object') return { rootKind: null, tasks }

  const root = doc as Record<string, unknown>

  // 场景根：有 name + objects 数组
  const isScene = typeof root.name === 'string' && Array.isArray(root.objects)
  // 蓝图根：有 path（string） + baseClass
  const isBlueprint =
    typeof root.path === 'string' &&
    typeof root.baseClass === 'string'

  if (isScene) {
    tasks.push({ kind: 'doc:scene', node: root, nodePath: '<scene 根>' })
    walkNodes(root.objects as unknown[], tasks, 'objects')
    return { rootKind: 'doc:scene', tasks }
  }

  if (isBlueprint) {
    tasks.push({ kind: 'doc:blueprint', node: root, nodePath: '<blueprint 根>' })
    if (Array.isArray(root.components)) {
      ;(root.components as unknown[]).forEach((c, i) => {
        if (c && typeof (c as Record<string, unknown>).baseClass === 'string') {
          const bc = (c as Record<string, unknown>).baseClass as string
          tasks.push({ kind: `comp:${bc}`, node: c, nodePath: `components[${i}] (${bc})` })
        }
      })
    }
    if (Array.isArray(root.children)) walkChildren(root.children, tasks, 'children')
    return { rootKind: 'doc:blueprint', tasks }
  }

  return { rootKind: null, tasks }
}

/** 遍历 SceneNode 数组，每个节点按 type 派发 node:<type>；actor 节点递归派发其 components。 */
function walkNodes(nodes: unknown[], tasks: DispatchTask[], base: string): void {
  nodes.forEach((n, i) => {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    const type = node.type
    if (typeof type !== 'string') return
    tasks.push({ kind: `node:${type}`, node: n, nodePath: `${base}[${i}] (${type})` })

    // actor 节点：递归派发其 components（与蓝图 doc:blueprint 逻辑一致）
    if (type === 'actor') {
      const here = `${base}[${i}] (actor)`
      if (Array.isArray(node.components)) {
        ;(node.components as unknown[]).forEach((comp, j) => {
          if (comp && typeof (comp as Record<string, unknown>).baseClass === 'string') {
            const bc = (comp as Record<string, unknown>).baseClass as string
            tasks.push({ kind: `comp:${bc}`, node: comp, nodePath: `${here}.components[${j}] (${bc})` })
          }
        })
      }
      // 递归 actor 的 children（含内联 baseClass 和 ref）
      if (Array.isArray(node.children)) {
        walkChildren(node.children, tasks, `${here}.children`)
      }
    }
  })
}

/** 递归蓝图 children（后续可扩展为派发 child 的 components） */
function walkChildren(children: unknown[], tasks: DispatchTask[], base: string): void {
  children.forEach((c, i) => {
    if (!c || typeof c !== 'object') return
    const here = `${base}[${i}]`
    const child = c as Record<string, unknown>
    if (Array.isArray(child.components)) {
      ;(child.components as unknown[]).forEach((comp, j) => {
        if (comp && typeof (comp as Record<string, unknown>).baseClass === 'string') {
          const bc = (comp as Record<string, unknown>).baseClass as string
          tasks.push({ kind: `comp:${bc}`, node: comp, nodePath: `${here}.components[${j}] (${bc})` })
        }
      })
    }
    if (Array.isArray(child.children)) walkChildren(child.children, tasks, `${here}.children`)
  })
}
