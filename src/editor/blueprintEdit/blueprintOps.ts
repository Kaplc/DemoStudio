/**
 * blueprintOps — 通用蓝图资产 JSON 编辑工具核心（纯函数）
 *
 * 目的：把"直接编辑 BlueprintAsset JSON"替换为一组结构化、带校验的高级操作。
 * 任何调用方（交互式 UI / MCP 外部 AI / 代码脚本）都应通过这些 op 修改蓝图，
 * 而不是手写字段。
 *
 * 设计取舍：
 *  - 纯函数：传入 BlueprintAsset（原地修改后返回），返回 OpResult。调用方负责读盘/写盘。
 *  - 仅做结构校验（type 非空、child 的 blueprint/actor 互斥、点路径合法）。
 *    注册表层校验（ComponentRegistry/ActorRegistry/BlueprintRegistry 是否存在该类型）
 *    由 BlueprintEditorService 在编排层补 warnings，不在本层硬阻断——避免误伤延迟注册的类型。
 *  - 语义与 BlueprintRegistry.resolve 对齐：
 *      · addComponent / setComponentProps：本地无该 type 时新建 { type, props }（合并到继承链）
 *      · removeComponent：本地无该 type 时写 { type, _remove: true }（继承覆盖标记）
 *      · setDefault：点路径（"houseColors.roof"）；value=null 表示删除（与 PropertyPatch 一致）
 *      · removeChild：本地无具名子节点时写 { name, _remove: true }
 */
import type {
  BlueprintAsset,
  BlueprintComponentDef,
  BlueprintChildDef,
} from '../../engine'
import { mergePatch, clonePatch } from '../../engine'
import type { PropertyPatch } from '../../engine'

// ─── 结果类型 ───

export interface OpResult<T = unknown> {
  ok: boolean
  error?: string
  /** 操作后的资产（ok=true 时存在） */
  asset?: BlueprintAsset
  /** 软告警（不阻断操作，仅供调用方提示） */
  warnings?: string[]
  /** 附加数据（如 get 类操作） */
  data?: T
}

function ok(asset: BlueprintAsset, warnings?: string[]): OpResult {
  return { ok: true, asset, warnings: warnings && warnings.length ? warnings : undefined }
}

function fail(error: string, asset?: BlueprintAsset): OpResult {
  return { ok: false, error, asset }
}

// ─── 工具 ───

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 校验资产顶层形状，返回错误信息或 null */
export function validateAssetShape(a: unknown): string | null {
  if (!isPlainObject(a)) return '资产必须是对象'
  if (typeof a.id !== 'string' || !a.id) return '缺少合法 id（非空字符串）'
  if (typeof a.baseClass !== 'string' || !a.baseClass) return '缺少合法 baseClass（非空字符串）'
  return null
}

// ══════════════════════════════════════
//  Components
// ══════════════════════════════════════

/**
 * 添加 Component（若已存在则取消 _remove 标记并深合并 props）。
 * @param props 可选初始属性（构造参数 + 可配置属性）
 */
export function addComponent(
  asset: BlueprintAsset,
  type: string,
  props?: PropertyPatch,
): OpResult {
  if (typeof type !== 'string' || !type) return fail('type 必须是非空字符串')
  const components = asset.components ? asset.components.slice() : []
  const existing = components.find((c) => c.type === type)
  if (existing) {
    if (existing._remove) delete existing._remove
    if (props && Object.keys(props).length) {
      existing.props = mergePatch(existing.props ?? {}, clonePatch(props))
    }
  } else {
    const def: BlueprintComponentDef = { type }
    if (props && Object.keys(props).length) def.props = clonePatch(props)
    components.push(def)
  }
  asset.components = components
  return ok(asset)
}

/**
 * 移除 Component。
 * 本地存在该 type → 删除本地定义；本地不存在 → 写 { type, _remove: true } 继承覆盖标记。
 */
export function removeComponent(asset: BlueprintAsset, type: string): OpResult {
  if (typeof type !== 'string' || !type) return fail('type 必须是非空字符串')
  const components = asset.components ? asset.components.slice() : []
  const idx = components.findIndex((c) => c.type === type)
  if (idx >= 0) {
    components.splice(idx, 1)
    asset.components = components.length ? components : undefined
    return ok(asset)
  }
  // 本地无 → 写继承覆盖移除标记
  asset.components = [...components, { type, _remove: true }]
  return ok(asset, [`本地无 "${type}" 组件，已写入 _remove 继承覆盖标记`])
}

