/**
 * assetLint/AssetLintEngine — 资产检查核心引擎（模块级单例，事件驱动）
 *
 * 无定时器，检查只在两类事件发生时触发：
 *   1. 打开/切换工程 → 全量扫描一次（建立监听 + 首扫）
 *   2. asset 目录下文件变化（主进程 fs.watch 通知）→ 去抖后重扫，
 *      由"内容指纹（md5 等价）缓存"决定哪些文件真正变了才重新校验
 *      （未变文件复用上次 issue，跳过 walk+schema）。
 *
 * folder 直接从 store 读（useEditorStore.currentProject?.folder），不维护易 desync 的字段。
 * 单例 + globalThis 守卫：StrictMode 双挂载 / HMR 都只保留一份 store 订阅与监听。
 *
 * 违规经 logger.warn/error 输出（自动写日志文件 + 控制台面板），带 [AssetLint] 前缀与节点定位。
 */
import { logger } from '../../../engine/Logger'
import { useEditorStore } from '../../../stores/editorStore'
import { useCodeLintStore, type AssetIssueView } from '../../../stores/useCodeLintStore'
import { createAssetSource, type AssetSource } from './AssetSource'
import { walkDocument } from './AssetWalker'
import { getChecker } from './AssetCheckerRegistry'
import type { AssetFile, LintIssue, CheckerContext } from './types'

const RESCHEDULE_DELAY = 300
/** 全局 store 订阅守卫键：HMR 重算模块时清掉旧单例的订阅，确保全局只有一份。 */
const GLOBAL_UNSUB_KEY = '__assetLintUnsub__'

