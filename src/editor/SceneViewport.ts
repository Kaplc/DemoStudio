/**
 * SceneViewport — Scene 视口专用逻辑
 *
 * 职责：
 *  - 创建并初始化 PreviewSceneManager（飞越摄像机 + WASD 漫游）
 *  - Scene 视口键盘输入处理（WASD 漫游控制）
 */
import * as THREE from 'three'
import { PreviewSceneManager } from '../engine'

// ════════════════════════════════════════════
//   Scene 视口初始化
// ════════════════════════════════════════════

/**
 * 创建 Scene 视口的 PreviewSceneManager
 * @param containerEl  DOM 容器
 * @param sharedScene  共享 THREE.Scene
 */
export function createSceneViewport(
  containerEl: HTMLElement,
  sharedScene?: THREE.Scene,
): PreviewSceneManager {
  const mgr = new PreviewSceneManager(containerEl, {
    controlMode: 'fly',
    sharedScene,
    addDefaultContent: false,
  })
  mgr.setWASDControl(true)
  mgr.setCameraOrbit(45, 30, 20)
  mgr.start()
  return mgr
}

// ════════════════════════════════════════════
//   Scene 视口输入
// ════════════════════════════════════════════

const SCENE_WASD_KEYS = new Set([
  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'q', 'Q', 'e', 'E',
])

/**
 * 处理 Scene 视口的键盘按下（WASD 飞越漫游）
 * @returns 是否已消费该事件
 */
export function handleSceneKeyDown(
  e: KeyboardEvent,
  mgr: PreviewSceneManager | null,
): boolean {
  if (!SCENE_WASD_KEYS.has(e.key)) return false
  mgr?.onWASDKeyDown(e.key)
  e.preventDefault()
  return true
}

/**
 * 处理 Scene 视口的键盘释放
 * @returns 是否已消费该事件
 */
export function handleSceneKeyUp(
  e: KeyboardEvent,
  mgr: PreviewSceneManager | null,
): boolean {
  if (!SCENE_WASD_KEYS.has(e.key)) return false
  mgr?.onWASDKeyUp(e.key)
  return true
}
