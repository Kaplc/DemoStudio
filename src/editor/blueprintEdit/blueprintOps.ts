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
import { mergePatch, clonePatch, logger } from '../../engine'
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
  const hasRef = !!child.ref
  const hasBase = !!child.baseClass
  const count = (hasRef ? 1 : 0) + (hasBase ? 1 : 0)
  if (count === 0) return '子节点必须指定 ref / baseClass 之一'
  if (count > 1) return 'ref / baseClass 互斥，只能指定一个'
  // 组件优先约定（旧格式已废弃）：顶层 position/rotation/scale 一律禁止填写，位置必须写在 transform/uitransform 组件
  const topFields = (['position', 'rotation', 'scale'] as const).filter((k) => child[k] !== undefined)
  if (topFields.length > 0) {
    return `顶层 ${topFields.join('/')} 已废弃：位置必须写在 transform/uitransform 组件（组件优先约定）`
  }
  return null
}

function cloneChildDef(child: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = {}
  if (child.position) out.position = [...child.position]
  if (child.rotation) out.rotation = [...child.rotation]
  if (child.scale) out.scale = [...child.scale]
  if (child.ref) out.ref = child.ref
  if (child.baseClass) out.baseClass = child.baseClass
  if (child.name) out.name = child.name
  if (child.overrides && Object.keys(child.overrides).length) out.overrides = clonePatch(child.overrides)
  if (child.components) out.components = child.components.map((c) => ({ ...c, properties: c.properties ? clonePatch(c.properties) : undefined }))
  if (child.children) out.children = child.children.map((c) => cloneChildDef(c))
  return out
}