/** parsed JSON → 稳定字符串指纹（同文件重读 stringify 结果一致；md5 等价的变更判定）。 */
function hashOf(doc: unknown): string {
  try {
    const s = JSON.stringify(doc)
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return `h${(h >>> 0).toString(36)}`
  } catch {
    return 'unhashable'
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

class AssetLintEngine {
  private source: AssetSource = createAssetSource()
  /** path → { hash, issues }：文件级缓存（变更判定的依据）。 */
  private fileCache = new Map<string, { hash: string; issues: LintIssue[] }>()
  /** 全局指纹集：log 级去重，只报上次没有的新 issue。 */
  private knownFingerprints = new Set<string>()
  /** 防重入：一次扫描未完成时不启动下一次。 */
  private running = false
  /** 是否已启动（幂等，防 StrictMode 重复 start）。 */
  private started = false
  /** store 订阅取消函数（工程切换感知）。 */
  private storeUnsub: (() => void) | null = null
  /** asset-changed 取消订阅函数。 */
  private changeUnsub: (() => void) | null = null
  /** 当前正在监听的工程目录（null=未监听）。 */
  private watchedFolder: string | null = null
  /** 文件变化去抖定时器。 */
  private scanDebounce: ReturnType<typeof setTimeout> | null = null

  /** 直接从 store 读当前工程目录（避免多实例/订阅时序导致的 folder desync）。 */
  private get folder(): string | null {
    return useEditorStore.getState().currentProject?.folder ?? null
  }

  /** 清缓存（手动触发全量重扫时用）。 */
  clearCache(): void {
    this.fileCache.clear()
    this.knownFingerprints.clear()
  }

  /** 启动：订阅工程切换并对当前工程建立监听 + 首扫。幂等 + 全局守卫。 */
  start(): void {
    if (this.started) return // 本实例已启动，幂等（StrictMode 重复 start 直接返回）
    this.started = true

    const g = globalThis as Record<string, unknown>
    // 清掉 HMR 旧单例遗留的 store 订阅（仅本实例首次启动时）
    if (g[GLOBAL_UNSUB_KEY]) {
      ;(g[GLOBAL_UNSUB_KEY] as () => void)()
    }

    this.storeUnsub = useEditorStore.subscribe((state, prev) => {
      const cur = state.currentProject?.folder ?? null
      const old = prev.currentProject?.folder ?? null
      if (cur !== old) this.onProjectChanged(cur)
    })
    g[GLOBAL_UNSUB_KEY] = this.storeUnsub

    // 对当前工程（若有）立即建立监听 + 首扫
    this.onProjectChanged(useEditorStore.getState().currentProject?.folder ?? null)
  }

  /** 工程切换：停旧监听 → 清面板旧数据 → 新工程建立监听 + 全量扫描。 */
  private onProjectChanged(folder: string | null): void {
    this.stopWatch()
    // 切换工程：清空面板资产问题（避免展示上一工程的违规）
    useCodeLintStore.getState().setAssetIssues([])
    // 无有效工程：停止扫描与监听（防御：空字符串也视为无效）
    if (!folder) {
      logger.info('[AssetLint] 工程切换: 无工程 → 停止扫描与监听')
      return
    }
    this.startWatch(folder)
    void this.scanOnce()
  }

  /** 建立目录监听 + 订阅 asset-changed。无 Electron 环境时静默跳过（降级）。 */
  private startWatch(folder: string): void {
    const api = window.electronAPI
    if (!api?.watchProjectAssets || !api?.onAssetChanged) return
    this.watchedFolder = folder
    void api.watchProjectAssets(folder)
    this.changeUnsub = api.onAssetChanged((changedFolder) => {
      // 只响应当前监听的工程（切换工程瞬间的旧通知忽略）
      if (changedFolder !== this.watchedFolder) return
      this.scheduleScan()
    })
  }

  /** 停止目录监听 + 取消 asset-changed 订阅。 */
  private stopWatch(): void {
    if (this.changeUnsub) {
      this.changeUnsub()
      this.changeUnsub = null
    }
    if (this.watchedFolder) {
      void window.electronAPI?.stopWatchProjectAssets?.()
      this.watchedFolder = null
    }
  }

  /** 去抖触发一次扫描（文件变化时用，合并短时间内的多次保存事件）。 */
  scheduleScan(delay = RESCHEDULE_DELAY): void {
    if (this.scanDebounce) clearTimeout(this.scanDebounce)
    this.scanDebounce = setTimeout(() => void this.scanOnce(), delay)
  }

  stop(): void {
    this.stopWatch()
    if (this.scanDebounce) {
      clearTimeout(this.scanDebounce)
      this.scanDebounce = null
    }
  }

  destroy(): void {
    this.stop()
    if (this.storeUnsub) {
      this.storeUnsub()
      this.storeUnsub = null
    }
    const g = globalThis as Record<string, unknown>
    if (g[GLOBAL_UNSUB_KEY]) g[GLOBAL_UNSUB_KEY] = null
    this.fileCache.clear()
    this.knownFingerprints.clear()
    this.started = false
  }

  /** 执行一次扫描（防重入）。无工程时静默跳过。 */
  async scanOnce(): Promise<void> {
    await this.scanInternal()
  }

  /**
   * 手动触发全量扫描（MCP run_asset_lint 用）：绕过内容指纹缓存全量重扫，返回全部违规。
   * folderOverride 指定目标工程目录（MCP project 参数）；缺省扫描当前打开工程。
   * 扫描非当前打开工程时结果只经返回值输出，不写 store 面板（面板跟随当前打开工程）。
   */
  async runNow(folderOverride?: string): Promise<LintIssue[]> {
    this.clearCache()
    return this.scanInternal(folderOverride)
  }

  /** 扫描实现（scanOnce / runNow 共用）。无工程（且无 override）时返回空数组。 */
  private async scanInternal(folderOverride?: string): Promise<LintIssue[]> {
    if (this.running) return []
    const folder = folderOverride ?? this.folder
    if (!folder) return [] // 无工程：静默（已由 onProjectChanged 保证只在有工程时触发）
    this.running = true
    try {
      const files = await this.source.list(folder)
      const all: LintIssue[] = []

      for (const f of files) {
        const hash = f.ok ? hashOf(f.doc) : '<unparseable>'
        // 内容指纹未变 → 复用上次 issue，跳过 walk+schema（"md5 变了才检查"）
        const cached = this.fileCache.get(f.path)
        if (cached && cached.hash === hash) {
          all.push(...cached.issues)
          continue
        }
        // 变化 / 新增 / 解析失败 → 重新校验
        const issues = f.ok ? this.validateDoc(f) : [this.parseError(f)]
        this.fileCache.set(f.path, { hash, issues })
        all.push(...issues)
      }

      this.pruneDeleted(files)
      // 旁路扫描（非当前打开工程）：结果只经返回值输出，不覆盖面板（面板跟随当前打开工程）
      if (!folderOverride || folderOverride === this.folder) {
        this.reportNew(folder, files.length, all)
      } else {
        logger.info(`[AssetLint] 旁路扫描完成 ${folder}: ${files.length} 文件，共 ${all.length} 个问题（不更新面板）`)
      }
      return all
    } catch (err) {
      logger.warn(`[AssetLint] 扫描异常: ${errMsg(err)}`)
      return []
    } finally {
      this.running = false
    }
  }

  /** 校验单个文档：walk → 派发 → checker.run。 */
  private validateDoc(f: AssetFile): LintIssue[] {
    const issues: LintIssue[] = []
    const { rootKind, tasks } = walkDocument(f.doc)

    if (!rootKind) {
      issues.push(
        this.makeIssue(f.path, '<根>', '-', 'unknown-doc', 'warn', '无法识别文档根（既非 scene 也非 blueprint）'),
      )
      return issues
    }

    for (const t of tasks) {
      const checker = getChecker(t.kind)
      if (!checker) {
        issues.push(
          this.makeIssue(
            f.path,
            t.nodePath,
            '-',
            'unknown-kind',
            'error',
            `未注册的检查器 '${t.kind}'（旧格式或未知节点类型，仅允许 node:actor / node:ref）`,
          ),
        )
        continue
      }
      const ctx = this.makeContext(f.path, t.nodePath)
      issues.push(...checker.run(t.node, ctx))
    }

    // widget 资产（UI 蓝图）：额外跑游戏 UI 设计级检查（字号/触控/阴影/zOrder，全部 warn）
    if (f.path.endsWith('.widget.json')) {
      const designChecker = getChecker('doc:ui-design')
      if (designChecker) {
        issues.push(...designChecker.run(f.doc, this.makeContext(f.path, '<widget 根>')))
      }
    }
    return issues
  }

  /** 解析失败 → error（AI 资产最该高亮；仅 ElectronAssetSource 真磁盘扫描能抓到）。 */
  private parseError(f: AssetFile): LintIssue {
    return this.makeIssue(f.path, '<根>', '-', 'parse', 'error', `JSON 解析失败: ${f.error ?? '未知错误'}`)
  }

  /** 删除的文件：从缓存移除（其 issue 自然不再出现在下次 all 中）。 */
  private pruneDeleted(files: AssetFile[]): void {
    const live = new Set(files.map((f) => f.path))
    for (const key of [...this.fileCache.keys()]) {
      if (!live.has(key)) this.fileCache.delete(key)
    }
  }

  /** log 级增量 + store 全量发布：只报新指纹，无新增走 debug 静默。 */
  private reportNew(folder: string, fileCount: number, all: LintIssue[]): void {
    // 面板数据：整体覆盖（面板渲染全量，不受 log 去重影响），与 CodeLintEngine 共用 store
    useCodeLintStore.getState().setAssetIssues(all.map(toAssetIssueView))

    const fps = all.map((i) => `${i.filePath}::${i.nodePath}::${i.field}::${i.ruleId}`)
    const fresh: LintIssue[] = []
    for (let i = 0; i < all.length; i++) {
      if (!this.knownFingerprints.has(fps[i])) fresh.push(all[i])
    }
    this.knownFingerprints = new Set(fps)

    for (const i of fresh) {
      const line = `[AssetLint] ${i.filePath} > ${i.nodePath} [${i.field}] ${i.message} (${i.ruleId})`
      // 直接以 logger 实例调用，避免摘取方法引用导致 this 丢失（this.write 报错）
      if (i.severity === 'error') logger.error(line)
      else logger.warn(line)
    }

    if (fresh.length === 0) {
      logger.debug(`[AssetLint] 扫描完成 ${folder}: ${fileCount} 文件，无新问题`)
      return
    }
    logger.info(
      `[AssetLint] 扫描完成 ${folder}: ${fileCount} 文件，${fresh.length} 个新问题（共 ${all.length}）`,
    )
  }

  private makeContext(filePath: string, nodePath: string): CheckerContext {
    return {
      filePath,
      nodePath,
      issue: (field, ruleId, message, severity = 'warn', value) =>
        this.makeIssue(filePath, nodePath, field, ruleId, severity, message, value),
    }
  }

  private makeIssue(
    filePath: string,
    nodePath: string,
    field: string,
    ruleId: string,
    severity: 'error' | 'warn',
    message: string,
    value?: unknown,
  ): LintIssue {
    return { filePath, nodePath, field, ruleId, severity, message, value }
  }
}

/** LintIssue → 面板视图（AssetIssueView，与 CodeIssue 同构扁平结构） */
function toAssetIssueView(i: LintIssue): AssetIssueView {
  return {
    file: i.filePath,
    nodePath: i.nodePath,
    field: i.field,
    rule: i.ruleId,
    severity: i.severity,
    message: i.message,
  }
}

/** 模块级单例：全局唯一引擎，避免多 Editor 实例导致重复订阅与 folder desync。 */
export const assetLintEngine = new AssetLintEngine()
export type { AssetLintEngine }
