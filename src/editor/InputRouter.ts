/**
 * InputRouter — Viewport 输入路由
 *
 * 根据 activeTab 判断当前视口，委托给 SceneViewport 或 GameViewport 处理。
 */
import * as THREE from 'three'
import { GameSceneManager } from '../engine'
import type { Game } from '../engine'
import type { PreviewSceneManager } from './SceneViewport'
import { handleSceneKeyDown, handleSceneKeyUp } from './SceneViewport'
import {
  handleGameKeyDown,
  handleGameKeyUp,
  handleGameMouseMove,
  handleGameMouseDown,
  handleGameMouseUp,
  handleGameWheel,
  clientToWorld,
} from './GameViewport'

export interface InputRouterContext {
  sceneMgr: PreviewSceneManager | null
  gameMgr: GameSceneManager | null
  game: Game | null
  /** 当前活跃的视口页签 id（'scene' | 'game' | 'bp:...'） */
  activeTabId: string
}

/**
 * 处理键盘按下事件
 * @returns 是否已消费该事件
 */
export function handleKeyDown(
  e: KeyboardEvent,
  ctx: InputRouterContext,
): boolean {
  if (ctx.activeTabId === 'scene') {
    return handleSceneKeyDown(e, ctx.sceneMgr)
  }
  if (ctx.activeTabId !== 'game') return false
  return handleGameKeyDown(e, ctx.game)
}

/**
 * 处理键盘释放事件
 */
export function handleKeyUp(
  e: KeyboardEvent,
  ctx: InputRouterContext,
): boolean {
  if (ctx.activeTabId === 'scene') {
    return handleSceneKeyUp(e, ctx.sceneMgr)
  }
  if (ctx.activeTabId !== 'game') return false
  return handleGameKeyUp(e, ctx.game)
}

/**
 * 处理鼠标移动事件（Game 标签 + 游戏运行时）
 */
export function handleMouseMove(
  e: MouseEvent,
  ctx: InputRouterContext,
  _ptrWorld: THREE.Vector3,
): void {
  handleGameMouseMove(e, ctx.game, ctx.gameMgr, _ptrWorld)
}

/**
 * 处理鼠标按下事件（Game 标签 + 游戏运行时）
 */
export function handleMouseDown(
  e: MouseEvent,
  ctx: InputRouterContext,
  _ptrWorld: THREE.Vector3,
): void {
  handleGameMouseDown(e, ctx.game, ctx.gameMgr, _ptrWorld)
}

/**
 * 处理鼠标释放事件
 */
export function handleMouseUp(
  e: MouseEvent,
  ctx: InputRouterContext,
  _ptrWorld: THREE.Vector3,
): void {
  handleGameMouseUp(e, ctx.game, ctx.gameMgr, _ptrWorld)
}

/**
 * 处理滚轮事件
 */
export function handleWheel(
  e: WheelEvent,
  ctx: InputRouterContext,
): void {
  handleGameWheel(e, ctx.game)
}


