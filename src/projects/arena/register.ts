/**
 * Arena — 项目注册模块
 *
 * GameMode 注册表：场景资产 mode 字段 → GameMode 类（'arena' = 竞技场房间）。
 * GM 命令零修改自动扫描（gameplay/gm/*.gm.ts）。
 */
import { GameModeRegistry, GMRegistry, logger } from '@/engine'
import type { ProjectModule } from '../registry'
import { ArenaGameInstance } from './gameplay/ArenaGameInstance'
import { ArenaGameMode } from './gameplay/ArenaGameMode'
import { registerArenaAssets } from './asset'

// ─── GameMode：mode → 类 ───
GameModeRegistry.register('arena', ArenaGameMode)

// ─── GM 命令：自动扫描 gameplay/gm/*.gm.ts（新增命令文件零修改注册，幂等） ───
GMRegistry.registerProjectGlob(
  import.meta.glob('./gameplay/gm/*.gm.ts', { eager: true }) as Parameters<typeof GMRegistry.registerProjectGlob>[0],
)

// ─── 项目模块 ───
export const arenaProject: ProjectModule = {
  name: 'Arena',
  createGameInstance: (renderContainer) => {
    const inst = new ArenaGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
  registerAssets: registerArenaAssets,
}

logger.debug('[Arena] 项目模块已加载')
