/**
 * codeLint/CodeLintEngine — 代码扫描检查核心引擎（模块级单例，事件驱动）
 *
 * 无定时器，检查只在两类事件发生时触发：
 *   1. 打开/切换工程 → 对 src/projects/<currentProject.folder>/ 全量扫描一次
 *   2. 源码文件变化（主进程 fs.watch 推送 src-changed）→ 去抖后增量重扫，
 *      由"内容指纹（djb2）缓存"决定哪些文件真正变了才重新解析
 *      （未变文件复用上次 issue，跳过 createSourceFile + AST 遍历）。
 *
 * folder 直接从 store 读（useEditorStore.currentProject?.folder），不维护易 desync 的字段。
 * 单例 + globalThis 守卫：StrictMode 双挂载 / HMR 都只保留一份 store 订阅与监听。
 *
 * 结果输出：
 *   - useCodeLintStore 整体覆盖 issues（面板订阅渲染全量）
 *   - logger.error 报新增违规（自动写日志文件 + 控制台面板），带 [CodeLint] 前缀与 行:列 定位
 *   - 打开工程首扫有问题 → 自动弹出 tips 面板（同一工程后续重扫不重复弹）
 */
import * as ts from 'typescript'
import { logger } from '../../engine/Logger'
import { useEditorStore } from '../../stores/editorStore'
import { useCodeLintStore } from '../../stores/useCodeLintStore'
import { createCodeSource, type CodeSource } from './CodeSource'
import { getChecker, registeredKinds } from './CodeCheckerRegistry'
import type { CodeFileEntry, CodeIssue, CheckerContext } from './types'
// side-effect：注册所有内置代码规则检查器（engine 与 checker 集合永远同加载）
import './checkers'

const RESCHEDULE_DELAY = 300
/** 全局 store 订阅守卫键：HMR 重算模块时清掉旧单例的订阅，确保全局只有一份。 */
const GLOBAL_UNSUB_KEY = '__codeLintUnsub__'

/** 源码文本 → 稳定字符串指纹（djb2，与 assetLint 同款变更判定）。 */
function hashOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

class CodeLintEngine {
  /**
   * 惰性创建：模块加载时 window.electronAPI 可能尚未注入
   * （浏览器 Mock 在 main.tsx 内注入，晚于所有静态 import 模块求值），
   * 因此环境解析推迟到首次扫描时（用户打开工程后，API 必然已就绪）。
   */
  private source: CodeSource | null = null
  private get codeSource(): CodeSource {
    if (!this.source) this.source = createCodeSource()
    return this.source
  }
  /** path → { hash, issues }：文件级缓存（变更判定的依据）。 */
  private fileCache = new Map<string, { hash: string; issues: CodeIssue[] }>()
  /** 全局指纹集：log 级去重，只报上次没有的新 issue。 */
  private knownFingerprints = new Set<string>()
  /** 防重入：一次扫描未完成时不启动下一次。 */
  private running = false
  /** 是否已启动（幂等，防 StrictMode 重复 start）。 */
  private started = false
  /** store 订阅取消函数（工程切换感知）。 */
  private storeUnsub: (() => void) | null = null
  /** src-changed 取消订阅函数。 */
  private changeUnsub: (() => void) | null = null
  /** 当前正在监听的工程目录（null=未监听）。 */
  private watchedFolder: string | null = null
  /** 文件变化去抖定时器。 */
  private scanDebounce: ReturnType<typeof setTimeout> | null = null
  /** 已自动弹过 tips 的工程目录（同工程重扫不重复弹）。 */
  private autoShownFolder: string | null = null

  /** 直接从 store 读当前工程目录（避免多实例/订阅时序导致的 folder desync）。 */
  private get folder(): string | null {
    return useEditorStore.getState().currentProject?.folder ?? null
  }

  /**
   * 日志用工程标签：显示名 + folder（如 ClashMaster(folder=fish)）。
   * 消除"打开的是部落冲突、目录却是 src/projects/fish/"的歧义。
   */
  private projectLabel(folder: string): string {
    const p = useEditorStore.getState().currentProject
    return p && p.folder === folder ? `${p.name}(folder=${folder})` : folder
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
    this.autoShownFolder = null
    // 切换工程：清空面板与 issues（避免展示上一工程的违规）
    useCodeLintStore.getState().reset()
    if (!folder) {
      logger.info('[CodeLint] 工程切换: 无工程 → 停止扫描与监听')
      return
    }
    logger.info(`[CodeLint] 工程切换: ${this.projectLabel(folder)} → 全量扫描 src/projects/${folder}/`)
    this.startWatch(folder)
    void this.scanOnce()
  }

  /** 建立源码目录监听 + 订阅 src-changed。无 Electron 环境时静默跳过（浏览器 dev 经 Mock 枚举仍可首扫）。 */
  private startWatch(folder: string): void {
    const api = window.electronAPI
    if (!api?.watchProjectAssets || !api?.onSrcChanged) {
      logger.debug(`[CodeLint] ${this.projectLabel(folder)}: 无文件监听通道（electronAPI 缺失）→ 仅全量首扫，不做保存增量`)
      return
    }
    this.watchedFolder = folder
    // 复用 assetLint 的 watch-project-assets IPC：主进程同时监听 asset 与 src 目录
    void api.watchProjectAssets(folder)
    this.changeUnsub = api.onSrcChanged((changedFolder) => {
      // 只响应当前监听的工程（切换工程瞬间的旧通知忽略）
      if (changedFolder !== this.watchedFolder) return
      logger.debug(`[CodeLint] src-changed: ${changedFolder} → 300ms 去抖后增量重扫`)
      this.scheduleScan()
    })
    logger.info(`[CodeLint] 建立源码监听: src/projects/${folder}/（src-changed 300ms 去抖）`)
  }

