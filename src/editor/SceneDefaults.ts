/**
 * SceneDefaults — 编辑器场景默认内容与天空盒配置工具
 *
 * 从 Viewport.tsx 中剥离的非 UI 逻辑：
 * - addDefaultContent: 向场景添加默认灯光、网格辅助
 * - applySkybox: 根据 SkyboxConfig 更新场景背景/天空盒/雾效
 */
import * as THREE from 'three'
import { GenericActor, LightComponent } from '../engine'
import type { LightComponentOptions, SkyboxConfig } from '../engine'

/** 鼠标→世界坐标复用缓冲 */
export const _ptrWorld = new THREE.Vector3()

/**
 * 向场景添加默认内容（环境光、半球光、方向光、网格辅助线）。
 *
 * 灯光 actor 化：灯光挂到 Actor（LightComponent），大纲显示为可选中/可编辑的节点，
 * 而不是裸 THREE 灯光对象（裸对象无 actorRef，大纲显示类型名且无法选中）。
 *
 * 统一层级：所有默认内容挂在一个 "Default" 容器 Actor 下（scene.add 顶层），
 * 与场景资产根 "Root" 并列，大纲呈现：
 *   Root [GenericActor]     ← 场景资产对象（loadSceneAsActors 创建）
 *   └─ plane_1 ...
 *   Default [GenericActor]  ← 编辑器默认内容（灯光、网格）
 *   └─ AmbientLight / HemisphereLight / KeyLight / FillLight
 */
export function addDefaultContent(scene: THREE.Scene): GenericActor {
  const container = new GenericActor('Default')

  const makeLightActor = (name: string, options: LightComponentOptions): void => {
    const actor = new GenericActor(name)
    actor.addComponent(LightComponent, options)
    actor.attachTo(container)
  }
  makeLightActor('AmbientLight', { type: 'ambient', color: '#ffffff', intensity: 0.6 })
  makeLightActor('HemisphereLight', { type: 'hemisphere', color: '#87ceeb', intensity: 0.4 })
  makeLightActor('KeyLight', {
    type: 'directional', color: '#ffffff', intensity: 1.2,
    position: [20, 30, 10], castShadow: true,
  })
  makeLightActor('FillLight', {
    type: 'directional', color: '#8888ff', intensity: 0.3,
    position: [-10, 15, -10],
  })
  const grid = new THREE.GridHelper(40, 40, 0x444466, 0x333355)
  grid.position.y = -0.01
  container.root.add(grid)

  scene.add(container.root)
  return container
}

/**
 * 根据 SkyboxConfig 更新场景背景/天空盒
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
}
