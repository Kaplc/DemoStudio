/**
 * ConfigRegistry — 配置表系统注册中心
 *
 * 提供两种 JSON 配置形态，运行时通过已有的 readJsonFile IPC 读取
 * （与 FileSceneAssetBuilder 加载 *.scene.json 同一机制，dev 可用、支持热更新）：
 *
 *   1. 单例配置 —— 一份整体配置对象（替换各游戏硬编码的 DEFAULT_CONFIG）。
 *   2. 数据表   —— UE 风格键值行表（DataTable）。
 *
 * 同步/异步解法：
 *   - JSON 经 IPC 异步加载，但消费方（GameMode / Pawn 构造）是同步的。
 *   - registerDefaults 在启动期同步注册默认值；loadConfig 异步加载并覆盖缓存。
 *   - getConfig 同步返回：已加载缓存 → 注册默认值 → 抛错（未注册属编程错误）。
 *   - 因此 loadConfig 可 fire-and-forget；竞态下最多首帧用默认值，行为始终正确。
 *
 * 颜色等需在加载时归一化的字段，通过 transform 钩子转换（如 "#rrggbb" → 数字）。
 * 顶层以 `_` 开头的键（如 _comment）会被剔除，便于在 JSON 中写注释。
 */
import { logger } from '../Logger'
import { DataTable } from './DataTable'

/** registerGlob 入参：import.meta.glob 结果（key = 相对 asset/config/ 的路径，如 './cannon.config.json'） */
export interface ConfigGlobModules {
  configModules?: Record<string, unknown>
  tableModules?: Record<string, unknown>
}

export class ConfigRegistry {
  // 单例配置
  private static defaults = new Map<string, unknown>()
  private static configs = new Map<string, unknown>()
  private static configPaths = new Map<string, string>()
  private static configTransforms = new Map<string, ((raw: any) => unknown)>()
  // 数据表
  private static tables = new Map<string, DataTable<Record<string, unknown>>>()
  private static tablePaths = new Map<string, string>()
  private static tableTransforms = new Map<string, ((row: any, rowName: string) => unknown)>()

  // ═════════ 单例配置 ═════════

  /** 注册默认配置（同步 fallback，必须先于 getConfig 调用） */
  static registerDefaults<T>(name: string, defaults: T): void {
    this.defaults.set(name, defaults)
  }

  /**
   * 异步加载并缓存单例配置。
   * 读取 → 剔除 `_` 前缀键 → transform 归一化 → 与默认值合并（override 键整体替换）→ 缓存。
   * 读取失败时不缓存，getConfig 将回退到默认值。fire-and-forget 安全。
   */
  static async loadConfig<T>(
    name: string,
    relativePath: string,
    transform?: (raw: any) => T,
  ): Promise<T> {
    this.configPaths.set(name, relativePath)
    if (transform) this.configTransforms.set(name, transform as (raw: any) => unknown)

    const raw = await ConfigRegistry.readJson(relativePath)
    const base = (this.defaults.get(name) ?? {}) as Record<string, unknown>
    if (!raw) {
      logger.warn(`[ConfigRegistry] 配置 ${name} 使用默认值（JSON 未加载）`)
      return { ...base } as T
    }
    const cleaned = ConfigRegistry.stripMeta(raw as Record<string, any>)
    const transformed = (transform ? transform(cleaned) : cleaned) as Record<string, unknown>
    const merged = ConfigRegistry.mergeConfig(base, transformed)
    this.configs.set(name, merged)
    logger.info(`[ConfigRegistry] 配置已加载: ${name} (${relativePath})`)
    return merged as T
  }

  /** 同步获取单例配置：已加载缓存 → 注册默认值 → 抛错 */
  static getConfig<T>(name: string): T {
    const cached = this.configs.get(name)
    if (cached !== undefined) return cached as T
    const def = this.defaults.get(name)
    if (def !== undefined) return def as T
    throw new Error(`[ConfigRegistry] 配置 "${name}" 未注册（需先 registerDefaults / loadConfig）`)
  }

  // ═════════ 数据表 ═════════

  /**
   * 异步加载数据表并缓存。
   * 读取 → 剔除 `_` 前缀键 → 逐行 transform → 构造 DataTable → 缓存。
   * 读取失败时不缓存（返回 null），getTable 将返回 undefined。fire-and-forget 安全。
   */
  static async loadTable<Row>(
    name: string,
    relativePath: string,
    transform?: (row: any, rowName: string) => Row,
  ): Promise<DataTable<Row> | null> {
    this.tablePaths.set(name, relativePath)
    if (transform) this.tableTransforms.set(name, transform as (row: any, rowName: string) => unknown)

    const raw = await ConfigRegistry.readJson(relativePath)
    if (!raw) {
      logger.warn(`[ConfigRegistry] 数据表 ${name} 未加载（JSON 读取失败）`)
      return null
    }
    const cleaned = ConfigRegistry.stripMeta(raw as Record<string, any>)
    const rows: Record<string, Row> = {}
    for (const [rowName, rowRaw] of Object.entries(cleaned)) {
      rows[rowName] = (transform ? transform(rowRaw, rowName) : rowRaw) as Row
    }
    const table = new DataTable<Row>(relativePath, rows)
    this.tables.set(name, table as unknown as DataTable<Record<string, unknown>>)
    logger.info(`[ConfigRegistry] 数据表已加载: ${name} (${relativePath}, ${table.size} 行)`)
    return table
  }

