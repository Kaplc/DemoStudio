/**
 * GameInstance — 游戏实例抽象基类
 * 定义所有游戏实例的标准接口
 * 子类需实现：start/tick/syncCamera/stop/destroy 以及 controller 属性
 */
import * as THREE from 'three'
import { PlayerController } from './PlayerController'
import type { GameUI } from './GameUI'

export interface GameInstanceCallbacks {
  onScoreChange?: (score: number) => void
  onPhaseChange?: (phase: string) => void
  onGameOver?: () => void
}

export abstract class GameInstance {
  /** GameUI 引用（由 Game 在 launch 时注入） */
  ui: GameUI | null = null

  /** 当前玩家控制器（用于输入路由） */
  abstract get controller(): PlayerController | null

  /** 注册状态变化回调 */
  abstract setCallbacks(cbs: GameInstanceCallbacks): void

  /** 启动游戏：生成玩家、初始化世界、进入运行态 */
  abstract start(): boolean

  /** 每帧 Tick（由外部渲染循环驱动） */
  abstract tick(dt: number): void

  /** 每帧绘制调试 Gizmos（默认空操作；拥有 World 的实例可重写为 world.drawGizmos()） */
  drawGizmos(): void {}

  /** 从 PlayerCameraManager 同步到目标摄像机 */
  abstract syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number): void

  /** 停止游戏：销毁 Actor、暂停运行 */
  abstract stop(): void

  /** 完全销毁：清理所有资源 */
  abstract destroy(): void
}

/** 空游戏实例 — 未选择/未注册工程时使用 */
export class NullGameInstance extends GameInstance {
  override get controller() { return null }
  override setCallbacks() {}
  override start() { return false }
  override tick() {}
  override syncCamera() {}
  override stop() {}
  override destroy() {}
}
