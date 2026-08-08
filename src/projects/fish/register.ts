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
import { FishHouseActor } from './gameplay/base/FishHouseActor'
import { registerFishAssets } from './asset'

// ─── mode → GameMode 映射 ───
GameModeRegistry.register('menu', FishMainMenuGameMode)
GameModeRegistry.register('base', FishBaseGameMode)
GameModeRegistry.register('game', FishGameMode)

// ─── 行为类 Actor（供 Blueprint baseClass 引用） ───
ActorRegistry.register('FishHouse', () => new FishHouseActor('FishHouse'))

export const fishMasterProject: ProjectModule = {
  name: 'FishMaster',
  createGameInstance: (scene, renderContainer) => new FishGameInstance(scene, renderContainer),
  registerAssets: registerFishAssets,
  initConfigs: initFishConfigs,
}
