/**
 * WarmCurrent — 项目注册模块（外部工程根，hoi4 同款）
 *
 * 《暖流计划》：拖拽画线建立星际航线，拉回氦-3 维持聚能环运转。
 * 与内置工程同一套 ProjectModule 契约；经 src/projects/registry.ts 的
 * import.meta.glob 自动发现并入注册表。
 */
import { GameModeRegistry, GMRegistry, ActorRegistry } from '@/engine'
import type { ProjectModule } from '../../src/projects/registry'
import { WarmCurrentGameInstance, initWarmCurrentConfigs } from './'
import { WarmCurrentGameMode } from './gameplay/base/WarmCurrentGameMode'
import { WarmCurrentMenuGameMode } from './gameplay/menu/WarmCurrentMenuGameMode'
import { registerWarmCurrentAssets } from './asset'
import {
  SunActor, EarthActor, MoonActor, EuropaActor, MarsActor,
  MercuryActor, VenusActor, JupiterActor, SaturnActor, UranusActor, NeptuneActor,
} from './gameplay/map/StarActor'

// ─── mode → GameMode 映射（mode 全局唯一，项目前缀命名防跨项目冲突） ───
// warm-menu = 主菜单场景（WarmCurrentMenu）；warm-main = 星图场景（WarmCurrentMap）
GameModeRegistry.register('warm-menu', WarmCurrentMenuGameMode)
GameModeRegistry.register('warm-main', WarmCurrentGameMode)

// ─── 星图天体 Actor（蓝图 baseClass 引用；每类一注册，fish 建筑同构） ───
ActorRegistry.register('SunActor', () => new SunActor())
ActorRegistry.register('EarthActor', () => new EarthActor())
ActorRegistry.register('MoonActor', () => new MoonActor())
ActorRegistry.register('EuropaActor', () => new EuropaActor())
ActorRegistry.register('MarsActor', () => new MarsActor())
ActorRegistry.register('MercuryActor', () => new MercuryActor())
ActorRegistry.register('VenusActor', () => new VenusActor())
ActorRegistry.register('JupiterActor', () => new JupiterActor())
ActorRegistry.register('SaturnActor', () => new SaturnActor())
ActorRegistry.register('UranusActor', () => new UranusActor())
ActorRegistry.register('NeptuneActor', () => new NeptuneActor())

// ─── GM 命令：自动扫描 gameplay/gm/*.gm.ts（零修改注册，幂等） ───
GMRegistry.registerProjectGlob(
  import.meta.glob('./gameplay/gm/*.gm.ts', { eager: true }) as Parameters<typeof GMRegistry.registerProjectGlob>[0],
)

export const warmCurrentProject: ProjectModule = {
  name: 'WarmCurrent',
  createGameInstance: (renderContainer) => {
    const inst = new WarmCurrentGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
  registerAssets: registerWarmCurrentAssets,
  initConfigs: initWarmCurrentConfigs,
}
