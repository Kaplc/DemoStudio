/**
 * BlueprintEditorService — 蓝图资产编辑编排层
 *
 * 把 blueprintOps 的纯函数包装成"读盘 → 应用 op → 写盘 → 重注册 → 通知刷新"的完整流程,
 * 供三类调用方共用:
 *  - 交互式 UI（Inspector / BlueprintEditor）
 *  - 外部 AI（经 MCP 服务器 → HTTP /api/blueprint → 渲染进程）
 *  - 代码脚本（window.blueprintEditor）
 *
 * 调用方永远不直接碰 JSON 文件，统一走 dispatch(op, params)。
 *
 * 校验策略:
 *  - 结构校验：在 blueprintOps 内硬阻断（非法参数直接失败）。
 *  - 注册表校验：补 warnings（未注册类型可能是延迟注册，不阻断）。
 *  - 继承/引用环：乐观注册后 resolve 探测；命中环则回滚并返回失败。
 */
import { BlueprintRegistry, ComponentRegistry, ActorRegistry, logger } from '../../engine'
import type { BlueprintAsset, BlueprintChildDef, PropertyPatch } from '../../engine'
import * as ops from './blueprintOps'
import type { ChildLocator, OpResult } from './blueprintOps'
import { UndoManager } from './UndoManager'   
import { useEditorStore } from '../../stores/editorStore'
import { editorBus } from '../EditorEvents'
import { EditorEvent } from '../EditorEventNames'

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

/** 磁盘路径 → 蓝图注册 key（asset/...）。输入如 src/projects/fish/asset/blueprints/foo.blueprint.json */
function diskPathToAssetKey(diskPath: string): string {
  // 取 "asset/" 之后的部分；找不到则原样返回
  const idx = diskPath.indexOf('/asset/')
  if (idx >= 0) return diskPath.slice(idx + 1)
  return diskPath
}

async function readAsset(assetPath: string): Promise<{ ok: true; asset: BlueprintAsset; key: string } | { ok: false; error: string }> {
  const read = window.electronAPI?.readJsonFile
  if (!read) return { ok: false, error: '读取蓝图需要 Electron 环境（readJsonFile 不可用）' }
  const r = (await read(assetPath)) as FileResult
  if (!r.success || !r.data) return { ok: false, error: r.error ?? '读取蓝图文件失败' }
  const err = ops.validateAssetShape(r.data)
  if (err) return { ok: false, error: `蓝图格式非法: ${err}` }
  // 注册 key 由磁盘路径推导（asset/...），资产内不保存 path
  const asset = r.data as BlueprintAsset
  return { ok: true, asset, key: diskPathToAssetKey(assetPath) }
}

async function writeAsset(assetPath: string, data: BlueprintAsset): Promise<{ ok: true } | { ok: false; error: string }> {
  const write = window.electronAPI?.writeJsonFile
  if (!write) return { ok: false, error: '写入蓝图需要 Electron 环境（writeJsonFile 不可用）' }
  const r = (await write(assetPath, data)) as FileResult
  if (!r.success) return { ok: false, error: r.error ?? '写入蓝图文件失败' }
  return { ok: true }
}

// ─── 日志辅助 ───

/** 提取资产根 transform/uitransform 组件 position 用于日志追踪（无组件返回 'n/a'） */
function logPos(asset: BlueprintAsset | undefined): string {
  if (!asset) return 'n/a'
  const tsf = (asset.components ?? []).find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
  const p = tsf?.properties?.position
  return Array.isArray(p) ? `[${(p as number[]).join(',')}]` : 'n/a'
}

