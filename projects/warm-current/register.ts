/**
 * WarmCurrent — 项目注册模块（外部工程根，hoi4 同款）
 *
 * 《暖流计划》：拖拽画线建立星际航线，拉回氦-3 维持聚能环运转。
 * 与内置工程同一套 ProjectModule 契约；经 src/projects/registry.ts 的
 * import.meta.glob 自动发现并入注册表。
 */
import { GameModeRegistry, GMRegistry } from '@/engine'
import type { ProjectModule } from '../../src/projects/registry'
import { WarmCurrentGameInstance, initWarmCurrentConfigs } from './'
import { WarmCurrentGameMode } from './gameplay/base/WarmCurrentGameMode'
import { registerWarmCurrentAssets } from './asset'

// ─── mode → GameMode 映射（场景资产 mode="main"） ───
GameModeRegistry.register('main', WarmCurrentGameMode)

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
