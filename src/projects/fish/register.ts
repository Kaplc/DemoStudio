/**
 * ClashMaster — 项目注册模块
 *
 * 资产注册通过 registerAssets 延迟加载（打开工程时调用）。
 */
import { GameModeRegistry, ActorRegistry, GMRegistry, GMModule } from '@/engine'
import type { ProjectModule } from '../registry'
import { FishGameInstance, initFishConfigs } from './'
import { FishMainMenuGameMode } from './gameplay/menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './gameplay/base/FishBaseGameMode'
import { FishGameMode } from './gameplay/game/FishGameMode'
import { FishLevelGameMode } from './gameplay/level/FishLevelGameMode'
import { FishHouseActor } from './gameplay/base/FishHouseActor'
import { CLASH_BUILDING_ACTOR_CLASSES } from './gameplay/base/ClashBuildingActors'
import { FishGMConsoleHUD } from './gameplay/gm/FishGMConsoleHUD'
import { registerFishAssets } from './asset'

// ─── mode → GameMode 映射 ───
GameModeRegistry.register('menu', FishMainMenuGameMode)
GameModeRegistry.register('base', FishBaseGameMode)
GameModeRegistry.register('game', FishGameMode)
GameModeRegistry.register('level', FishLevelGameMode)

// ─── GM 命令：自动扫描 gameplay/gm/*.gm.ts（新增命令文件零修改注册，幂等） ───
GMRegistry.registerProjectGlob(
  import.meta.glob('./gameplay/gm/*.gm.ts', { eager: true }) as Parameters<typeof GMRegistry.registerProjectGlob>[0],
)

// ─── GM 控制台：注入项目风格面板（FishGMConsoleHUD 部落冲突主题，覆写 buildUI） ───
GMModule.setConsoleFactory((gm) => new FishGMConsoleHUD(gm))

// ─── 行为类 Actor（供 Blueprint baseClass 引用） ───
ActorRegistry.register('FishHouse', () => new FishHouseActor('FishHouse'))

// ─── 部落冲突建筑 Actor 类（每个建筑一个类，蓝图 baseClass 引用） ───
// 类名 = 类型 id 首字母大写 + 'Actor'（如 townhall → TownhallActor）
for (const [typeId, ctor] of Object.entries(CLASH_BUILDING_ACTOR_CLASSES)) {
  const className = typeId.charAt(0).toUpperCase() + typeId.slice(1) + 'Actor'
  ActorRegistry.register(className, () => new ctor())
}

export const fishMasterProject: ProjectModule = {
  name: 'ClashMaster',
  createGameInstance: (renderContainer) => {
    const inst = new FishGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
  registerAssets: registerFishAssets,
  initConfigs: initFishConfigs,
}