/** 日志用参数摘要：剔除 assetPath 等大字段，保留 op 关键参数 */
function logParams(op: string, p: Record<string, unknown>): string {
  switch (op) {
    case 'setPosition': return `position=${JSON.stringify(p.position)}`
    case 'setRotation': return `rotation=${JSON.stringify(p.rotation)}`
    case 'setScale': return `scale=${JSON.stringify(p.scale)}`
    case 'addComponent': return `type=${p.baseClass ?? p.type}`
    case 'removeComponent': return `type=${p.baseClass ?? p.type}`
    case 'setComponentProps': return `type=${p.baseClass ?? p.type}`
    case 'addChild': return `name=${(p.child as { name?: string })?.name ?? p.name}`
    case 'updateChild': return `name=${p.name ?? p.index}`
    case 'removeChild': return `name=${p.name ?? p.index}`
    case 'setChildComponentProps': return `child=${p.name ?? p.index}, type=${p.baseClass ?? p.type}`
    case 'setBaseClass': return `class=${p.baseClass ?? p.class}`
    default: return Object.keys(p ?? {}).join(',')
  }
}

// ─── 参数归一化 ───

function pickChildDef(p: Record<string, unknown>): BlueprintChildDef {
  if (p.child && typeof p.child === 'object') return p.child as BlueprintChildDef
  // 组件优先约定：新建子节点不再生成顶层 position/rotation/scale（旧格式已废弃）,
  // 位置由调用方在 components 里声明 transform/uitransform 组件承载
  const def: BlueprintChildDef = {}
  if (typeof p.ref === 'string') def.ref = p.ref
  if (typeof p.baseClass === 'string') def.baseClass = p.baseClass
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
      return ops.addComponent(asset, (p.baseClass ?? p.type) as string, (p.properties ?? p.props) as PropertyPatch | undefined, p.id as number | undefined, p.name as string | undefined)
    case 'removeComponent':
      return ops.removeComponent(asset, (p.baseClass ?? p.type) as string)
    case 'setComponentProps':
      return ops.setComponentProps(asset, (p.baseClass ?? p.type) as string, (p.properties ?? p.patch ?? p.props) as PropertyPatch)
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
    case 'setChildComponentProps': {
      const loc = pickLocator(p)
      if (!loc) return { ok: false, error: 'setChildComponentProps 需要 name 或 index 定位' }
      return ops.setChildComponentProps(
        asset,
        loc,
        (p.baseClass ?? p.type) as string,
        (p.properties ?? p.patch ?? p.props) as PropertyPatch,
        p.strict === true,
      )
    }
    case 'setBaseClass':
      return ops.setBaseClass(asset, (p.baseClass ?? p.class) as string)
    case 'setPosition':
      return ops.setPosition(asset, p.position as [number, number, number])
    case 'setRotation':
      return ops.setRotation(asset, p.rotation as [number, number, number])
    case 'setScale':
      return ops.setScale(asset, p.scale as [number, number, number])
    case 'replace':
      return ops.replaceAsset(asset, p.asset as BlueprintAsset)
    default:
      return { ok: false, error: `未知操作: ${op}` }
  }
}

// ─── 服务 ───

export class BlueprintEditorService {
  /** 内存工作副本：注册 key → 最新资产。UI 编辑只改这里，不写盘（假保存） */
  private static workingCopies = new Map<string, BlueprintAsset>()
  /** 脏标记：副本与磁盘不一致（存在未保存修改） */
  private static dirtyKeys = new Set<string>()

  /** 当前可用类型快照 */
  static listTypes(): BlueprintTypes {
    return {
      actors: ActorRegistry.getRegisteredTypes(),
      components: ComponentRegistry.getRegisteredTypes(),
      blueprints: BlueprintRegistry.getRegisteredPaths(),
    }
  }

  /** 读取蓝图资产（确保已注册到 BlueprintRegistry）。有工作副本时返回副本（内存最新状态）
   *  返回深拷贝，防止调用方原地修改污染工作副本 */
  static async read(assetPath: string): Promise<BlueprintEditResult> {
    const key = diskPathToAssetKey(assetPath)
    const cached = this.workingCopies.get(key)
    if (cached) {
      if (!BlueprintRegistry.has(key)) BlueprintRegistry.loadFromJson(key, cached)
      return { ok: true, asset: JSON.parse(JSON.stringify(cached)) as BlueprintAsset, types: this.listTypes() }
    }
    const r = await readAsset(assetPath)
    if (!r.ok) return { ok: false, error: r.error, types: this.listTypes() }
    if (!BlueprintRegistry.has(r.key)) {
      BlueprintRegistry.loadFromJson(r.key, r.asset)
    }
    return { ok: true, asset: r.asset, types: this.listTypes() }
  }

