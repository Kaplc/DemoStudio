/**
 * Racing — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { RacingGameInstance } from './'

export const racingProject: ProjectModule = {
  name: 'Racing',
  createGameInstance: (renderContainer) => {
    const inst = new RacingGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
}
