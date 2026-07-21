/**
 * assetLint/AssetWalker — 文档遍历 + 派发任务流
 *
 * 区分 scene / blueprint 文档根，产出 DispatchTask[]：
 *   - 场景：doc:scene + 每个 objects[] 节点 → node:<type>
 *   - 蓝图：doc:blueprint + 根 objects[] + 每个 component → comp:<type> + 递归 children.objects[]
 *
 * 蓝图 SceneNode 出现在"根 objects + children.objects（递归）"两处；场景 objects 为扁平数组。
 * 每条 task 带 nodePath 定位串（如 'children[0].objects[1] (box)'）。
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
  // 蓝图根：有 id + 任一蓝图特征字段
  const isBlueprint =
    typeof root.id === 'string' &&
    ('baseClass' in root || 'components' in root || 'children' in root || 'parent' in root)

  if (isScene) {
    tasks.push({ kind: 'doc:scene', node: root, nodePath: '<scene 根>' })
    walkNodes(root.objects as unknown[], tasks, 'objects')
    return { rootKind: 'doc:scene', tasks }
  }

  if (isBlueprint) {
    tasks.push({ kind: 'doc:blueprint', node: root, nodePath: '<blueprint 根>' })
    if (Array.isArray(root.objects)) walkNodes(root.objects, tasks, 'objects')
    if (Array.isArray(root.components)) {
      ;(root.components as unknown[]).forEach((c, i) => {
        if (c && typeof (c as Record<string, unknown>).type === 'string') {
          const type = (c as Record<string, unknown>).type as string
          tasks.push({ kind: `comp:${type}`, node: c, nodePath: `components[${i}] (${type})` })
        }
      })
    }
    if (Array.isArray(root.children)) walkChildren(root.children, tasks, 'children')
    return { rootKind: 'doc:blueprint', tasks }
  }

  return { rootKind: null, tasks }
}

/** 遍历 SceneNode 数组，每个节点按 type 派发 node:<type>。 */
function walkNodes(nodes: unknown[], tasks: DispatchTask[], base: string): void {
  nodes.forEach((n, i) => {
    if (!n || typeof n !== 'object') return
    const type = (n as Record<string, unknown>).type
    if (typeof type !== 'string') return
    tasks.push({ kind: `node:${type}`, node: n, nodePath: `${base}[${i}] (${type})` })
  })
}

/** 递归蓝图 children：每个 child 的 objects[] 派发，再深入 child.children。 */
function walkChildren(children: unknown[], tasks: DispatchTask[], base: string): void {
  children.forEach((c, i) => {
    if (!c || typeof c !== 'object') return
    const here = `${base}[${i}]`
    const child = c as Record<string, unknown>
    if (Array.isArray(child.objects)) walkNodes(child.objects, tasks, `${here}.objects`)
    if (Array.isArray(child.children)) walkChildren(child.children, tasks, `${here}.children`)
  })
}
