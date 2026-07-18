/**
 * SceneDefaults — 编辑器场景默认内容与天空盒配置工具
 *
 * 从 Viewport.tsx 中剥离的非 UI 逻辑：
 * - addDefaultContent: 向场景添加默认灯光、网格辅助
 * - applySkybox: 根据 SkyboxConfig 更新场景背景/天空盒/雾效
 */
import * as THREE from 'three'
import type { SkyboxConfig } from '../engine'

/** 鼠标→世界坐标复用缓冲 */
export const _ptrWorld = new THREE.Vector3()

/**
 * 向场景添加默认内容（环境光、半球光、方向光、网格辅助线）
 */
export function addDefaultContent(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.4))
  const dl = new THREE.DirectionalLight(0xffffff, 1.2)
  dl.position.set(20, 30, 10)
  dl.castShadow = true
  dl.shadow.mapSize.width = 2048
  dl.shadow.mapSize.height = 2048
  scene.add(dl)
  const fl = new THREE.DirectionalLight(0x8888ff, 0.3)
  fl.position.set(-10, 15, -10)
  scene.add(fl)
  const grid = new THREE.GridHelper(40, 40, 0x444466, 0x333355)
  grid.position.y = -0.01
  scene.add(grid)
}

/**
 * 根据 SkyboxConfig 更新场景背景/天空盒/雾效
 */
export function applySkybox(scene: THREE.Scene, config: SkyboxConfig): void {
  // 天空盒立方体贴图（优先于纯色背景）
  if (config.skyboxPath) {
    const ext = config.skyboxExt ?? '.jpg'
    const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
    const urls = faces.map((s) => `${config.skyboxPath}_${s}${ext}`)
    scene.background = new THREE.CubeTextureLoader().load(urls)
  } else if (config.backgroundColor) {
    scene.background = new THREE.Color(config.backgroundColor)
  }
  // 雾效
  if (config.fogColor && config.fogNear !== undefined && config.fogFar !== undefined) {
    scene.fog = new THREE.Fog(config.fogColor, config.fogNear, config.fogFar)
  }
}
