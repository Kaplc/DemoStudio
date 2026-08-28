/**
 * SceneSetup — Viewport 3D 场景初始化编排
 *
 * 职责：协调 SceneViewport 完成整体初始化，
 *       管理共享场景、Gizmos、ResizeObserver、清理
 * （Game 由 Viewport 在点击启动游戏按钮时创建并管理生命周期）
 */
import * as THREE from 'three'
import {
  logger,
  gizmos,
} from '../engine'
import type { SceneRendererComponent } from '../engine'
import { addDefaultContent } from './index'
import { getTransformGizmo } from './SelectionManager'
import { createSceneViewport } from './SceneViewport'
import type { PreviewSceneManager } from './SceneViewport'

export interface SceneSetupResult {
  /** 共享场景（Scene 视口预览 + Game 视口游戏共用一个 THREE.Scene） */
  editorScene: THREE.Scene
  sceneMgr: PreviewSceneManager
  /** Game 视口渲染器（由 Game 启动时创建并归 World 持有；未启动时为 null） */
  gameMgr: SceneRendererComponent | null
  sceneModeRef: { current: string | undefined }
  cleanup: () => void
}

/**
 * 初始化共享场景 + Scene 视口
 * （Game 与 Game 视口渲染器由 Viewport 在启动游戏时创建）
 */
export function setupScene(
  sceneContainerEl: HTMLElement,
  onReady?: () => void,
): SceneSetupResult {
  logger.info('初始化 Viewport 引擎系统...')

  // ─── 共享场景（Scene 视口和 Game 视口共用）───
  const shared = new THREE.Scene()
  shared.background = new THREE.Color(0x1a1a2e)
  addDefaultContent(shared)
  gizmos.attach(shared)

  const sceneModeRef: { current: string | undefined } = { current: undefined }

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

  // 每帧同步 TransformGizmo 位置/缩放（跟随目标移动或相机距离变化）
  // （可见性由 gizmos 开关委托驱动，见 TransformGizmo.setup；Game 实例的
  //   tick/drawGizmos 由 Game.launch 挂载）
  const removeGizmoFlush = sceneMgr.onUpdate(() => {
    if (gizmo.visible) {
      gizmo.syncTransform()
    }
  })

  // ─── ResizeObserver（仅 Scene 视口；Game 视口渲染器由 Game 启动时创建，其内部容器 resize 由渲染器构造时接管）───
  const obs1 = new ResizeObserver(() => sceneMgr.resize())
  obs1.observe(sceneContainerEl)

  onReady?.()

  const cleanup = () => {
    obs1.disconnect()
    removeGizmoFlush()
    sceneMgr.dispose()
    gizmos.detach(shared) // 分离共享场景的 gizmos 线段缓冲（多场景后端按场景回收）
    gizmo.detach() // 分离 TransformGizmo 目标
  }

  return {
    editorScene: shared,
    sceneMgr,
    gameMgr: null,
    sceneModeRef,
    cleanup,
  }
}
