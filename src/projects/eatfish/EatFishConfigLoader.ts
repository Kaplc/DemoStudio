/**
 * EatFishConfigLoader — EatFish 配置表加载模块
 *
 * 由 EditorInitializer 调用，负责注册默认值并异步加载 EatFish 的所有配置表。
 * 将配置加载逻辑从编辑器初始化中分离到具体项目，每个实例/项目管理自己的配置。
 */
import { ConfigRegistry } from '@/engine'
import type { GameConfig, FishArchetype } from './types'
import { DEFAULT_CONFIG, parseHexColor } from './types'

/**
 * 初始化 EatFish 的所有配置表
 * - 注册默认值（同步 fallback）
 * - 异步加载 JSON 覆盖（fire-and-forget，首帧使用默认值）
 * - 加载鱼类原型 DataTable
 * @param log 日志输出回调
 */
export function initEatFishConfigs(log: (message: string) => void = console.log): void {
  // ─── 游戏配置 ───
  ConfigRegistry.registerDefaults('eatfish', DEFAULT_CONFIG)
  void ConfigRegistry.loadConfig<GameConfig>(
    'eatfish',
    'src/projects/eatfish/eatfish.config.json',
    (raw): GameConfig => ({
      ...raw,
      schoolColors: (raw.schoolColors ?? []).map((theme: string[]) => theme.map(parseHexColor)),
    }),
  )

  // ─── 鱼类原型 DataTable ───
  void ConfigRegistry.loadTable<FishArchetype>(
    'eatfish.fish',
    'src/projects/eatfish/fish.table.json',
    (row): FishArchetype => ({
      ...row,
      color: parseHexColor(row.color),
    }),
  )

  log('[Config] EatFish 配置表已注册')
}