  /** 同步获取数据表：未加载返回 undefined（非编程错误，消费方用 if 守卫） */
  static getTable<Row>(name: string): DataTable<Row> | undefined {
    return this.tables.get(name) as unknown as DataTable<Row> | undefined
  }

  // ═════════ 半自动注册（registerGlob：路径/name 由 glob 推导） ═════════

  /** 注册单例配置的 transform（registerGlob 自动加载时应用；须在 registerGlob 之前调用） */
  static registerConfigTransform<T>(name: string, transform: (raw: any) => T): void {
    this.configTransforms.set(name, transform as (raw: any) => unknown)
  }

  /** 注册数据表的行 transform（registerGlob 自动加载时应用；须在 registerGlob 之前调用） */
  static registerTableTransform<Row>(name: string, transform: (row: any, rowName: string) => Row): void {
    this.tableTransforms.set(name, transform as (row: any, rowName: string) => unknown)
  }

  /**
   * 批量注册 asset/config/ 下的所有配置（半自动：路径/name 由 glob key 推导，新增文件无需改代码）。
   * name 规则：`{projectName}.{文件名}`（cannon.config.json → fish.cannon）。
   * 需归一化的字段先经 registerConfigTransform / registerTableTransform 注册 transform
   * （须在本方法之前调用，加载为 fire-and-forget 异步，读取期间 transform 已就绪）。
   */
  static registerGlob(projectName: string, modules: ConfigGlobModules): void {
    let configCount = 0
    for (const key of Object.keys(modules.configModules ?? {})) {
      if (!key.endsWith('.config.json')) continue
      const rel = key.replace(/^\.\//, '')
      const name = `${projectName}.${rel.replace(/\.config\.json$/, '')}`
      const path = `src/projects/${projectName}/asset/config/${rel}`
      void this.loadConfig(name, path, this.configTransforms.get(name) as ((raw: any) => unknown) | undefined)
      configCount++
    }
    let tableCount = 0
    for (const key of Object.keys(modules.tableModules ?? {})) {
      if (!key.endsWith('.table.json')) continue
      const rel = key.replace(/^\.\//, '')
      const name = `${projectName}.${rel.replace(/\.table\.json$/, '')}`
      const path = `src/projects/${projectName}/asset/config/${rel}`
      void this.loadTable(name, path, this.tableTransforms.get(name) as ((row: any, rowName: string) => unknown) | undefined)
      tableCount++
    }
    logger.info(`[ConfigRegistry] registerGlob(${projectName}): config=${configCount}, table=${tableCount}`)
  }

  // ═════════ 热更新 / 清理 ═════════

  /** 重新从磁盘读取指定配置/表（沿用原 transform） */
  static async reload(name: string): Promise<void> {
    const cfgPath = this.configPaths.get(name)
    if (cfgPath) {
      await this.loadConfig(name, cfgPath, this.configTransforms.get(name) as any)
      return
    }
    const tblPath = this.tablePaths.get(name)
    if (tblPath) {
      await this.loadTable(name, tblPath, this.tableTransforms.get(name) as any)
      return
    }
    logger.warn(`[ConfigRegistry] reload 跳过未知名称: ${name}`)
  }

  /** 重载全部已注册的配置与表 */
  static async reloadAll(): Promise<void> {
    const names = new Set<string>([...this.configPaths.keys(), ...this.tablePaths.keys()])
    await Promise.all([...names].map((n) => this.reload(n)))
  }

  /** 清空全部缓存（测试 / 卸载用） */
  static clear(): void {
    this.defaults.clear()
    this.configs.clear()
    this.configPaths.clear()
    this.configTransforms.clear()
    this.tables.clear()
    this.tablePaths.clear()
    this.tableTransforms.clear()
  }

  // ═════════ 内部工具 ═════════

  /** 通过 Electron IPC 读取 JSON；失败返回 null（仿 FileSceneAssetBuilder） */
  private static async readJson(relativePath: string): Promise<any | null> {
    if (!window.electronAPI?.readJsonFile) {
      logger.warn(`[ConfigRegistry] electronAPI.readJsonFile 不可用，跳过: ${relativePath}`)
      return null
    }
    const result = await window.electronAPI.readJsonFile(relativePath)
    if (result.success && result.data) {
      return result.data
    }
    logger.warn(`[ConfigRegistry] 读取失败: ${relativePath} (${result.error ?? '未知错误'})`)
    return null
  }

  /** 剔除顶层以 `_` 开头的键（支持 _comment 等元字段） */
  private static stripMeta(obj: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue
      out[key] = obj[key]
    }
    return out
  }

  /**
   * 合并配置：override 中出现的键整体替换 base（含数组，不做元素级合并）；
   * override 未出现的键保留 base（默认）值。
   */
  private static mergeConfig(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base }
    for (const key of Object.keys(override)) {
      out[key] = override[key]
    }
    return out
  }
}
