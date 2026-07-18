/**
 * EatFish — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { EatFishGameInstance, initEatFishConfigs } from './'

export const eatFishProject: ProjectModule = {
  name: 'EatFish',
  createGameInstance: (scene) => new EatFishGameInstance(scene),
  initConfigs: initEatFishConfigs,
}
