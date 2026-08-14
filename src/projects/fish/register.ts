/**
 * FishMaster — 项目注册模块
 *
 * 资产注册通过 registerAssets 延迟加载（打开工程时调用）。
 */
import { GameModeRegistry, ActorRegistry } from '@/engine'
import type { ProjectModule } from '../registry'
import { FishGameInstance, initFishConfigs } from './'
import { FishMainMenuGameMode } from './gameplay/menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './gameplay/base/FishBaseGameMode'
import { FishGameMode } from './gameplay/game/FishGameMode'
import { FishLevelGameMode } from './gameplay/level/FishLevelGameMode'
import { FishHouseActor } from './gameplay/base/FishHouseActor'
import { CLASH_BUILDING_ACTOR_CLASSES } from './gameplay/base/ClashBuildingActors'
import { registerFishAssets } from './asset'

// ─── mode → GameMode 映射 ───
GameModeRegistry.register('menu', FishMainMenuGameMode)
GameModeRegistry.register('base', FishBaseGameMode)
GameModeRegistry.register('game', FishGameMode)
GameModeRegistry.register('level', FishLevelGameMode)

// ─── 行为类 Actor（供 Blueprint baseClass 引用） ───
ActorRegistry.register('FishHouse', () => new FishHouseActor('FishHouse'))

// ─── 部落冲突建筑 Actor 类（每个建筑一个类，蓝图 baseClass 引用） ───
// 类名 = 类型 id 首字母大写 + 'Actor'（如 townhall → TownhallActor）
for (const [typeId, ctor] of Object.entries(CLASH_BUILDING_ACTOR_CLASSES)) {
  const className = typeId.charAt(0).toUpperCase() + typeId.slice(1) + 'Actor'
  ActorRegistry.register(className, () => new ctor())
}

export const fishMasterProject: ProjectModule = {
  name: 'FishMaster',
  createGameInstance: (scene, renderContainer) => new FishGameInstance(scene, renderContainer),
  registerAssets: registerFishAssets,
  initConfigs: initFishConfigs,
}
