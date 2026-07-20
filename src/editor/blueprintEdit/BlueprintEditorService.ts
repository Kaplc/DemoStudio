/**
 * BlueprintEditorService — 蓝图资产编辑编排层
 *
 * 把 blueprintOps 的纯函数包装成"读盘 → 应用 op → 写盘 → 重注册 → 通知刷新"的完整流程，
 * 供三类调用方共用：
 *  - 交互式 UI（Inspector / BlueprintEditor）
 *  - 外部 AI（经 MCP 服务器 → HTTP /api/blueprint → 渲染进程）
 *  - 代码脚本（window.blueprintEditor）
 *
 * 调用方永远不直接碰 JSON 文件，统一走 dispatch(op, params)。
 *
 * 校验策略：
 *  - 结构校验：在 blueprintOps 内硬阻断（非法参数直接失败）。
 *  - 注册表校验：补 warnings（未注册类型可能是延迟注册，不阻断）。
 *  - 继承/引用环：乐观注册后 resolve 探测；命中环则回滚并返回失败。
 */
import { BlueprintRegistry, ComponentRegistry, ActorRegistry, logger } from '../../engine'
import type { BlueprintAsset, BlueprintChildDef, PropertyPatch } from '../../engine'
import * as ops from './blueprintOps'
import type { ChildLocator, OpResult } from './blueprintOps'
import { useEditorStore } from '../../stores/editorStore'

/** 注册表快照（返回给调用方，便于 AI 选型） */
export interface BlueprintTypes {
  actors: string[]
  components: string[]
  blueprints: string[]
}

/** 对外统一结果 */
export interface BlueprintEditResult {
  ok: boolean
  error?: string
  /** 操作后的资产（失败时为回滚后的旧资产） */
  asset?: BlueprintAsset
  warnings?: string[]
  types?: BlueprintTypes
}

// ─── 文件读写（经 Electron IPC） ───

interface FileResult {
  success: boolean
  data?: unknown
  error?: string
}

async function readAsset(assetPath: string): Promise<{ ok: true; asset: BlueprintAsset } | { ok: false; error: string }> {
  const read = window.electronAPI?.readJsonFile
  if (!read) return { ok: false, error: '读取蓝图需要 Electron 环境（readJsonFile 不可用）' }
  const r = (await read(assetPath)) as FileResult
  if (!r.success || !r.data) return { ok: false, error: r.error ?? '读取蓝图文件失败' }
  const err = ops.validateAssetShape(r.data)
  if (err) return { ok: false, error: `蓝图格式非法: ${err}` }
  return { ok: true, asset: r.data as BlueprintAsset }
}

async function writeAsset(assetPath: string, data: BlueprintAsset): Promise<{ ok: true } | { ok: false; error: string }> {
  const write = window.electronAPI?.writeJsonFile
  if (!write) return { ok: false, error: '写入蓝图需要 Electron 环境（writeJsonFile 不可用）' }
  const r = (await write(assetPath, data)) as FileResult
  if (!r.success) return { ok: false, error: r.error ?? '写入蓝图文件失败' }
  return { ok: true }
}

// ─── 参数归一化 ───

function pickChildDef(p: Record<string, unknown>): BlueprintChildDef {
  if (p.child && typeof p.child === 'object') return p.child as BlueprintChildDef
  const def: BlueprintChildDef = {}
  if (typeof p.blueprint === 'string') def.blueprint = p.blueprint
  if (typeof p.actor === 'string') def.actor = p.actor
  if (typeof p.name === 'string') def.name = p.name
  if (p.overrides && typeof p.overrides === 'object') def.overrides = p.overrides as PropertyPatch
  return def
}

function pickLocator(p: Record<string, unknown>): ChildLocator | null {
  if (typeof p.index === 'number') return { index: p.index }
  if (typeof p.name === 'string' && p.name) return { name: p.name }
  return null
}

/** op 名 → 纯 op 调用 */
function runOp(asset: BlueprintAsset, op: string, p: Record<string, unknown>): OpResult {
  switch (op) {
    case 'addComponent':
      return ops.addComponent(asset, p.type as string, p.props as PropertyPatch | undefined)
    case 'removeComponent':
      return ops.removeComponent(asset, p.type as string)
    case 'setComponentProps':
      return ops.setComponentProps(asset, p.type as string, (p.patch ?? p.props) as PropertyPatch)
    case 'addChild':
      return ops.addChild(asset, pickChildDef(p))
    case 'updateChild': {
      const loc = pickLocator(p)
      if (!loc) return { ok: false, error: 'updateChild 需要 name 或 index 定位' }
      return ops.updateChild(asset, loc, pickChildDef(p))
    }
    case 'removeChild': {
      const loc = pickLocator(p)
      if (!loc) return { ok: false, error: 'removeChild 需要 name 或 index 定位' }
      return ops.removeChild(asset, loc)
    }
    case 'setDefault':
      return ops.setDefault(asset, (p.path ?? p.key) as string, p.value)
    case 'setDefaults':
      return ops.setDefaults(asset, (p.patch ?? p.defaults) as PropertyPatch)
    case 'deleteDefaults':
      return ops.deleteDefaults(asset, (p.path ?? p.key) as string)
    case 'setBaseClass':
      return ops.setBaseClass(asset, (p.baseClass ?? p.class) as string)
    case 'setParent':
      return ops.setParent(asset, p.parent === undefined ? null : (p.parent as string))
    case 'setId':
      return ops.setId(asset, p.id as string)
    case 'replace':
      return ops.replaceAsset(asset, p.asset as BlueprintAsset)
    default:
      return { ok: false, error: `未知操作: ${op}` }
  }
}

