/**
 * EatFishConfigLoader — EatFish 配置表加载类
 *
 * 继承 ConfigLoaderBase（engine 注册器基类），由 EatFishGameInstance 构造时实例化并调用 init()，
 * 统一注册默认值 + 自动注册 asset/config/ 下所有配置（游戏配置 + 鱼类原型 DataTable）。
 *
 * 半自动注册：默认值与 transform 仍手动（依赖代码常量/归一化），
 * 路径与配置名由 asset/config/index.ts 的 glob 自动推导。
 */
import { ConfigLoaderBase } from '@/engine'
import type { GameConfig, FishArchetype } from './types'
import { DEFAULT_CONFIG, parseHexColor } from './types'
import { configGlob } from './asset/config'

export class EatFishConfigLoader extends ConfigLoaderBase {
  constructor(log: (message: string) => void = (m) => console.info(m)) {
    super('eatfish', log)
  }

  override init(): void {
    // ─── 默认值（同步 fallback） ───
    this.registerDefaults('eatfish.eatfish', DEFAULT_CONFIG)

    // ─── 归一化 transform（须在 registerGlob 之前注册） ───
    // 游戏配置：schoolColors 的 "#rrggbb" → 数字
    this.registerConfigTransform<GameConfig>('eatfish.eatfish', (raw): GameConfig => ({
      ...raw,
      schoolColors: (raw.schoolColors ?? []).map((theme: string[]) => theme.map(parseHexColor)),
    }))
    // 鱼类原型 DataTable：color 的 "#rrggbb" → 数字
    this.registerTableTransform<FishArchetype>('eatfish.fish', (row): FishArchetype => ({
      ...row,
      color: parseHexColor(row.color),
    }))

    // ─── 自动注册 asset/config/ 下所有配置文件（路径/name 由 glob 推导） ───
    this.registerGlob(configGlob.configModules, configGlob.tableModules)

    this.log('[Config] EatFish 配置表已注册')
  }
}
