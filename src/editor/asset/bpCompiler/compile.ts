/**
 * compile — 蓝图 TS 源编译器主入口（doc-dev/bp-ts-compile 方案 §5）
 *
 * compileBlueprint(def, { sourceHash })：duck 校验 → 执行 build() → 根/子树规范化
 * → 确定性 id 分配（先序，从 10001 起，跳过显式 id）→ 附着 sourceHash。
 *
 * 错误模型：收集全部错误一次返回（不 fail-fast），与 uiCompiler 的 CompileFail 风格一致；
 * path 指认源构造树中的位置（如 'children[2].components[0].baseClass'、'<根>'）。
 *
 * 纯函数、零引擎运行时依赖（对 BlueprintAsset 仅 import type，esbuild 打包时擦除）。
 */
import type {
  BlueprintAsset,
  BlueprintChildDef,
  BlueprintComponentDef,
} from '../../../engine/asset/BlueprintAsset'
import type { PropertyPatch } from '../../../engine/tools/deepMerge'
import type { BpChildInput, BpComponentInput, BlueprintDef } from './dsl'

/** 编译错误（path 指向源构造树中的位置，rule 与手写 lint 规则名对齐） */
export interface BpCompileError {
  path: string
  rule: string
  message: string
}

/** 编译结果：ok 时 doc 已含 sourceHash */
export type CompileBlueprintResult =
  | { ok: true; doc: BlueprintAsset }
  | { ok: false; errors: BpCompileError[] }

export interface CompileBlueprintOptions {
  /** fnv1a(去 BOM 源文本)，格式 `fnv1a-xxxxxxxx` */
  sourceHash: string
}

/** 子节点自动 id 的起始值（跳过已被显式 id 占用的值；根节点不分配 id，与手写约定一致） */
const AUTO_ID_START = 10001

function err(path: string, rule: string, message: string): BpCompileError {
  return { path, rule, message }
}

export function compileBlueprint(def: unknown, opts: CompileBlueprintOptions): CompileBlueprintResult {
  const errors: BpCompileError[] = []

  // ① duck 校验 def：须为对象且 build 为函数
  if (def === null || typeof def !== 'object' || typeof (def as BlueprintDef).build !== 'function') {
    return {
      ok: false,
      errors: [err('<根>', 'missing-define-blueprint',
        '须 default export defineBlueprint(...) 的返回值（缺 build 函数或不是对象）')],
    }
  }

  // ② 执行 build()；异常包装为 build-threw（不产生半成品 doc）
  let rootInput: unknown
  try {
    rootInput = (def as BlueprintDef).build()
  } catch (e) {
    return {
      ok: false,
      errors: [err('<根>', 'build-threw', `build() 执行抛出异常: ${(e as Error)?.message ?? String(e)}`)],
    }
  }
  if (rootInput === null || typeof rootInput !== 'object' || Array.isArray(rootInput)) {
    return {
      ok: false,
      errors: [err('<根>', 'build-invalid-root', 'build() 返回值须为对象（BpRootInput）')],
    }
  }
  const root = rootInput as BpChildRoot

  // ③ 根规范化：name 非空 string；baseClass 缺省 'Actor'；顶层 transform 旧字段禁止
  if (typeof root.name !== 'string' || root.name.trim() === '') {
    errors.push(err('<根>', 'root-missing-name', '根节点缺少非空 name'))
  }
  for (const legacy of ['position', 'rotation', 'scale'] as const) {
    if (root[legacy] !== undefined) {
      errors.push(err('<根>', 'top-transform-forbidden',
        `顶层 ${legacy} 已废弃（与手写 lint 规则同语义）：请把变换写进 transform() / UITransformComponent 组件`))
    }
  }

  // ④ 组件/子节点规范化（缺省补 []；ref/baseClass 互斥；ref 路径格式前置校验；显式 id 收集）
  const explicitNodeIds = new Map<number, string>()
  const explicitCompIds = new Map<number, string>()
  const doc: BlueprintAsset = {
    name: typeof root.name === 'string' ? root.name : '',
    baseClass: typeof root.baseClass === 'string' && root.baseClass !== '' ? root.baseClass : 'Actor',
    components: normalizeComponents(root.components, '<根>', errors, explicitCompIds),
    children: normalizeChildren(root.children, '', errors, explicitNodeIds, explicitCompIds),
  }

  // ⑤ 确定性 id 分配（深度先序：父先于子、同级按数组序；跳过显式 id）
  assignChildIds(doc.children ?? [], explicitNodeIds)

  // ⑥ 附着 sourceHash（ok 与否都构造 doc，但有错误时不外泄）
  doc.sourceHash = opts.sourceHash

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, doc }
}

/** build() 返回值的宽松视图（未知来源，逐字段防御） */
type BpChildRoot = Record<string, unknown> & {
  name?: unknown
  baseClass?: unknown
  components?: unknown
  children?: unknown
}