// ─── 服务 ───

export class BlueprintEditorService {
  /** 当前可用类型快照 */
  static listTypes(): BlueprintTypes {
    return {
      actors: ActorRegistry.getRegisteredTypes(),
      components: ComponentRegistry.getRegisteredTypes(),
      blueprints: BlueprintRegistry.getRegisteredIds(),
    }
  }

  /** 读取蓝图资产（确保已注册到 BlueprintRegistry） */
  static async read(assetPath: string): Promise<BlueprintEditResult> {
    const r = await readAsset(assetPath)
    if (!r.ok) return { ok: false, error: r.error, types: this.listTypes() }
    // 编辑器打开时尚未注册的蓝图，读取时补注册（供预览 / resolve 校验）
    if (!BlueprintRegistry.has(r.asset.id)) {
      BlueprintRegistry.loadFromJson(r.asset.id, r.asset)
    }
    return { ok: true, asset: r.asset, types: this.listTypes() }
  }

  /**
   * 应用一次编辑：读盘 → op → 注册表软告警 → 注册并探测环 → 写盘 → 通知刷新。
   */
  static async apply(
    assetPath: string,
    op: string,
    params: Record<string, unknown>,
  ): Promise<BlueprintEditResult> {
    const read = await readAsset(assetPath)
    if (!read.ok) return { ok: false, error: read.error, types: this.listTypes() }
    const oldAsset = read.asset

    const res = runOp(oldAsset, op, params ?? {})
    if (!res.ok) {
      return { ok: false, error: res.error, asset: oldAsset, types: this.listTypes() }
    }
    const newAsset = res.asset!
    const warnings = [...(res.warnings ?? [])]

    // 注册表层软告警
    this.pushRegistryWarnings(newAsset, op, params ?? {}, warnings)

    // 乐观注册后 resolve 探测继承/引用环
    BlueprintRegistry.loadFromJson(newAsset.id, newAsset)
    try {
      BlueprintRegistry.resolve(newAsset.id)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (msg.includes('循环')) {
        // 命中环：回滚注册表，不写盘
        BlueprintRegistry.loadFromJson(oldAsset.id, oldAsset)
        return {
          ok: false,
          error: `蓝图继承/引用存在循环: ${msg}`,
          asset: oldAsset,
          types: this.listTypes(),
        }
      }
      // 非环异常（通常是依赖了尚未注册的蓝图）→ 仅告警
      warnings.push(`resolve 探测跳过（可能依赖尚未注册的蓝图）: ${msg}`)
    }

    // 写盘
    const written = await writeAsset(assetPath, newAsset)
    if (!written.ok) {
      BlueprintRegistry.loadFromJson(oldAsset.id, oldAsset)
      return { ok: false, error: written.error, asset: oldAsset, types: this.listTypes() }
    }

    // 通知打开的编辑器刷新数据 + 预览
    useEditorStore.getState().bumpBlueprintEdit(assetPath)

    logger.info(`[BlueprintEdit] ${op} → ${assetPath}`)
    return {
      ok: true,
      asset: newAsset,
      warnings: warnings.length ? warnings : undefined,
      types: this.listTypes(),
    }
  }

  /**
   * 统一入口（MCP / window API / UI 都走这里）。
   * read / listTypes 不需要 assetPath；其余 op 必须带 assetPath。
   */
  static async dispatch(op: string, params: Record<string, unknown> = {}): Promise<BlueprintEditResult> {
    if (op === 'listTypes') return { ok: true, types: this.listTypes() }
    if (op === 'read') {
      const assetPath = params.assetPath as string | undefined
      if (!assetPath) return { ok: false, error: 'read 需要 assetPath' }
      return this.read(assetPath)
    }
    const assetPath = params.assetPath as string | undefined
    if (!assetPath) return { ok: false, error: `${op} 需要 assetPath` }
    return this.apply(assetPath, op, params)
  }

  // ─── 软告警：类型未注册时提示（不阻断） ───

  private static pushRegistryWarnings(
    asset: BlueprintAsset,
    op: string,
    p: Record<string, unknown>,
    warnings: string[],
  ): void {
    if (op === 'addComponent' || op === 'setComponentProps') {
      const t = p.type as string
      if (t && !ComponentRegistry.has(t)) warnings.push(`Component 类型 "${t}" 未注册（可能延迟注册）`)
    } else if (op === 'setBaseClass') {
      const cls = (p.baseClass ?? p.class) as string
      if (cls && !ActorRegistry.has(cls)) warnings.push(`Actor 类型 "${cls}" 未注册`)
    } else if (op === 'setParent') {
      const parent = p.parent as string
      if (parent && !BlueprintRegistry.has(parent)) warnings.push(`父蓝图 "${parent}" 未注册`)
    } else if (op === 'addChild' || op === 'updateChild') {
      const bp = (p.blueprint ?? (p.child as { blueprint?: string })?.blueprint) as string | undefined
      if (bp && !BlueprintRegistry.has(bp)) warnings.push(`子蓝图 "${bp}" 未注册`)
    }
  }
}
