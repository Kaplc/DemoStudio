/** initHoi4Configs — 便捷入口：实例化并初始化 Hoi4 配置（register.ts initConfigs 用） */
import { Hoi4ConfigLoader } from './Hoi4ConfigLoader'

export function initHoi4Configs(log?: (message: string) => void): void {
  new Hoi4ConfigLoader(log).init()
}
