export { FishCannon } from './gameplay/game/FishCannon'
export { FishNet } from './gameplay/game/FishNet'
export { FishBullet } from './gameplay/game/FishBullet'
export { FishPawn } from './gameplay/game/FishPawn'
export { FishCoinParticle } from './gameplay/game/FishCoinParticle'
export { FishCoinFly } from './gameplay/game/FishCoinFly'
export { FishPlayerController } from './gameplay/game/FishPlayerController'
export { FishGameMode } from './gameplay/game/FishGameMode'
export { FishMainMenuGameMode } from './gameplay/menu/FishMainMenuGameMode'
export { FishBaseGameMode } from './gameplay/base/FishBaseGameMode'
export { FishGameInstance } from './gameplay/FishGameInstance'
import { FishConfigLoader } from './FishConfigLoader'
export { FishConfigLoader }

/** 便捷入口：实例化并初始化 ClashMaster 配置（供 register.ts initConfigs 与外部调用） */
export function initFishConfigs(log?: (message: string) => void): void {
  new FishConfigLoader(log).init()
}
export * from './gameplay/common/types'
