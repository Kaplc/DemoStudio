/**
 * WarmCurrentConfigLoader — 配置表加载类（hoi4 同款）
 *
 * 注册 asset/config/ 全部 7 张配置（global/stars/node_burn/station/events/star_map/cards）。
 * 数值默认值在代码 B（balance.ts）中兜底：表未加载完时 refreshBalanceFromConfigs
 * 静默保留默认值（值与表一致，竞态无害）；GameInstance 在表就绪后补一次 refresh。
 */
import { ConfigLoaderBase, logger } from '@/engine'
import { configGlob } from './asset/config'

export class WarmCurrentConfigLoader extends ConfigLoaderBase {
  constructor(log: (message: string) => void = (m) => logger.info(m)) {
    super('warm-current', log)
  }

  override init(): void {
    // 纯数据表：无 transform（B 侧消费时自行按已知键挑选），直接注册 glob。
    // 注册名规则：warm-current.<文件名去扩展>（ConfigLoaderBase 实现）。
    // 外部工程根：显式传 projects/ 前缀（内置轨默认 src/projects/）。
    this.registerGlob(configGlob.configModules, configGlob.tableModules, 'projects/warm-current/asset/config')
    this.log('[WarmCurrent/Config] 配置表已注册（7 张）')
  }
}

/** initWarmCurrentConfigs — 便捷入口（register.ts initConfigs 用） */
export function initWarmCurrentConfigs(log?: (message: string) => void): void {
  new WarmCurrentConfigLoader(log).init()
}
