/**
 * Racing — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { RacingGameInstance } from './'

export const racingProject: ProjectModule = {
  name: 'Racing',
  createGameInstance: (renderContainer) => new RacingGameInstance(renderContainer),
}