    /** 取得工作副本；无则从磁盘读取建立（首次编辑/打开时） */
  private static async getWorkingCopy(
    assetPath: string,
  ): Promise<{ ok: true; key: string; asset: BlueprintAsset } | { ok: false; error: string }> {
    const key = diskPathToAssetKey(assetPath)
    const cached = this.workingCopies.get(key)
    if (cached) {
      logger.debug(`[BlueprintEdit] 工作副本命中: ${key}`)
      return { ok: true, key, asset: cached }
    }
    const read = await readAsset(assetPath)
    if (!read.ok) {
      logger.error(`[BlueprintEdit] 工作副本建立失败（读盘）: ${key}: ${read.error}`)
      return { ok: false, error: read.error }
    }
    this.workingCopies.set(key, read.asset)
    logger.info(`[BlueprintEdit] 工作副本建立（读盘）: ${key}`)
    return { ok: true, key, asset: read.asset }
  }

  /**
   * 应用一次编辑：改工作副本 → 注册表软告警 → 注册并探测环 →（可选写盘）→ 通知刷新。
   * persist=false（默认，UI 编辑）：只改内存副本 + push 撤销快照，不碰磁盘（假保存）。
   * persist=true（MCP/脚本 dispatch）：保持旧语义立即落盘。
   */
  static async apply(
    assetPath: string,
    op: string,
    params: Record<string, unknown>,
    opts: { persist?: boolean } = {},
  ): Promise<BlueprintEditResult> {
    const persist = opts.persist ?? false
    const wc = await this.getWorkingCopy(assetPath)
    if (!wc.ok) return { ok: false, error: wc.error, types: this.listTypes() }
    const { key } = wc
    const oldAsset = wc.asset
    // 动作前快照（深拷贝），供撤销回退
    const oldSnapshot = JSON.parse(JSON.stringify(oldAsset)) as BlueprintAsset

    const dBefore = UndoManager.depth(key)
    const oldPosLog = logPos(oldAsset)
    logger.info(`[BlueprintEdit] apply 开始: ${op}(${logParams(op, params ?? {})}) → ${key}（persist=${persist}，pos ${oldPosLog}，undo 栈 ${dBefore.undo}）`)

    const res = runOp(oldAsset, op, params ?? {})
    if (!res.ok) {
      logger.warn(`[BlueprintEdit] apply 被拒: ${op} → ${key}: ${res.error}`)
      return { ok: false, error: res.error, asset: oldAsset, types: this.listTypes() }
    }
    const newAsset = res.asset!
    const warnings = [...(res.warnings ?? [])]

    // 注册表层软告警
    this.pushRegistryWarnings(newAsset, op, params ?? {}, warnings)

    // 乐观注册后 resolve 探测继承/引用环（key 由磁盘路径推导）
    BlueprintRegistry.loadFromJson(key, newAsset)
    try {
      BlueprintRegistry.resolve(key)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (msg.includes('循环')) {
        // 命中环：回滚注册表与副本，不提交
        BlueprintRegistry.loadFromJson(key, oldAsset)
        logger.warn(`[BlueprintEdit] apply 回滚（引用环）: ${op} → ${key}: ${msg}`)
        return {
          ok: false,
          error: `蓝图引用存在循环: ${msg}`,
          asset: oldAsset,
          types: this.listTypes(),
        }
      }
      // 非环异常（通常是依赖了尚未注册的蓝图）→ 仅告警
      warnings.push(`resolve 探测跳过（可能依赖尚未注册的蓝图）: ${msg}`)
    }

    // 提交到工作副本 + 撤销快照（动作前状态）
    UndoManager.push(key, oldSnapshot)
    this.workingCopies.set(key, newAsset)
    this.dirtyKeys.add(key)

    // 仅显式保存时写盘
    if (persist) {
      const written = await writeAsset(assetPath, newAsset)
      if (!written.ok) {
        // 写盘失败：回滚副本 + 注册表
        this.workingCopies.set(key, oldSnapshot)
        BlueprintRegistry.loadFromJson(key, oldAsset)
        logger.error(`[BlueprintEdit] 写盘失败，回滚: ${key}: ${written.error}`)
        return { ok: false, error: written.error, asset: oldAsset, types: this.listTypes() }
      }
      this.dirtyKeys.delete(key)
      editorBus.emit(EditorEvent.BLUEPRINT_SAVED, assetPath)
    }

    // 通知打开的编辑器刷新数据 + 预览
    useEditorStore.getState().bumpBlueprintEdit(assetPath)

    logger.info(`[BlueprintEdit] apply 完成: ${op} → ${key}（pos ${oldPosLog}→${logPos(newAsset)}，undo 栈 ${dBefore.undo}→${UndoManager.depth(key).undo}）${persist ? '（已落盘）' : ''}`)
    return {
      ok: true,
      asset: newAsset,
      warnings: warnings.length ? warnings : undefined,
      types: this.listTypes(),
    }
  }

