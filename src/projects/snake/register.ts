/**
 * Snake — 项目注册模块
 */
import type { ProjectModule } from '../registry'
import { SnakeGameInstance } from './SnakeGameInstance'

export const snakeProject: ProjectModule = {
  name: 'Snake',
  createGameInstance: (scene) => new SnakeGameInstance(scene),
}