/**
 * 深合并 props 到指定类型 Component（本地不存在则新建 { type, props }）。
 */
export function setComponentProps(
  asset: BlueprintAsset,
  type: string,
  patch: PropertyPatch,
): OpResult {
  if (typeof type !== 'string' || !type) return fail('type 必须是非空字符串')
  if (!isPlainObject(patch)) return fail('patch 必须是对象')
  const components = asset.components ? asset.components.slice() : []
  let existing = components.find((c) => c.type === type)
  if (!existing) {
    existing = { type }
    components.push(existing)
    asset.components = components
  }
  if (existing._remove) delete existing._remove
  existing.props = mergePatch(existing.props ?? {}, clonePatch(patch))
  return ok(asset)
}

/** 读取本地 Component 的 props（不存在返回 null） */
export function getComponentProps(asset: BlueprintAsset, type: string): PropertyPatch | null {
  const c = (asset.components ?? []).find((x) => x.type === type)
  return c ? (c.props ?? {}) : null
}

// ══════════════════════════════════════
//  Children（子 Actor）
// ══════════════════════════════════════

/** 子节点定位：按具名（继承合并键）或本地数组索引 */
export type ChildLocator = { name: string } | { index: number }

function validateChildDef(child: BlueprintChildDef): string | null {
  if (!isPlainObject(child)) return '子节点必须是对象'
  if (!child.blueprint && !child.actor) return '子节点必须指定 blueprint 或 actor'
  if (child.blueprint && child.actor) return 'blueprint 与 actor 互斥，只能指定一个'
  return null
}

function cloneChildDef(child: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = {}
  if (child.blueprint) out.blueprint = child.blueprint
  if (child.actor) out.actor = child.actor
  if (child.name) out.name = child.name
  if (child.overrides && Object.keys(child.overrides).length) out.overrides = clonePatch(child.overrides)
  return out
}

/** 把 patch 合并到 base 子节点定义（覆盖 blueprint/actor/name，深合并 overrides） */
function mergeChildDef(base: BlueprintChildDef, patch: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = { ...base }
  if (patch.blueprint !== undefined) out.blueprint = patch.blueprint
  if (patch.actor !== undefined) out.actor = patch.actor
  if (patch.name !== undefined) out.name = patch.name
  if (patch.overrides && Object.keys(patch.overrides).length) {
    out.overrides = mergePatch(clonePatch(out.overrides ?? {}), clonePatch(patch.overrides))
  }
  return out
}

function locateChild(children: BlueprintChildDef[], locator: ChildLocator): number {
  if ('index' in locator) return locator.index >= 0 && locator.index < children.length ? locator.index : -1
  return children.findIndex((c) => c.name === locator.name)
}

/**
 * 添加子 Actor。
 * 具名（name）子节点已存在 → 合并覆盖；否则追加。
 */
export function addChild(asset: BlueprintAsset, child: BlueprintChildDef): OpResult {
  const err = validateChildDef(child)
  if (err) return fail(err)
  const children = asset.children ? asset.children.slice() : []
  if (child.name) {
    const idx = children.findIndex((c) => c.name === child.name)
    if (idx >= 0) {
      children[idx] = mergeChildDef(children[idx], child)
      asset.children = children
      return ok(asset, [`具名子节点 "${child.name}" 已存在，已合并`])
    }
  }
  children.push(cloneChildDef(child))
  asset.children = children
  return ok(asset)
}

/**
 * 更新子 Actor（覆盖 blueprint/actor/name，深合并 overrides）。
 * 按具名找不到时，新建一个 override 节点（继承链合并）。
 */
export function updateChild(
  asset: BlueprintAsset,
  locator: ChildLocator,
  patch: BlueprintChildDef,
): OpResult {
  if (!isPlainObject(patch)) return fail('patch 必须是对象')
  if (patch.blueprint && patch.actor) return fail('blueprint 与 actor 互斥')
  const children = asset.children ? asset.children.slice() : []
  const idx = locateChild(children, locator)
  if (idx === -1) {
    if ('name' in locator) {
      const node: BlueprintChildDef = { name: locator.name }
      const merged = mergeChildDef(node, patch)
      // mergeChildDef 会保留空 name，确保带上
      children.push(merged)
      asset.children = children
      return ok(asset, [`具名子节点 "${locator.name}" 本地不存在，已新建覆盖节点`])
    }
    return fail(`子节点索引越界: ${locator.index}`)
  }
  children[idx] = mergeChildDef(children[idx], patch)
  asset.children = children
  return ok(asset)
}