  /** 显式保存：把工作副本 flush 到磁盘（Ctrl+S / 保存按钮）。不 bump（由调用方决定重建时机） */
  static async save(assetPath: string): Promise<BlueprintEditResult> {
    const key = diskPathToAssetKey(assetPath)
    const asset = this.workingCopies.get(key)
    if (!asset) return { ok: false, error: '没有打开的工作副本（请先编辑再保存）', types: this.listTypes() }
    logger.info(`[BlueprintEdit] save 开始: ${key}（pos ${logPos(asset)}，dirty=${this.dirtyKeys.has(key)}）`)
    const written = await writeAsset(assetPath, asset)
    if (!written.ok) {
      logger.error(`[BlueprintEdit] save 失败: ${key}: ${written.error}`)
      return { ok: false, error: written.error, asset, types: this.listTypes() }
    }
    this.dirtyKeys.delete(key)
    editorBus.emit(EditorEvent.BLUEPRINT_SAVED, assetPath)
    logger.info(`[BlueprintEdit] save 完成（已落盘）: ${key}`)
    return { ok: true, asset, types: this.listTypes() }
  }

  /**
   * 预览管理器在拖动/拖拽松手后调用：把预览内存态同步进工作副本（不写盘）。
   * 内部 push 当前副本（= 动作前状态）作为撤销快照，所以每次松手 = 一个撤销点。
   * 不 bump：预览自身已是最新内存态，无需重建。
   */
  static async updateFromPreview(assetPath: string, data: BlueprintAsset): Promise<void> {
    // 确保工作副本存在：首次拖拽（无副本）先读盘建立，撤销快照 = 动作前真实磁盘状态
    const wc = await this.getWorkingCopy(assetPath)
    if (!wc.ok) {
      logger.error(`[BlueprintEdit] 预览同步失败（无法建立工作副本）: ${assetPath}: ${wc.error}`)
      return
    }
    const key = wc.key
    const cur = this.workingCopies.get(key) ?? wc.asset
    UndoManager.push(key, cur)
    this.workingCopies.set(key, data)
    this.dirtyKeys.add(key)
    // 注册表同步（撤销/保存后 spawn 用新数据；预览自身已是内存最新，无需 bump）
    BlueprintRegistry.loadFromJson(key, data)
    try { BlueprintRegistry.resolve(key) } catch { /* 探测失败仅告警级，不阻断 */ }
    logger.info(`[BlueprintEdit] 预览同步工作副本: ${key}（pos ${logPos(cur)}→${logPos(data)}，undo 栈 ${UndoManager.depth(key).undo}）`)
  }