/** 把 patch 合并到 base 子节点定义（覆盖 blueprint/baseClass/name，深合并 overrides） */
function mergeChildDef(base: BlueprintChildDef, patch: BlueprintChildDef): BlueprintChildDef {
  const out: BlueprintChildDef = { ...base }
  if (patch.position !== undefined) out.position = [...patch.position]
  if (patch.rotation !== undefined) out.rotation = [...patch.rotation]
  if (patch.scale !== undefined) out.scale = [...patch.scale]
  if (patch.ref !== undefined) out.ref = patch.ref
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
  if (patch.ref && patch.baseClass) return fail('ref 与 baseClass 互斥')
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

/**
 * 在指定父节点下添加子 Actor（追加到其 children 末尾）。
 * parentName 为 null/空 → 添加到根 children 末尾；否则递归按 name 查找父节点。
 * 新子节点不带 name 时直接追加（不触发具名合并语义）；调用方应保证同父内 name 唯一。
 */
export function addChildToParent(
  asset: BlueprintAsset,
  parentName: string | null,
  child: BlueprintChildDef,
): OpResult {
  const err = validateChildDef(child)
  if (err) return fail(err)
  const clone = cloneChildDef(child)
  if (!parentName) {
    const children = asset.children ? asset.children.slice() : []
    children.push(clone)
    asset.children = children
    return ok(asset)
  }
  const found = findChildNodeDeep(asset.children, parentName)
  if (!found) return fail(`父节点 "${parentName}" 不存在`)
  const parentNode = found.arr[found.idx]
  const children = parentNode.children ? parentNode.children.slice() : []
  children.push(clone)
  parentNode.children = children
  return ok(asset)
}

/**
 * 递归按 name 移除子节点（任意嵌套层级）。
 * 根级命中 → 从根 children 删除；深层命中 → 从所在 children 数组删除。
 */
export function removeChildDeep(asset: BlueprintAsset, name: string): OpResult {
  if (typeof name !== 'string' || !name) return fail('name 必须是非空字符串')
  const rootChildren = asset.children ?? []
  const rootIdx = rootChildren.findIndex((c) => c.name === name)
  if (rootIdx >= 0) {
    const children = rootChildren.slice()
    children.splice(rootIdx, 1)
    asset.children = children.length ? children : undefined
    return ok(asset)
  }
  const removeDeep = (children: BlueprintChildDef[] | undefined): boolean => {
    if (!children) return false
    for (let i = 0; i < children.length; i++) {
      if (children[i].name === name) {
        children.splice(i, 1)
        return true
      }
      if (removeDeep(children[i].children)) return true
    }
    return false
  }
  const children = rootChildren.slice()
  if (removeDeep(children)) {
    asset.children = children.length ? children : undefined
    return ok(asset)
  }
  return fail(`子节点 "${name}" 不存在`)
}

/**
 * 递归按 name 重命名子节点（任意嵌套层级）。
 * 调用方负责保证 newName 在同父范围内唯一（同父重名会被资产检查器报 duplicate-name）。
 */
export function renameChildDeep(asset: BlueprintAsset, name: string, newName: string): OpResult {
  if (typeof name !== 'string' || !name) return fail('name 必须是非空字符串')
  if (typeof newName !== 'string' || !newName) return fail('newName 必须是非空字符串')
  if (name === newName) return ok(asset, ['newName 与原名相同，无需修改'])
  const rootChildren = asset.children ?? []
  const rootIdx = rootChildren.findIndex((c) => c.name === name)
  if (rootIdx >= 0) {
    const children = rootChildren.slice()
    children[rootIdx] = { ...children[rootIdx], name: newName }
    asset.children = children
    return ok(asset)
  }
  const renameDeep = (children: BlueprintChildDef[] | undefined): boolean => {
    if (!children) return false
    for (let i = 0; i < children.length; i++) {
      if (children[i].name === name) {
        children[i] = { ...children[i], name: newName }
        return true
      }
      if (renameDeep(children[i].children)) return true
    }
    return false
  }
  const children = rootChildren.slice()
  if (renameDeep(children)) {
    asset.children = children
    return ok(asset)
  }
  return fail(`子节点 "${name}" 不存在`)
}

/**
 * 递归按 id 查找子节点（深度优先；蓝图子节点 id 全资产唯一，定位比 name 可靠——
 * 同父内 name 唯一，但资产历史/不同层级可能重名）。
 * 返回 { arr, idx }：arr 是目标节点所在 children 数组，idx 是其在数组中的索引。
 */
function findChildNodeByIdDeep(
  children: BlueprintChildDef[] | undefined,
  id: number,
): { arr: BlueprintChildDef[]; idx: number } | null {
  if (!children) return null
  const idx = children.findIndex((c) => c.id === id)
  if (idx >= 0) return { arr: children, idx }
  for (const child of children) {
    if (!child.children || child.children.length === 0) continue
    const found = findChildNodeByIdDeep(child.children, id)
    if (found) return found
  }
  return null
}

/**
 * 在指定父节点下添加子 Actor（追加到其 children 末尾）。
 * parentId 定位父节点（null → 根 children 末尾）；按选中节点引用定位，
 * 不受同名节点拦截（区别于 addChildToParent 的 name 定位）。
 */
export function addChildToParentById(
  asset: BlueprintAsset,
  parentId: number | null,
  child: BlueprintChildDef,
): OpResult {
  const err = validateChildDef(child)
  if (err) return fail(err)
  const clone = cloneChildDef(child)
  if (parentId == null) {
    const children = asset.children ? asset.children.slice() : []
    children.push(clone)
    asset.children = children
    return ok(asset)
  }
  const found = findChildNodeByIdDeep(asset.children, parentId)
  if (!found) return fail(`父节点 id ${parentId} 不存在`)
  const parentNode = found.arr[found.idx]
  const children = parentNode.children ? parentNode.children.slice() : []
  children.push(clone)
  parentNode.children = children
  return ok(asset)
}

/**
 * 递归按 id 移除子节点（任意嵌套层级）。id 全资产唯一，不受同名拦截。
 */
export function removeChildById(asset: BlueprintAsset, id: number): OpResult {
  if (typeof id !== 'number') return fail('id 必须是数字')
  const rootChildren = asset.children ?? []
  const removeDeep = (children: BlueprintChildDef[] | undefined): boolean => {
    if (!children) return false
    const idx = children.findIndex((c) => c.id === id)
    if (idx >= 0) {
      children.splice(idx, 1)
      return true
    }
    for (const c of children) {
      if (removeDeep(c.children)) return true
    }
    return false
  }
  const children = rootChildren.slice()
  if (removeDeep(children)) {
    asset.children = children.length ? children : undefined
    return ok(asset)
  }
  return fail(`子节点 id ${id} 不存在`)
}

/**
 * 递归按 id 重命名子节点（任意嵌套层级）。调用方保证 newName 在同父范围内唯一。
 */
export function renameChildById(asset: BlueprintAsset, id: number, newName: string): OpResult {
  if (typeof id !== 'number') return fail('id 必须是数字')
  if (typeof newName !== 'string' || !newName) return fail('newName 必须是非空字符串')
  const rootChildren = asset.children ?? []
  const renameDeep = (children: BlueprintChildDef[] | undefined): boolean => {
    if (!children) return false
    const idx = children.findIndex((c) => c.id === id)
    if (idx >= 0) {
      const cur = children[idx]
      if (cur.name === newName) return true
      children[idx] = { ...cur, name: newName }
      return true
    }
    for (const c of children) {
      if (renameDeep(c.children)) return true
    }
    return false
  }
  const children = rootChildren.slice()
  if (renameDeep(children)) {
    asset.children = children
    return ok(asset)
  }
  return fail(`子节点 id ${id} 不存在`)
}

/**
 * 递归查找具名子节点（深度优先，支持任意嵌套层级）。
 * 返回 { arr, idx }：arr 是目标节点所在 children 数组，idx 是其在数组中的索引。
 * 找不到返回 null。仅按 name 匹配（locator 为 index 时不走此函数）。
 */
function findChildNodeDeep(
  children: BlueprintChildDef[] | undefined,
  name: string,
): { arr: BlueprintChildDef[]; idx: number } | null {
  if (!children) return null
  const idx = children.findIndex((c) => c.name === name)
  if (idx >= 0) return { arr: children, idx }
  for (const child of children) {
    if (!child.children || child.children.length === 0) continue
    const found = findChildNodeDeep(child.children, name)
    if (found) return found
  }
  return null
}

/**
 * 设置子 Actor 的组件属性（Inspector 选中子控件的组件编辑器走这里）。
 * 定位：按 name **递归**定位子节点（支持嵌套层级，如按钮内的文本控件）；组件按 baseClass 匹配。
 *  - 找到 → 合并进其 components（本地无该组件 → 新建 { baseClass, properties }，继承覆盖）
 *  - 本地无该具名子节点：strict=true → 返回错误（防止 ref 子节点等无法映射回本资产的情况误建节点）；
 *    strict=false → 在顶层新建覆盖节点
 */
export function setChildComponentProps(
  asset: BlueprintAsset,
  locator: ChildLocator,
  baseClass: string,
  properties: PropertyPatch,
  strict = false,
): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  if (!isPlainObject(properties)) return fail('properties 必须是对象')
  const warnings: string[] = []
  let node: BlueprintChildDef | undefined

  if ('name' in locator) {
    // 递归查找（支持嵌套层级）
    const found = findChildNodeDeep(asset.children, locator.name)
    if (found) node = found.arr[found.idx]
  } else {
    // 索引定位仅支持顶层（保持旧语义）
    const idx = locateChild(asset.children ?? [], locator)
    if (idx >= 0) node = (asset.children ?? [])[idx]
  }

  // 未找到 → 严格模式报错 / 宽松模式顶层新建覆盖节点
  if (!node) {
    if (!('name' in locator)) return fail(`子节点索引越界: ${locator.index}`)
    if (strict) {
      return fail(`子节点 "${locator.name}" 不在本资产中（可能是 ref 引用实例，无法就地编辑）`)
    }
    const children = asset.children ? asset.children.slice() : []
    node = { name: locator.name }
    children.push(node)
    asset.children = children
    warnings.push(`具名子节点 "${locator.name}" 本地不存在，已新建覆盖节点`)
  }

  const comps = (node.components ? node.components.slice() : []) as BlueprintComponentDef[]
  let existing = comps.find((c) => c.baseClass === baseClass)
  if (!existing) {
    existing = { baseClass }
    comps.push(existing)
  }
  if (existing._remove) delete existing._remove
  existing.properties = mergePatch(existing.properties ?? {}, clonePatch(properties))
  node.components = comps
  // [flow log] 实际写入的组件 properties（用于排查 properties.active 写入后但重建未读到）
  logger.info(`[blueprintOps] setChildComponentProps: child="${('name' in locator ? locator.name : locator.index)}", baseClass=${baseClass}, patch=${JSON.stringify(properties)}, mergedProperties=${JSON.stringify(existing.properties)}`)
  return ok(asset, warnings.length ? warnings : undefined)
}