  /** 停止目录监听 + 取消 src-changed 订阅。 */
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
    this.autoShownFolder = null
    this.started = false
  }

  /** 执行一次扫描（防重入）。无工程时静默跳过。 */
  async scanOnce(): Promise<void> {
    if (this.running) return
    const folder = this.folder
    if (!folder) return // 无工程：静默（已由 onProjectChanged 保证只在有工程时触发）
    this.running = true
    try {
      const files = await this.codeSource.list(folder)
      logger.info(`[CodeLint] 开始扫描 ${this.projectLabel(folder)}: ${files.length} 个源码文件`)
      const all: CodeIssue[] = []

      for (const f of files) {
        const text = 'text' in f ? f.text : ''
        const hash = 'text' in f ? hashOf(f.text) : '<unreadable>'
        // 内容指纹未变 → 复用上次 issue，跳过 AST 解析（"指纹变了才检查"）
        const cached = this.fileCache.get(f.path)
        if (cached && cached.hash === hash) {
          all.push(...cached.issues)
          continue
        }
        // 变化 / 新增 / 读取失败 → 重新校验
        const issues = 'text' in f ? this.validateFile(f) : [this.readError(f)]
        this.fileCache.set(f.path, { hash, issues })
        all.push(...issues)
      }

      this.pruneDeleted(files)
      this.publish(folder, files.length, all)
    } catch (err) {
      logger.warn(`[CodeLint] 扫描异常: ${errMsg(err)}`)
    } finally {
      this.running = false
    }
  }

  /** 校验单个源码文件：createSourceFile（轻量语法树）→ 逐规则 check。 */
  private validateFile(f: CodeFileEntry & { text: string }): CodeIssue[] {
    const issues: CodeIssue[] = []
    try {
      const scriptKind = /\.tsx$/i.test(f.path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      // 不建 Program、不做 typecheck；fileName 用相对路径（报告定位用）
      const sourceFile = ts.createSourceFile(
        f.path,
        f.text,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        scriptKind,
      )
      const ctx: CheckerContext = { projectFolder: this.folder ?? '' }
      for (const kind of registeredKinds()) {
        const checker = getChecker(kind)
        if (!checker) continue
        issues.push(...checker.check(sourceFile, ctx))
      }
    } catch (err) {
      // 解析异常：记 warn 并产出一条 parse issue，不中断全扫
      logger.warn(`[CodeLint] ${f.path} 解析失败: ${errMsg(err)}`)
      issues.push({ file: f.path, line: 1, col: 1, message: `解析失败: ${errMsg(err)}`, rule: 'parse' })
    }
    return issues
  }

  /** 读取失败 → 单条 read issue（不中断全扫）。 */
  private readError(f: CodeFileEntry & { error: string }): CodeIssue {
    return { file: f.path, line: 1, col: 1, message: `读取失败: ${f.error}`, rule: 'read' }
  }

  /** 删除的文件：从缓存移除（其 issue 自然不再出现在下次 all 中）。 */
  private pruneDeleted(files: CodeFileEntry[]): void {
    const live = new Set(files.map((f) => f.path))
    for (const key of [...this.fileCache.keys()]) {
      if (!live.has(key)) this.fileCache.delete(key)
    }
  }

  /** 发布扫描结果：store 整体覆盖 + log 级增量上报 + 首扫自动弹 tips。 */
  private publish(folder: string, fileCount: number, all: CodeIssue[]): void {
    const store = useCodeLintStore.getState()
    // 面板数据：整体覆盖（面板渲染全量，不受 log 去重影响）
    store.setIssues(all)

    // log 级增量：只报新指纹
    const fps = all.map((i) => `${i.file}::${i.line}::${i.col}::${i.rule}::${i.message}`)
    const fresh: CodeIssue[] = []
    for (let i = 0; i < all.length; i++) {
      if (!this.knownFingerprints.has(fps[i])) fresh.push(all[i])
    }
    this.knownFingerprints = new Set(fps)

    for (const i of fresh) {
      // 直接以 logger 实例调用，避免摘取方法引用导致 this 丢失
      logger.error(`[CodeLint] ${i.file}:${i.line}:${i.col} ${i.message}`)
    }

    if (fresh.length === 0) {
      logger.debug(`[CodeLint] 扫描完成 ${this.projectLabel(folder)}: ${fileCount} 文件，无新问题`)
    } else {
      logger.info(
        `[CodeLint] 扫描完成 ${this.projectLabel(folder)}: ${fileCount} 文件，${fresh.length} 个新问题（共 ${all.length}）`,
      )
    }

    // 打开工程首扫且有问题 → 自动弹出 tips；同一工程后续重扫不重复弹（手动收起后不打扰）
    if (all.length > 0 && this.autoShownFolder !== folder) {
      this.autoShownFolder = folder
      store.setPanelOpen(true)
    }
  }
}

/** 模块级单例：全局唯一引擎，避免多 Editor 实例导致重复订阅与 folder desync。 */
export const codeLintEngine = new CodeLintEngine()
export type { CodeLintEngine }