  /** 撤销：恢复上一个快照 → 更新副本/注册表 → bump 重建预览 */
  static async undo(assetPath: string): Promise<BlueprintEditResult> {
    const key = diskPathToAssetKey(assetPath)
    const cur = this.workingCopies.get(key)
    const dBefore = UndoManager.depth(key)
    const snap = UndoManager.undo(key, cur)
    if (snap == null) {
      logger.warn(`[BlueprintEdit] undo 无历史可撤: ${key}`)
      return { ok: false, error: '没有可撤销的历史', types: this.listTypes() }
    }
    const asset = snap as BlueprintAsset
    this.workingCopies.set(key, asset)
    this.dirtyKeys.add(key)
    BlueprintRegistry.loadFromJson(key, asset)
    try { BlueprintRegistry.resolve(key) } catch { }
    useEditorStore.getState().bumpBlueprintEdit(assetPath)
    logger.info(`[BlueprintEdit] undo: ${key} pos ${logPos(cur)}→${logPos(asset)}（undo 栈 ${dBefore.undo}→${UndoManager.depth(key).undo}，redo ${dBefore.redo}→${UndoManager.depth(key).redo}）`)
    return { ok: true, asset, types: this.listTypes() }
  }

  /** 重做：恢复 redo 快照 → 更新副本/注册表 → bump 重建预览 */
  static async redo(assetPath: string): Promise<BlueprintEditResult> {
    const key = diskPathToAssetKey(assetPath)
    const cur = this.workingCopies.get(key)
    const dBefore = UndoManager.depth(key)
    const snap = UndoManager.redo(key, cur)
    if (snap == null) {
      logger.warn(`[BlueprintEdit] redo 无历史可重做: ${key}`)
      return { ok: false, error: '没有可重做的历史', types: this.listTypes() }
    }
    const asset = snap as BlueprintAsset
    this.workingCopies.set(key, asset)
    this.dirtyKeys.add(key)
    BlueprintRegistry.loadFromJson(key, asset)
    try { BlueprintRegistry.resolve(key) } catch { }
    useEditorStore.getState().bumpBlueprintEdit(assetPath)
    logger.info(`[BlueprintEdit] redo: ${key} pos ${logPos(cur)}→${logPos(asset)}（undo 栈 ${dBefore.undo}→${UndoManager.depth(key).undo}，redo ${dBefore.redo}→${UndoManager.depth(key).redo}）`)
    return { ok: true, asset, types: this.listTypes() }
  }

  /** 副本是否与磁盘不一致（存在未保存修改） */
  static isDirty(assetPath: string): boolean {
    return this.dirtyKeys.has(diskPathToAssetKey(assetPath))
  }

  /** 切换工程/关闭时清理全部副本与历史 */
  static clearCache(): void {
    this.workingCopies.clear()
    this.dirtyKeys.clear()
    UndoManager.clearAll()
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
    // 外部入口（MCP / window API）：保持"立即落盘"语义
    if (op === 'save') return this.save(assetPath)
    if (op === 'undo') return this.undo(assetPath)
    if (op === 'redo') return this.redo(assetPath)
    return this.apply(assetPath, op, params, { persist: true })
  }

  // ─── 软告警：类型未注册时提示（不阻断） ───

  private static pushRegistryWarnings(
    asset: BlueprintAsset,
    op: string,
    p: Record<string, unknown>,
    warnings: string[],
  ): void {
    if (op === 'addComponent' || op === 'setComponentProps' || op === 'setChildComponentProps') {
      const t = p.baseClass as string
      if (t && !ComponentRegistry.has(t)) warnings.push(`Component 类型 "${t}" 未注册（可能延迟注册）`)
    } else if (op === 'setBaseClass') {
      const cls = (p.baseClass ?? p.class) as string
      if (cls && !ActorRegistry.has(cls)) warnings.push(`Actor 类型 "${cls}" 未注册`)
    } else if (op === 'addChild' || op === 'updateChild') {
      const ref = (p.ref ?? (p.child as { ref?: string })?.ref) as string | undefined
      if (ref != null && !BlueprintRegistry.has(ref)) warnings.push(`子蓝图 ref="${ref}" 未注册`)
    }
  }
}