// ══════════════════════════════════════
//  Defaults（CDO 默认属性）
// ══════════════════════════════════════

/**
 * 组件优先约定：设置蓝图根节点 transform 字段（position/rotation/scale）。
 * 一律写入 transform/uitransform 组件的 properties（引擎/检查器权威来源），
 * 不再写顶层字段（旧格式已废弃）。资产缺少变换组件 → 返回错误。
 */
function setTopTransform(
  asset: BlueprintAsset,
  field: 'position' | 'rotation' | 'scale',
  value: [number, number, number],
): OpResult {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number'))
    return fail(`${field} 必须是 [x, y, z] 数字数组`)
  const comps = asset.components ?? []
  const tsf = comps.find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
  if (!tsf) {
    return fail(`资产缺少 transform/uitransform 组件：${field} 必须写在变换组件（组件优先约定）`)
  }
  const props = (tsf.properties ?? {}) as Record<string, unknown>
  props[field] = value
  return ok(asset)
}

/** 设置蓝图根位置（组件优先，写入 transform/uitransform 组件 properties） */
export function setPosition(asset: BlueprintAsset, pos: [number, number, number]): OpResult {
  return setTopTransform(asset, 'position', pos)
}

/** 设置蓝图根旋转（组件优先，写入 transform/uitransform 组件 properties） */
export function setRotation(asset: BlueprintAsset, rot: [number, number, number]): OpResult {
  return setTopTransform(asset, 'rotation', rot)
}

/** 设置蓝图根缩放（组件优先，写入 transform/uitransform 组件 properties） */
export function setScale(asset: BlueprintAsset, s: [number, number, number]): OpResult {
  return setTopTransform(asset, 'scale', s)
}

// ══════════════════════════════════════
//  元信息（id / baseClass / parent）
// ══════════════════════════════════════

export function setBaseClass(asset: BlueprintAsset, baseClass: string): OpResult {
  if (typeof baseClass !== 'string' || !baseClass) return fail('baseClass 必须是非空字符串')
  asset.baseClass = baseClass
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
