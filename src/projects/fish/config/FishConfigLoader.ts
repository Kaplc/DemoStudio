/**
 * FishConfigLoader — FishMaster 配置表加载模块
 *
 * 由 EditorInitializer 调用，负责注册默认值并异步加载 FishMaster 的所有配置表。
 * 将配置加载逻辑从编辑器初始化中分离到具体项目，每个实例/项目管理自己的配置。
 */
import { ConfigRegistry } from '@/engine'
import type { CannonConfig, BossConfig, FishConfig, SchoolConfig, TroopType } from '../gameplay/common/types'
import {
  DEFAULT_CANNON_CONFIG,
  DEFAULT_BOSS_CONFIG,
  DEFAULT_FISH_CONFIG,
  DEFAULT_SCHOOL_CONFIG,
} from '../gameplay/common/types'

/**
 * 初始化 FishMaster 的所有配置表
 * - 注册默认值（同步 fallback）
 * - 异步加载 JSON 覆盖（fire-and-forget，首帧使用默认值）
 * @param log 日志输出回调
 */
export function initFishConfigs(log: (message: string) => void = console.log): void {
  // ─── 炮台配置 ───
  ConfigRegistry.registerDefaults('fish.cannon', DEFAULT_CANNON_CONFIG)
  void ConfigRegistry.loadConfig<CannonConfig>('fish.cannon', 'src/projects/fish/config/cannon.config.json')

  // ─── Boss 配置 ───
  ConfigRegistry.registerDefaults('fish.boss', DEFAULT_BOSS_CONFIG)
  void ConfigRegistry.loadConfig<BossConfig>('fish.boss', 'src/projects/fish/config/boss.config.json')

  // ─── 鱼种配置 ───
  ConfigRegistry.registerDefaults('fish.fish', DEFAULT_FISH_CONFIG)
  void ConfigRegistry.loadConfig<FishConfig>('fish.fish', 'src/projects/fish/config/fish.config.json')

  // ─── 鱼群生成节奏配置 ───
  ConfigRegistry.registerDefaults('fish.school', DEFAULT_SCHOOL_CONFIG)
  void ConfigRegistry.loadConfig<SchoolConfig>('fish.school', 'src/projects/fish/config/school.config.json')

  // ─── 兵种 DataTable（部落冲突风格行表）───
  // 键=兵种 id，值=兵种属性；无默认值表（未加载时 getTable 返回 undefined，消费方用 if 守卫）
  void ConfigRegistry.loadTable<TroopType>(
    'fish.troop',
    'src/projects/fish/config/troop.table.json',
    (row): TroopType => ({
      ...row,
      // "#rrggbb" → 数字颜色
      color: parseInt((row.color as string).replace('#', ''), 16),
      size: [...(row.size as [number, number, number])],
    }),
  )

  log('[Config] FishMaster 配置表已注册')
}
