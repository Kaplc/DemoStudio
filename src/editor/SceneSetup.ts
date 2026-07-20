/**
 * SceneSetup — Viewport 3D 场景初始化编排
 *
 * 职责：协调 SceneViewport / GameViewport 完成整体初始化，
 *       管理共享场景、Gizmos、ResizeObserver、清理
 */
import * as THREE from 'three'
import {
  GameSceneManager,
  PreviewSceneManager,
  logger,
  Game,
  NullGameInstance,
  gizmos,
} from '../engine'
import { addDefaultContent } from './index'
import { getTransformGizmo } from './SelectionManager'
import { createSceneViewport } from './SceneViewport'
import { createGameViewport } from './GameViewport'

export interface SceneSetupResult {
  /** 共享场景（Scene 视口预览 + Game 视口游戏共用一个 THREE.Scene） */
  sharedScene: THREE.Scene
  sceneMgr: PreviewSceneManager
  gameMgr: GameSceneManager
  game: Game
  sceneModeRef: { current: string | undefined }
  cleanup: () => void
}

export interface SceneSetupCallbacks {
  onScoreChange: (score: number) => void
  onPhaseChange: (phase: string) => void
  onGameOver: () => void
}

/**
 * 初始化共享场景 + Scene/Game 两个视口 + Game 实例
 */
export function setupScene(
  sceneContainerEl: HTMLElement,
  gameContainerEl: HTMLElement,
  callbacks: SceneSetupCallbacks,
  aspectRatio: string | null,
  onReady?: () => void,
): SceneSetupResult {
  logger.info('初始化 Viewport 引擎系统...')

  // ─── 共享场景（Scene 视口和 Game 视口共用）───
  const shared = new THREE.Scene()
  shared.background = new THREE.Color(0x1a1a2e)
  shared.fog = new THREE.Fog(0x1a1a2e, 30, 60)
  addDefaultContent(shared)
  gizmos.attach(shared)

  const sceneModeRef: { current: string | undefined } = { current: undefined }

  // ─── 游戏实例（仅作占位，真正实例在 Viewport 启动游戏时创建）───
  const gameInst = new NullGameInstance()

  if (gameInst.setCallbacks) {
    gameInst.setCallbacks(callbacks)
  }

  // ─── Scene 视口 ───
  const sceneMgr = createSceneViewport(sceneContainerEl, shared)

  // ─── TransformGizmo 初始化 ───
  const gizmo = getTransformGizmo()
  gizmo.setup(
    shared,
    sceneMgr.camera,
    sceneMgr.renderer,
    // 拖拽时冻结 Scene 视口输入
    () => sceneMgr.setInputEnabled(false),
    () => sceneMgr.setInputEnabled(true),
  )

  // ─── Game 视口 ───
  const gameMgr = createGameViewport(gameContainerEl, shared)

  // 初始应用画面比例
  if (aspectRatio) {
    const [aw, ah] = aspectRatio.split('/').map(Number)
    sceneMgr.setTargetAspect(aw / ah)
    gameMgr.setTargetAspect(aw / ah)
  }

  // ─── Game 入口 ───
  const game = new Game(gameInst, sceneMgr, gameMgr)

  // 每帧驱动 Gizmos 绘制 + TransformGizmo 变换同步
  const removeGizmoFlush = sceneMgr.onUpdate(() => {
    game.instance?.drawGizmos()
    // 每帧同步 TransformGizmo 位置/缩放（跟随目标移动或相机距离变化）
    if (gizmo.visible) {
      gizmo.syncTransform()
    }
  })

  // ─── ResizeObserver ───
  const obs1 = new ResizeObserver(() => sceneMgr.resize())
  obs1.observe(sceneContainerEl)
  const obs2 = new ResizeObserver(() => gameMgr.resize())
  obs2.observe(gameContainerEl)

  onReady?.()

  const cleanup = () => {
    obs1.disconnect()
    obs2.disconnect()
    removeGizmoFlush()
    game.destroy()
    sceneMgr.dispose()
    gameMgr.dispose()
    gizmos.detach()
    gizmo.detach() // 分离 TransformGizmo 目标
  }

  return {
    sharedScene: shared,
    sceneMgr,
    gameMgr,
    game,
    sceneModeRef,
    cleanup,
  }
}
