/**
 * SceneComponent — THREE.Scene 托管组件
 *
 * World 持有本组件作为场景容器，所有 Actor 的 root 挂到此 scene。
 * Scene 由 SceneComponent 自己创建（不再接受外部传入），禁止裸 `new THREE.Scene()`。
 */
import * as THREE from 'three'
import { AObjectComponent } from '../entity/AObjectComponent'
import type { World } from './World'

export class SceneComponent extends AObjectComponent<World> {
  /** THREE 场景对象 */
  readonly scene: THREE.Scene

  constructor(owner: World) {
    super(owner)
    this.scene = new THREE.Scene()
  }
}
