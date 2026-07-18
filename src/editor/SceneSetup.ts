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
  GameFactoryRegistry,
  NullGameInstance,
  gizmos,
} from '../engine'
import { addDefaultContent } from './index'
import { createSceneViewport } from './SceneViewport'
import { createGameViewport } from './GameViewport'
import { useEditorStore } from '../stores/editorStore'

export interface SceneSetupResult {
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

  // ─── 共享场景 ───
  const shared = new THREE.Scene()
  shared.background = new THREE.Color(0x1a1a2e)
  shared.fog = new THREE.Fog(0x1a1a2e, 30, 60)
  addDefaultContent(shared)
  gizmos.attach(shared)

  const sceneModeRef: { current: string | undefined } = { current: undefined }

  // ─── 游戏实例 ───
  const currentProject = useEditorStore.getState().currentProject
  const gameInst = currentProject && GameFactoryRegistry.has(currentProject.name)
    ? GameFactoryRegistry.create(currentProject.name, shared)!
    : new NullGameInstance()

  if (gameInst.setCallbacks) {
    gameInst.setCallbacks(callbacks)
  }

  // ─── Scene 视口 ───
  const sceneMgr = createSceneViewport(sceneContainerEl, shared)

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

  // 每帧驱动 Gizmos 绘制
  const removeGizmoFlush = sceneMgr.onUpdate(() => {
    game.instance?.drawGizmos()
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
