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
  if (typeof a.id !== 'number' || !Number.isFinite(a.id)) return '缺少合法 id（数字）'
  if (typeof a.name !== 'string' || !a.name) return '缺少合法 name（非空字符串）'
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
/**
 * 添加 Component（按 baseClass）。
 * 若已存在同 baseClass 的组件，深合并 properties。
 */
export function addComponent(
  asset: BlueprintAsset,
  baseClass: string,
  properties?: PropertyPatch,
  id?: number,
  name?: string,
): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  const components = asset.components ? asset.components.slice() : []
  const existing = components.find((c) => c.baseClass === baseClass)
  if (existing) {
    if (existing._remove) delete existing._remove
    if (properties && Object.keys(properties).length) {
      existing.properties = mergePatch(existing.properties ?? {}, clonePatch(properties))
    }
    if (id !== undefined) existing.id = id
    if (name !== undefined) existing.name = name
  } else {
    const def: BlueprintComponentDef = { baseClass }
    if (id !== undefined) def.id = id
    if (name !== undefined) def.name = name
    if (properties && Object.keys(properties).length) def.properties = clonePatch(properties)
    components.push(def)
  }
  asset.components = components
  return ok(asset)
}

/**
 * 移除 Component（按 baseClass）。
 * 本地存在 → 删除本地定义；本地不存在 → 写 { baseClass, _remove: true } 继承覆盖标记。
 */
export function removeComponent(asset: BlueprintAsset, baseClass: string): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  const components = asset.components ? asset.components.slice() : []
  const idx = components.findIndex((c) => c.baseClass === baseClass)
  if (idx >= 0) {
    components.splice(idx, 1)
    asset.components = components.length ? components : undefined
    return ok(asset)
  }
  // 本地无 → 写继承覆盖移除标记
  asset.components = [...components, { baseClass, _remove: true }]
  return ok(asset, [`本地无 "${baseClass}" 组件，已写入 _remove 继承覆盖标记`])
}

/**
 * 深合并 properties 到指定 baseClass 的 Component。
 * 本地不存在则新建 { baseClass, properties }。
 */
export function setComponentProps(
  asset: BlueprintAsset,
  baseClass: string,
  properties: PropertyPatch,
): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  if (!isPlainObject(properties)) return fail('properties 必须是对象')
  const comps = asset.components ? asset.components.slice() : []
  let existing = comps.find((c) => c.baseClass === baseClass)
  if (!existing) {
    existing = { baseClass }
    comps.push(existing)
    asset.components = comps
  }
  if (existing._remove) delete existing._remove
  existing.properties = mergePatch(existing.properties ?? {}, clonePatch(properties))
  return ok(asset)
}

/** 读取本地 Component 的 properties（不存在返回 null） */
export function getComponentProps(asset: BlueprintAsset, baseClass: string): PropertyPatch | null {
  const c = (asset.components ?? []).find((x) => x.baseClass === baseClass)
  return c ? (c.properties ?? {}) : null
}

// ══════════════════════════════════════
//  Children（子 Actor）
// ══════════════════════════════════════

/** 子节点定位：按具名（继承合并键）或本地数组索引 */
export type ChildLocator = { name: string } | { index: number }

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
}

function validateChildDef(child: BlueprintChildDef): string | null {
  if (!isPlainObject(child)) return '子节点必须是对象'
  if (!child.blueprint && !child.baseClass) return '子节点必须指定 blueprint 或 baseClass'
  if (child.blueprint && child.baseClass) return 'blueprint 与 baseClass 互斥，只能指定一个'
  if (!isVec3(child.position)) return '缺少合法 position（[x, y, z] 数字数组）'
  if (!isVec3(child.rotation)) return '缺少合法 rotation（[x, y, z] 数字数组）'
  if (!isVec3(child.scale)) return '缺少合法 scale（[x, y, z] 数字数组）'
  return null
}

