/**
 * GameViewport — Game 视口专用逻辑
 *
 * 职责：
 *  - 创建并初始化 GameSceneManager
 *  - Game 视口键盘输入路由（→ PlayerController）
 *  - Game 视口鼠标输入路由（→ InputSys / PlayerController）
 *  - 坐标转换
 */
import * as THREE from 'three'
import { GameSceneManager, logger } from '../engine'
import type { Game } from '../engine'

// ════════════════════════════════════════════
//   Game 视口初始化
// ════════════════════════════════════════════

/**
 * 创建 Game 视口的 GameSceneManager
 * @param containerEl  DOM 容器
 * @param sharedScene  共享 THREE.Scene
 */
export function createGameViewport(
  containerEl: HTMLElement,
  sharedScene?: THREE.Scene,
): GameSceneManager {
  const mgr = new GameSceneManager(containerEl, {
    sharedScene,
  })
  return mgr
}

// ════════════════════════════════════════════
//   Game 视口键盘输入
// ════════════════════════════════════════════

/**
 * 处理 Game 视口的键盘按下（→ InputSys.handleKeyDown）
 * @returns 是否已消费该事件
 */
export function handleGameKeyDown(
  e: KeyboardEvent,
  game: Game | null,
): boolean {
  const inst = game?.instance
  if (inst) {
    inst.inputSys.handleKeyDown(e.key, inst.controller)
  }
  e.preventDefault()
  return true
}

/**
 * 处理 Game 视口的键盘释放（→ InputSys.handleKeyUp）
 * @returns 是否已消费该事件
 */
export function handleGameKeyUp(
  e: KeyboardEvent,
  game: Game | null,
): boolean {
  const inst = game?.instance
  if (inst) {
    inst.inputSys.handleKeyUp(e.key, inst.controller)
  }
  return true
}

// ════════════════════════════════════════════
//   Game 视口鼠标输入
// ════════════════════════════════════════════

/**
 * 处理 Game 视口的鼠标移动（→ InputSys.handlePointerMove）
 */
export function handleGameMouseMove(
  e: MouseEvent,
  game: Game | null,
  gameMgr: GameSceneManager | null,
  _ptrWorld: THREE.Vector3,
): void {
  const inst = game?.instance
  if (!inst) return
  const controller = inst.controller
  const worldPos = clientToWorld(e.clientX, e.clientY, gameMgr, _ptrWorld)
  inst.inputSys.handlePointerMove(e.clientX, e.clientY, worldPos, controller)
}

/**
 * 处理 Game 视口的鼠标按下（→ InputSys.handlePointerDown）
 */
export function handleGameMouseDown(
  e: MouseEvent,
  game: Game | null,
  gameMgr: GameSceneManager | null,
  _ptrWorld: THREE.Vector3,
): void {
  if (e.button !== 0) return
  logger.debug(`[GameViewport] mousedown at (${e.clientX}, ${e.clientY})`)
  const inst = game?.instance
  if (!inst) return
  const controller = inst.controller
  const worldPos = clientToWorld(e.clientX, e.clientY, gameMgr, _ptrWorld)
  inst.inputSys.handlePointerDown(e.clientX, e.clientY, worldPos, controller)
}

/**
 * 处理 Game 视口的鼠标释放（→ InputSys.handlePointerUp）
 */
export function handleGameMouseUp(
  e: MouseEvent,
  game: Game | null,
  gameMgr: GameSceneManager | null,
  _ptrWorld: THREE.Vector3,
): void {
  if (e.button !== 0) return
  const inst = game?.instance
  if (!inst) return
  const worldPos = clientToWorld(e.clientX, e.clientY, gameMgr, _ptrWorld)
  inst.inputSys.handlePointerUp(worldPos, inst.controller)
}

/**
 * 处理 Game 视口的滚轮事件（→ InputSys.handleScroll）
 */
export function handleGameWheel(
  e: WheelEvent,
  game: Game | null,
): void {
  e.preventDefault()
  const inst = game?.instance
  logger.debug(`[GameViewport] wheel deltaY=${e.deltaY}, inst=${inst?.constructor.name}, controller=${(inst as unknown as { controller?: { root?: { name?: string } } })?.controller?.root?.name ?? 'N/A'}`)
  if (inst) {
    inst.inputSys.handleScroll(e.deltaY, inst.controller)
  }
}

// ════════════════════════════════════════════
//   坐标转换
// ════════════════════════════════════════════

/**
 * 将客户端坐标转换为世界坐标（投影到 z=0 平面）
 */
export function clientToWorld(
  clientX: number,
  clientY: number,
  gameMgr: GameSceneManager | null,
  _ptrWorld: THREE.Vector3,
): THREE.Vector3 {
  return gameMgr?.clientToWorld(clientX, clientY, _ptrWorld) ?? _ptrWorld
}
