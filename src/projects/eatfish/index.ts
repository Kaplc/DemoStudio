/** EatFish — 大鱼吃小鱼游戏入口 */
export { EatFishPawn } from './EatFishPawn'
export { EatFishFoodPawn } from './EatFishFoodPawn'
export { EatFishPredatorPawn } from './EatFishPredatorPawn'
export { EatFishPlayerController } from './EatFishPlayerController'
export { EatFishGameMode } from './EatFishGameMode'
export { EatFishGameInstance } from './EatFishGameInstance'
export { FishSchool } from './FishSchool'
import { EatFishConfigLoader } from './EatFishConfigLoader'
export { EatFishConfigLoader }

/** 便捷入口：实例化并初始化 EatFish 配置（供 register.ts initConfigs 与外部调用） */
export function initEatFishConfigs(log?: (message: string) => void): void {
  new EatFishConfigLoader(log).init()
}
export * from './types'
