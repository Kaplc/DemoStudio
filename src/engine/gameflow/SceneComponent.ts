/**
 * SceneComponent — THREE.Scene 托管组件
 *
 * World 持有本组件作为场景容器，所有 Actor 的 root 挂到此 scene。
 * 本组件是 World 操作场景的唯一入口：注入外部共享场景、设置背景/雾、环境贴图等，
 * World 层只做委托（world.scene 访问器 / 快捷方法）。
 */
import * as THREE from 'three'
import { AObjectComponent } from '../entity/AObjectComponent'
import type { World } from './World'

export class SceneComponent extends AObjectComponent<World> {
  /** THREE 场景对象 */
  private _scene: THREE.Scene

  /** 当前场景（所有 Actor 的 root 挂到此 scene 下） */
  get scene(): THREE.Scene {
    return this._scene
  }

  constructor(owner: World, scene?: THREE.Scene) {
    super(owner)
    this._scene = scene ?? new THREE.Scene()
  }

  /**
   * 替换场景（编辑器共享场景注入用）。
   * 旧场景已有内容（children）迁移到新场景，保证不丢对象；
   * 通常在 World 构造后、任何 actor spawn 前调用（旧场景为空）。
   */
  setScene(scene: THREE.Scene): void {
    if (scene === this._scene) return
    // 迁移旧场景内容到新场景（兜底：防止提前注入时已有对象丢失）
    for (const child of [...this._scene.children]) {
      this._scene.remove(child)
      scene.add(child)
    }
    // 背景/雾等环境属性一并迁移
    scene.background = this._scene.background
    scene.fog = this._scene.fog
    scene.environment = this._scene.environment
    this._scene = scene
  }

  /**
   * 替换场景为外部传入的场景（无调用者时保持自建场景）。
   *
   * 注意：编辑器与游戏场景已解耦（编辑器只读经 EditorGameBridgeComponent 读取游戏场景），
   * 编辑器不再向游戏注入场景，本方法仅作为通用场景替换能力保留（如需要
   * 把某个 World 的场景挂到外部容器）。传 null 恢复自建新场景。
   */
  attachExternalScene(scene: THREE.Scene | null): void {
    this.setScene(scene ?? new THREE.Scene())
  }

  /** 设置场景背景色（场景资产 skybox 配置应用） */
  setBackground(color: THREE.ColorRepresentation | null): void {
    this._scene.background = color === null ? null : new THREE.Color(color)
  }

  /** 设置场景雾效（场景资产 skybox 配置应用；null 清除雾） */
  setFog(fog: THREE.Fog | THREE.FogExp2 | null): void {
    this._scene.fog = fog
  }

  /** 设置环境贴图（PBR 反射/环境光来源；null 清除） */
  setEnvironment(env: THREE.Texture | null): void {
    this._scene.environment = env
  }
}
