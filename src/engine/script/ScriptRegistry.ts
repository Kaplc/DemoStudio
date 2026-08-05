/**
 * ScriptRegistry — 行为脚本（BehaviourScript）注册中心
 *
 * 管理「脚本 id → 构造器」映射，供 UIScriptComponent 在 BeginPlay 时按资产里
 * 声明的 `script` id 实例化脚本。对标 ActorRegistry / ComponentRegistry 的工厂模式。
 *
 * 注册方式（数据驱动，复刻 AssetRegistry）：
 *   项目 asset/index.ts 用 import.meta.glob({ eager: true }) 扫描所有 `.script.ts`，
 *   传入 AssetRegistry.registerAll({ scriptModules })，由 registerAll 调本注册中心。
 *   id 由文件路径自动推导（globKeyToScriptId），脚本文件无需手写 register。
 *
 * id 约定（globKeyToScriptId）：
 *   '../gameplay/base/BaseHud.script.ts' → 'gameplay/base/BaseHud'
 *   （去掉 `../` 前缀与 `.script.ts` 后缀，路径式、可读、跨脚本不冲突）
 */
import type { BehaviourScript } from './BehaviourScript'
import { logger } from '../Logger'

/** BehaviourScript 子类构造器（无参构造） */
export type BehaviourScriptConstructor = new () => BehaviourScript

/** import.meta.glob eager 结果：key = 相对 glob 路径，value = 模块（默认导出为脚本类） */
export type ScriptModules = Record<string, { default: BehaviourScriptConstructor }>

/**
 * 将 import.meta.glob 的 key 转为脚本 id：
 * '../gameplay/base/BaseHud.script.ts' → 'gameplay/base/BaseHud'
 */
function globKeyToScriptId(key: string): string {
  return key
    .replace(/^\.\.\//, '')   // 去掉 '../' 前缀
    .replace(/\.script\.ts$/, '') // 去掉 '.script.ts' 后缀
}

export class ScriptRegistry {
  private static entries = new Map<string, BehaviourScriptConstructor>()

  /** 注册一个脚本类型 */
  static register(id: string, ctor: BehaviourScriptConstructor): void {
    ScriptRegistry.entries.set(id, ctor)
  }

  /** 创建一个脚本实例，未注册返回 null */
  static create(id: string): BehaviourScript | null {
    const ctor = ScriptRegistry.entries.get(id)
    if (!ctor) return null
    return new ctor()
  }

  /** 检查是否已注册 */
  static has(id: string): boolean {
    return ScriptRegistry.entries.has(id)
  }

  /** 获取所有已注册的脚本 id（错误提示 / 调试用） */
  static getRegisteredIds(): string[] {
    return [...ScriptRegistry.entries.keys()]
  }

  /** 清空所有已注册的脚本（切换工程时调用） */
  static clearAll(): void {
    ScriptRegistry.entries.clear()
  }

  /**
   * 批量注册：接收 import.meta.glob 的 eager 结果，按文件路径推导 id 注册。
   * 由 AssetRegistry.registerAll 统一调用。
   */
  static registerAll(scriptModules: ScriptModules): void {
    for (const [key, mod] of Object.entries(scriptModules)) {
      const id = globKeyToScriptId(key)
      const ctor = mod?.default
      if (!ctor) {
        logger.warn(`[ScriptRegistry] 脚本模块 ${key} 缺少默认导出，已跳过`)
        continue
      }
      ScriptRegistry.register(id, ctor)
      logger.debug(`[ScriptRegistry] 注册脚本: ${id} (来自 ${key})`)
    }
  }
}
