/**
 * GMRegistry — GM 命令静态注册表（对标 ScriptRegistry 风格）
 *
 * 管理「命令 id → 命令定义」映射。注册方式（数据驱动）：
 *   项目 register.ts 用 import.meta.glob({ eager: true }) 扫描 `*.gm.ts`，
 *   传入 GMRegistry.registerProjectGlob(modules)，id 由文件路径自动推导，
 *   命令文件无需手写 register。
 *
 * id 约定（globKeyToGMId）：
 *   './gameplay/gm/addCoins.gm.ts' → 'gameplay/gm/addCoins'
 *   （去掉 `./` 前缀与 `.gm.ts` 后缀，路径式、可读、跨项目不冲突——项目命令
 *   glob 从项目目录出发，id 天然带项目内路径前缀，不同项目命令互不覆盖）
 *
 * 注册幂等：同一 id 重复注册时覆盖旧定义并 logger.warn（HMR 重载不产生重复条目）。
 */
import { logger } from '../Logger'
import type { GMCommandDef } from './GMCommand'

/** import.meta.glob eager 结果：key = 相对 glob 路径，value = 模块（默认导出为命令定义） */
export type GMCommandModules = Record<string, { default?: GMCommandDef }>

/**
 * 将 import.meta.glob 的 key 转为命令 id：
 * './gameplay/gm/addCoins.gm.ts' → 'gameplay/gm/addCoins'
 */
function globKeyToGMId(key: string): string {
  return key
    .replace(/^\.\//, '')   // 去掉 './' 前缀
    .replace(/\.gm\.ts$/, '') // 去掉 '.gm.ts' 后缀
}

export class GMRegistry {
  private static entries = new Map<string, GMCommandDef>()

  /** 注册一个命令定义（同 id 覆盖并 warn） */
  static register(id: string, def: GMCommandDef): void {
    const old = GMRegistry.entries.get(id)
    GMRegistry.entries.set(id, def)
    if (old) {
      logger.warn(`[GMRegistry] 命令 "${id}" 重复注册，已覆盖（旧 name=${old.name} → 新 name=${def.name}）`)
    } else {
      logger.debug(`[GMRegistry] 注册命令: ${id} (name=${def.name})`)
    }
  }

  /** 检查命令是否已注册 */
  static has(id: string): boolean {
    return GMRegistry.entries.has(id)
  }

  /** 按 id 查命令定义 */
  static get(id: string): GMCommandDef | null {
    return GMRegistry.entries.get(id) ?? null
  }

  /** 全部已注册命令（[id, def] 列表，按注册顺序） */
  static getAll(): Array<[string, GMCommandDef]> {
    return [...GMRegistry.entries.entries()]
  }

  /** 按调用名 name 查命令（调用名重名时返回第一个，重名在注册时已 warn） */
  static findByName(name: string): GMCommandDef | null {
    for (const def of GMRegistry.entries.values()) {
      if (def.name === name) return def
    }
    return null
  }

  /** 清空所有已注册命令（切换工程时调用；项目命令集常驻注册，实际由调用方决定时机） */
  static clearAll(): void {
    GMRegistry.entries.clear()
    logger.info('[GMRegistry] 已清空全部 GM 命令')
  }

  /**
   * 批量注册项目命令：接收 import.meta.glob 的 eager 结果，按文件路径推导 id。
   * 项目 register.ts 中调用（与 ScriptRegistry.registerAll 同风格，幂等）。
   */
  static registerProjectGlob(modules: GMCommandModules): void {
    let count = 0
    for (const [key, mod] of Object.entries(modules)) {
      const def = mod?.default
      if (!def || typeof def !== 'object' || typeof def.handler !== 'function') {
        logger.warn(`[GMRegistry] 命令模块 ${key} 缺少默认导出命令定义，已跳过`)
        continue
      }
      if (!def.name || !def.description) {
        logger.warn(`[GMRegistry] 命令模块 ${key} 缺 name/description，已跳过`)
        continue
      }
      const id = globKeyToGMId(key)
      GMRegistry.register(id, def)
      count++
    }
    logger.info(`[GMRegistry] 项目命令批量注册: ${count} 个（当前共 ${GMRegistry.entries.size} 个）`)
  }
}
