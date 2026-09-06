/**
 * Hoi4ConfigLoader — 配置表加载类
 *
 * 继承 ConfigLoaderBase（engine 注册器基类），注册 asset/config/ 全部配置表：
 *   countries / terrains / buildings / laws / equipments / battalion_types /
 *   support_types / division_templates / techs / focuses / events /
 *   combat_params / ai_weights
 *
 * 全部走 glob 异步加载（无代码默认值）；core 消费方用 if 守卫，
 * Hoi4GameMode 在表未就绪时不启动 tick（加载完成后自动开闸）。
 */
import { ConfigLoaderBase, logger } from '@/engine'
import { configGlob } from './asset/config'

export class Hoi4ConfigLoader extends ConfigLoaderBase {
  constructor(log: (message: string) => void = (m) => logger.info(m)) {
    super('hoi4', log)
  }

  override init(): void {
    // 本项目全部为纯数据表，无代码默认值、无 transform——直接注册 glob 即可。
    // 注册名规则：hoi4.<文件名去扩展>（ConfigLoaderBase 实现）。
    // 外部工程根：显式传 projects/ 前缀（内置轨默认 src/projects/，见 ConfigRegistry.registerGlob）。
    this.registerGlob(configGlob.configModules, configGlob.tableModules, 'projects/hoi4/asset/config')
    this.log('[Hoi4/Config] 配置表已注册（13 张）')
  }
}