/**
 * 移除子 Actor。
 * 本地存在 → 删除；本地无具名子节点 → 写 { name, _remove: true } 继承覆盖标记。
 */
export function removeChild(asset: BlueprintAsset, locator: ChildLocator): OpResult {
  const children = asset.children ? asset.children.slice() : []
  const idx = locateChild(children, locator)
  if (idx >= 0) {
    children.splice(idx, 1)
    asset.children = children.length ? children : undefined
    return ok(asset)
  }
  if ('name' in locator) {
    children.push({ name: locator.name, _remove: true })
    asset.children = children
    return ok(asset, [`本地无具名子节点 "${locator.name}"，已写入 _remove 继承覆盖标记`])
  }
  return fail(`子节点索引越界: ${locator.index}`)
}

// ══════════════════════════════════════
//  Defaults（CDO 默认属性）
// ══════════════════════════════════════

/** 深合并一个 patch 到 defaults（父 → 子覆盖语义） */
export function setDefaults(asset: BlueprintAsset, patch: PropertyPatch): OpResult {
  if (!isPlainObject(patch)) return fail('patch 必须是对象')
  asset.defaults = mergePatch(asset.defaults ? clonePatch(asset.defaults) : {}, clonePatch(patch))
  return ok(asset)
}

/**
 * 按点路径设置单个默认值（如 "houseColors.roof"）。
 * value=null 表示删除该键（与 PropertyPatch 语义一致）。
 */
export function setDefault(asset: BlueprintAsset, dottedPath: string, value: unknown): OpResult {
  if (typeof dottedPath !== 'string' || !dottedPath) return fail('dottedPath 必须是非空字符串')
  const root = asset.defaults ? clonePatch(asset.defaults) : {}
  setDotted(root, dottedPath.split('.'), value)
  asset.defaults = root
  return ok(asset)
}

/** 按点路径删除默认值 */
export function deleteDefaults(asset: BlueprintAsset, dottedPath: string): OpResult {
  if (typeof dottedPath !== 'string' || !dottedPath) return fail('dottedPath 必须是非空字符串')
  const root = asset.defaults ? clonePatch(asset.defaults) : {}
  deleteDotted(root, dottedPath.split('.'))
  asset.defaults = root
  return ok(asset)
}

function setDotted(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (!isPlainObject(cur[k])) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]
  if (value === null) delete cur[last]
  else cur[last] = value
}

function deleteDotted(obj: Record<string, unknown>, keys: string[]): void {
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (!isPlainObject(cur[k])) return
    cur = cur[k] as Record<string, unknown>
  }
  delete cur[keys[keys.length - 1]]
}

// ══════════════════════════════════════
//  元信息（id / baseClass / parent）
// ══════════════════════════════════════

export function setId(asset: BlueprintAsset, id: string): OpResult {
  if (typeof id !== 'string' || !id) return fail('id 必须是非空字符串')
  asset.id = id
  return ok(asset)
}

export function setBaseClass(asset: BlueprintAsset, baseClass: string): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  asset.baseClass = baseClass
  return ok(asset)
}

/** 设置父蓝图；parent=null 表示解除继承 */
export function setParent(asset: BlueprintAsset, parent: string | null): OpResult {
  if (parent === null) {
    delete asset.parent
    return ok(asset)
  }
  if (typeof parent !== 'string' || !parent) return fail('parent 必须是非空字符串或 null')
  asset.parent = parent
  return ok(asset)
}

// ══════════════════════════════════════
//  逃生舱：整体替换（带形状校验）
// ══════════════════════════════════════

/** 用新资产整体替换（克隆 + 形状校验），用于 op 覆盖不到的场景 */
export function replaceAsset(_asset: BlueprintAsset, newAsset: BlueprintAsset): OpResult {
  const err = validateAssetShape(newAsset)
  if (err) return fail(err)
  return ok(clonePatch(newAsset))
}
