/**
 * Hoi4 — 项目注册模块（外部工程根）
 *
 * 与内置工程同一套 ProjectModule 契约；经 src/projects/registry.ts 的
 * import.meta.glob 自动发现并入注册表。
 */
import { GameModeRegistry, GMRegistry } from '@/engine'
import type { ProjectModule } from '../../src/projects/registry'
import { Hoi4GameInstance, initHoi4Configs } from './'
import { Hoi4GameMode } from './gameplay/base/Hoi4GameMode'
import { registerHoi4Assets } from './asset'

// ─── mode → GameMode 映射（场景资产 mode="map"） ───
GameModeRegistry.register('map', Hoi4GameMode)

// ─── GM 命令：自动扫描 gameplay/gm/*.gm.ts（零修改注册，幂等） ───
GMRegistry.registerProjectGlob(
  import.meta.glob('./gameplay/gm/*.gm.ts', { eager: true }) as Parameters<typeof GMRegistry.registerProjectGlob>[0],
)

export const hoi4Project: ProjectModule = {
  name: 'Hoi4',
  createGameInstance: (renderContainer) => {
    const inst = new Hoi4GameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
  registerAssets: registerHoi4Assets,
  initConfigs: initHoi4Configs,
}
