/**
 * Hoi4CameraActor — 战略地图俯瞰相机（滚轮缩放 + 右键/边缘平移）
 */
import * as THREE from 'three'
import { CameraActor, CameraRigComponent } from '@/engine'

export class Hoi4CameraActor extends CameraActor {
  readonly rig: CameraRigComponent

  constructor(worldWidth: number, worldHeight: number) {
    super('Hoi4Camera', 'perspective')
    this.cameraComponent.SetView(50, 2, 800)
    this.cameraComponent.priority = 10

    this.rig = new CameraRigComponent(this, 'MapRig')
    this.addComponent(this.rig)
    this.rig.target = new THREE.Vector3(0, 0, 0)
    this.rig.minDistance = 12
    this.rig.maxDistance = Math.max(worldWidth, worldHeight) * 1.35
    this.rig.step = 8
    this.rig.panLimit = Math.max(worldWidth, worldHeight) * 0.55
    this.rig.edgePanSpeed = 22
  }

  /** 俯瞰就位（略带俯角，避免 lookAt 与 up 向量平行） */
  place(): void {
    const d = this.rig.maxDistance * 0.85
    this.camera.position.set(0, d * 0.92, d * 0.4)
    this.camera.lookAt(0, 0, 0)
    this.SyncToActor()
  }
}
