/**
 * FishMaster — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { FishGameInstance, initFishConfigs } from './'

export const fishMasterProject: ProjectModule = {
  name: 'FishMaster',
  createGameInstance: (scene) => new FishGameInstance(scene),
  initConfigs: initFishConfigs,
}
