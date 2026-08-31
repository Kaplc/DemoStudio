/**
 * FishConfigLoader — ClashMaster 配置表加载类
 *
 * 继承 ConfigLoaderBase（engine 注册器基类），由 FishGameInstance 构造时实例化并调用 init()，
 * 统一注册默认值 + 自动注册 asset/config/ 下所有配置表（兵种/炮台/鱼种/鱼群节奏）。
 *
 * 半自动注册：
 *   - 默认值（DEFAULT_*_CONFIG）与 transform 钩子仍需手动注册（依赖代码常量/归一化逻辑）
 *   - 文件路径与配置名由 asset/config/index.ts 的 glob 自动推导，新增配置文件无需改本文件
 */
import { ConfigLoaderBase } from '@/engine'
import type { TroopType, LevelType } from './gameplay/common/types'
import {
  DEFAULT_CANNON_CONFIG,
  DEFAULT_BOSS_CONFIG,
  DEFAULT_FISH_CONFIG,
  DEFAULT_SCHOOL_CONFIG,
} from './gameplay/common/types'
import type { BuildingLevelsConfig } from './gameplay/base/ProductionService'
import { configGlob } from './asset/config'

export class FishConfigLoader extends ConfigLoaderBase {
  constructor(log: (message: string) => void = (m) => console.info(m)) {
    super('fish', log)
  }

  override init(): void {
    // ─── 默认值（同步 fallback，依赖代码常量，仍手动注册） ───
    this.registerDefaults('fish.cannon', DEFAULT_CANNON_CONFIG)
    this.registerDefaults('fish.boss', DEFAULT_BOSS_CONFIG)
    this.registerDefaults('fish.fish', DEFAULT_FISH_CONFIG)
    this.registerDefaults('fish.school', DEFAULT_SCHOOL_CONFIG)
    // 建筑等级表走 glob 异步加载且无代码默认值；注册空对象兜底，
    // 使 GameInstance 构造期 _wireServices 的 getConfig 不抛错（加载完成后 tick 首帧补注入真实表）
    this.registerDefaults('fish.buildingLevels', {})

    // ─── 归一化 transform（须在 registerGlob 之前注册，加载时自动应用） ───
    // 兵种 DataTable（部落冲突风格行表）：键=兵种 id，值=兵种属性；无默认值表
    // （未加载时 getTable 返回 undefined，消费方用 if 守卫）
    this.registerTableTransform<TroopType>('fish.troop', (row, rowName): TroopType => {
      // blueprint 缺失 → 按行键回退默认路径并告警（严格模式：战斗放兵会再校验蓝图可解析）
      if (!row.blueprint) {
        this.log(`[Config] 兵种 "${rowName}" 缺 blueprint 字段，回退默认路径 asset/blueprints/troops/${rowName}.blueprint.json`)
      }
      return {
        ...row,
        // "#rrggbb" → 数字颜色
        color: parseInt((row.color as string).replace('#', ''), 16),
        size: [...(row.size as [number, number, number])],
        blueprint: (row.blueprint as string) || `asset/blueprints/troops/${rowName}.blueprint.json`,
      }
    })

    // 关卡 DataTable（地图面板按表生成关卡节点）：无默认值表（未加载时 getTable 返回 undefined）
    this.registerTableTransform<LevelType>('fish.levels', (row): LevelType => ({
      ...row,
      // pos 数组归一化拷贝（防止 JSON 引用共享）
      pos: [...(row.pos as [number, number])],
    }))

    // 建筑等级表（单例配置，ProductionService 消费）：glob 自动注册为 fish.buildingLevels
    this.registerConfigTransform<BuildingLevelsConfig>('fish.buildingLevels', (cfg) => {
      console.info(`[Config] 建筑等级表已加载（${Object.keys(cfg ?? {}).length} 种建筑）`)
      return cfg
    })

    // 法术 DataTable：color "#rrggbb" → 数字（SpellCaster 光环渲染用）
    this.registerTableTransform<import('./gameplay/common/types').SpellType>('fish.spell', (row) => ({
      ...row,
      color: parseInt((row.color as string).replace('#', ''), 16),
    }))

    // ─── 自动注册 asset/config/ 下所有配置文件（路径/name 由 glob 推导） ───
    this.registerGlob(configGlob.configModules, configGlob.tableModules)

    this.log('[Config] ClashMaster 配置表已注册')
  }
}
