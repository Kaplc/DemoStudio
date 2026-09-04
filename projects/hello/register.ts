/**
 * Hello — 项目注册模块（外部工程根示例）
 *
 * 与内置工程的 register.ts 完全同一套 ProjectModule 契约；
 * 本文件经 src/projects/registry.ts 的 import.meta.glob 自动发现并并入注册表，
 * 无需修改任何内置代码。
 */
import type { ProjectModule } from '../../src/projects/registry'
import { HelloGameInstance } from './'
import { registerHelloAssets } from './asset'

export const helloProject: ProjectModule = {
  name: 'Hello',
  createGameInstance: (renderContainer) => {
    const inst = new HelloGameInstance()
    if (renderContainer) inst.viewport.setContainer(renderContainer)
    return inst
  },
  registerAssets: registerHelloAssets,
}