/**
 * ConfigLoaderBase — 项目配置加载器基类（注册器基类）
 *
 * 每个游戏项目在项目根目录建一个配置构造类继承本基类（如 FishConfigLoader、
 * EatFishConfigLoader），统一"注册默认值 + 异步加载配置表"的流程。
 * 由 GameInstance 构造时实例化并调用 init()（各阶段 GameMode 共享同一份配置缓存）。
 *
 * 用法：
 *   class FishConfigLoader extends ConfigLoaderBase {
 *     constructor(log = defaultLog) { super('fish', log) }
 *     override init(): void {
 *       this.registerDefaults('fish.cannon', DEFAULT_CANNON_CONFIG)
 *       this.loadConfig<CannonConfig>('fish.cannon', 'src/projects/fish/asset/config/cannon.config.json')
 *       this.loadTable<TroopType>('fish.troop', 'src/projects/fish/asset/config/troop.table.json', transform)
 *       this.log('[Config] FishMaster 配置表已注册')
 *     }
 *   }
 *
 * 同步/异步解法（继承自 ConfigRegistry）：
 *   - registerDefaults 同步注册 fallback；loadConfig/loadTable 异步加载并覆盖缓存（fire-and-forget）。
 *   - 竞态下最多首帧用默认值，行为始终正确。
 *   - 消费方用 getConfig（已注册必返回）/ getTable（未加载返回 undefined，用 if 守卫）同步读取。
 */
import { logger } from '../Logger'
import { ConfigRegistry } from './ConfigRegistry'
import { DataTable } from './DataTable'

/** 默认日志回调（走引擎 logger） */
function defaultLog(message: string): void {
  logger.info(message)
}

export abstract class ConfigLoaderBase {
  /** 项目名（日志/配置名前缀用） */
  readonly projectName: string
  /** 日志回调（默认走引擎 logger） */
  protected log: (message: string) => void

  constructor(projectName: string, log: (message: string) => void = defaultLog) {
    this.projectName = projectName
    this.log = log
  }

  /**
   * 子类实现：注册默认值 + 异步加载所有配置表。
   * 由 GameInstance 构造时调用一次（各阶段 GameMode 共享缓存）。
   */
  abstract init(): void

  // ═════════ 注册（子类在 init 中调用） ═════════

  /** 注册默认配置（同步 fallback，须先于 getConfig 调用） */
  protected registerDefaults<T>(name: string, defaults: T): void {
    ConfigRegistry.registerDefaults(name, defaults)
  }

  /** 异步加载并缓存单例配置（fire-and-forget；读取失败回退默认值） */
  protected loadConfig<T>(
    name: string,
    relativePath: string,
    transform?: (raw: any) => T,
  ): void {
    void ConfigRegistry.loadConfig<T>(name, relativePath, transform)
  }

  /** 异步加载并缓存数据表（fire-and-forget；读取失败 getTable 返回 undefined） */
  protected loadTable<Row>(
    name: string,
    relativePath: string,
    transform?: (row: any, rowName: string) => Row,
  ): void {
    void ConfigRegistry.loadTable<Row>(name, relativePath, transform)
  }

  // ═════════ 半自动注册（路径/name 由 glob 推导，新增配置文件无需改代码） ═════════

  /** 注册单例配置的归一化 transform（须在 registerGlob 之前调用） */
  protected registerConfigTransform<T>(name: string, transform: (raw: any) => T): void {
    ConfigRegistry.registerConfigTransform(name, transform)
  }

  /** 注册数据表的行 transform（须在 registerGlob 之前调用） */
  protected registerTableTransform<Row>(name: string, transform: (row: any, rowName: string) => Row): void {
    ConfigRegistry.registerTableTransform(name, transform)
  }

  /**
   * 批量注册 asset/config/ 下所有配置（glob 结果由 asset/config/index.ts 提供）。
   * name 推导：`{projectName}.{文件名}`（cannon.config.json → fish.cannon）。
   */
  protected registerGlob(
    configModules?: Record<string, unknown>,
    tableModules?: Record<string, unknown>,
  ): void {
    ConfigRegistry.registerGlob(this.projectName, { configModules, tableModules })
  }

  // ═════════ 同步读取（消费方调用） ═════════

  /** 同步获取单例配置：已加载缓存 → 注册默认值 → 抛错（未注册属编程错误） */
  protected getConfig<T>(name: string): T {
    return ConfigRegistry.getConfig<T>(name)
  }

  /** 同步获取数据表：未加载返回 undefined（非编程错误，消费方用 if 守卫） */
  protected getTable<Row>(name: string): DataTable<Row> | undefined {
    return ConfigRegistry.getTable<Row>(name)
  }
}
