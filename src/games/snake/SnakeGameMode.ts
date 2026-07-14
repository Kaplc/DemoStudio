/**
 * SnakeGameMode — 贪吃蛇游戏规则
 * 控制：食物生成、计分、游戏结束判断
 */
import { GameMode, type World } from '../../framework'
import { SnakePawn } from './SnakePawn'
import { SnakePlayerController } from './SnakePlayerController'

export class SnakeGameMode extends GameMode {
  constructor(world: World) {
    super(world)
  }

  override InitGame() {
    super.InitGame()
  }

  override StartPlay() {
    super.StartPlay()
  }

  /** 吃食物时调用 */
  OnEatFood() {
    this.gameState.addScore(1)
  }

  /** 蛇死亡时调用 */
  OnSnakeDied() {
    this.gameState.setPhase('gameover')
  }

  override IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  override SpawnPlayer() {
    const pawn = new SnakePawn()
    const controller = new SnakePlayerController()

    // 注册游戏摄像机
    this.cameraManager.RegisterCamera(pawn.gameCamera)

    return { controller, pawn }
  }
}
