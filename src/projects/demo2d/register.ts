/**
 * Demo2D — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { Demo2DGameInstance } from './Demo2DGameInstance'

export const demo2DProject: ProjectModule = {
  name: 'Demo2D',
  createGameInstance: (renderContainer) => {
    const inst = new Demo2DGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
}