function cloneChildDef(child: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = { position: child.position, rotation: child.rotation, scale: child.scale }
  if (child.blueprint) out.blueprint = child.blueprint
  if (child.baseClass) out.baseClass = child.baseClass
  if (child.name) out.name = child.name
  if (child.overrides && Object.keys(child.overrides).length) out.overrides = clonePatch(child.overrides)
  if (child.components) out.components = child.components.map((c) => ({ ...c, properties: c.properties ? clonePatch(c.properties) : undefined }))
  if (child.children) out.children = child.children.map((c) => cloneChildDef(c))
  return out
}

/** 把 patch 合并到 base 子节点定义（覆盖 blueprint/baseClass/name，深合并 overrides） */
function mergeChildDef(base: BlueprintChildDef, patch: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = { ...base, position: patch.position ?? base.position, rotation: patch.rotation ?? base.rotation, scale: patch.scale ?? base.scale }
  if (patch.blueprint !== undefined) out.blueprint = patch.blueprint
  if (patch.baseClass !== undefined) out.baseClass = patch.baseClass
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
 * 更新子 Actor（覆盖 blueprint/baseClass/name，深合并 overrides）。
 * 按具名找不到时，新建一个 override 节点（继承链合并）。
 */
export function updateChild(
  asset: BlueprintAsset,
  locator: ChildLocator,
  patch: BlueprintChildDef,
): OpResult {
  if (!isPlainObject(patch)) return fail('patch 必须是对象')
  if (patch.blueprint && patch.baseClass) return fail('blueprint 与 baseClass 互斥')
  const children = asset.children ? asset.children.slice() : []
  const idx = locateChild(children, locator)
  if (idx === -1) {
    if ('name' in locator) {
      const node: BlueprintChildDef = { name: locator.name, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
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
    children.push({ name: locator.name, _remove: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
    asset.children = children
    return ok(asset, [`本地无具名子节点 "${locator.name}"，已写入 _remove 继承覆盖标记`])
  }
  return fail(`子节点索引越界: ${locator.index}`)
}

// ══════════════════════════════════════
//  Defaults（CDO 默认属性）
// ══════════════════════════════════════

/** 设置蓝图顶层位置 */
export function setPosition(asset: BlueprintAsset, pos: [number, number, number]): OpResult {
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => typeof n === 'number')) 
    return fail('position 必须是 [x, y, z] 数字数组')
  asset.position = pos
  return ok(asset)
}

/** 设置蓝图顶层旋转 */
export function setRotation(asset: BlueprintAsset, rot: [number, number, number]): OpResult {
  if (!Array.isArray(rot) || rot.length !== 3 || !rot.every((n) => typeof n === 'number'))
    return fail('rotation 必须是 [x, y, z] 数字数组')
  asset.rotation = rot
  return ok(asset)
}

/** 设置蓝图顶层缩放 */
export function setScale(asset: BlueprintAsset, s: [number, number, number]): OpResult {
  if (!Array.isArray(s) || s.length !== 3 || !s.every((n) => typeof n === 'number'))
    return fail('scale 必须是 [x, y, z] 数字数组')
  asset.scale = s
  return ok(asset)
}

// ══════════════════════════════════════
//  元信息（id / baseClass / parent）
// ══════════════════════════════════════

export function setId(asset: BlueprintAsset, id: number): OpResult {
  if (typeof id !== 'number' || !Number.isFinite(id)) return fail('id 必须是数字')
  asset.id = id
  return ok(asset)
}

export function setBaseClass(asset: BlueprintAsset, baseClass: string): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  asset.baseClass = baseClass
  return ok(asset)
}

/** 设置父蓝图；parent=null 表示解除继承 */
export function setParent(asset: BlueprintAsset, parent: number | null): OpResult {
  if (parent === null) {
    delete asset.parent
    return ok(asset)
  }
  if (typeof parent !== 'number' || !Number.isFinite(parent)) return fail('parent 必须是数字或 null')
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