/** 组件规范化：缺省补 []；baseClass 必填；显式 id 校验/查重（组件 id 不自动分配） */
function normalizeComponents(
  input: unknown,
  nodePath: string,
  errors: BpCompileError[],
  explicitCompIds: Map<number, string>,
): BlueprintComponentDef[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    errors.push(err(nodePath, 'components-not-array', 'components 须为数组'))
    return []
  }
  return input.map((raw, i) => {
    const path = `${nodePath}.components[${i}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(err(path, 'component-not-object', '组件须为对象（BpComponentInput）'))
      return { baseClass: '' }
    }
    const c = raw as BpComponentInput & Record<string, unknown>
    if (typeof c.baseClass !== 'string' || c.baseClass === '') {
      errors.push(err(`${path}.baseClass`, 'component-missing-baseclass', '组件缺少非空 baseClass'))
    }
    const out: BlueprintComponentDef = { baseClass: typeof c.baseClass === 'string' ? c.baseClass : '' }
    if (c.name !== undefined) out.name = c.name as string
    if (c.id !== undefined) {
      out.id = c.id as number
      checkExplicitId(c.id, `${path}.id`, explicitCompIds, errors)
    }
    if (c.properties !== undefined) out.properties = c.properties as PropertyPatch
    return out
  })
}

/** 子树规范化（递归）：ref/baseClass 互斥、ref 路径格式、active/overrides 透传、缺省补齐 */
function normalizeChildren(
  input: unknown,
  parentPath: string,
  errors: BpCompileError[],
  explicitNodeIds: Map<number, string>,
  explicitCompIds: Map<number, string>,
): BlueprintChildDef[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    errors.push(err(parentPath || '<根>', 'children-not-array', 'children 须为数组'))
    return []
  }
  return input.map((raw, i): BlueprintChildDef => {
    const path = `${parentPath}children[${i}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(err(path, 'child-not-object', '子节点须为对象（BpChildInput）'))
      return {}
    }
    const c = raw as BpChildInput & Record<string, unknown>
    const hasRef = typeof c.ref === 'string'
    const hasBase = typeof c.baseClass === 'string' && c.baseClass !== ''
    if (hasRef && hasBase) {
      errors.push(err(path, 'child-bp-ref-conflict', 'ref 与 baseClass 互斥（与手写 lint 规则同语义）'))
    } else if (!hasRef && !hasBase) {
      errors.push(err(path, 'child-missing-type', '子节点须带 ref 或 baseClass 之一'))
    }
    if (c.ref !== undefined && (typeof c.ref !== 'string' || !/^asset\/.+\.blueprint\.json$/.test(c.ref))) {
      errors.push(err(`${path}.ref`, 'ref-invalid-path',
        `ref 路径须形如 asset/**/**.blueprint.json（lint 兜底前的前置校验）: ${String(c.ref)}`))
    }
    // 键序对齐手写 BlueprintChildDef：ref / baseClass / name / id / overrides / components / active / children
    const out: BlueprintChildDef = {}
    if (hasRef) out.ref = c.ref as string
    if (hasBase) out.baseClass = c.baseClass as string
    if (c.name !== undefined) out.name = c.name as string
    if (c.id !== undefined) {
      out.id = c.id as number
      checkExplicitId(c.id, `${path}.id`, explicitNodeIds, errors)
    }
    if (c.overrides !== undefined) out.overrides = c.overrides as PropertyPatch
    out.components = normalizeComponents(c.components, path, errors, explicitCompIds)
    if (c.active !== undefined) out.active = c.active as boolean
    out.children = normalizeChildren(c.children, `${path}.`, errors, explicitNodeIds, explicitCompIds)
    return out
  })
}

/** 显式 id 校验：正整数；查重（duplicate-id 带 path 与首次出现位置） */
function checkExplicitId(
  value: unknown,
  path: string,
  used: Map<number, string>,
  errors: BpCompileError[],
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    errors.push(err(path, 'invalid-id', `非法 id（须为正整数）: ${String(value)}`))
    return
  }
  const first = used.get(value)
  if (first !== undefined) {
    errors.push(err(path, 'duplicate-id', `显式 id ${value} 重复（首次出现在 ${first}）`))
    return
  }
  used.set(value, path)
}

/** 确定性 id 分配：先序遍历（父先于子、同级按数组序），从 10001 起跳过显式占用值 */
function assignChildIds(children: BlueprintChildDef[], explicit: Map<number, string>): void {
  const used = new Set(explicit.keys())
  let next = AUTO_ID_START
  const walk = (nodes: BlueprintChildDef[], parentPath: string): void => {
    nodes.forEach((node, i) => {
      const path = `${parentPath}children[${i}]`
      if (node.id === undefined) {
        while (used.has(next)) next += 1
        node.id = next
        used.add(next)
      }
      if (node.children !== undefined && node.children.length > 0) {
        walk(node.children, `${path}.`)
      }
    })
  }
  walk(children, '')
}
