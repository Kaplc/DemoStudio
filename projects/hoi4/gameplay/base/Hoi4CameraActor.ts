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

  /** 垂直俯视就位（up 轴设为世界 -Z，地图北向朝屏幕上方）；开局对准欧洲主战场 */
  place(): void {
    // 欧洲中部 lon 15E / lat 52N → 世界坐标（地图 256x128，中心为 lon 0 / lat 0）
    const tx = ((15 + 180) / 360) * 256 - 128
    const tz = ((90 - 52) / 180) * 128 - 64
    this.rig.target.set(tx, 0, tz)
    const d = 72 // 欧级视野（min 12 ~ max 345）
    this.camera.up.set(0, 0, -1)
    this.camera.position.set(tx, d, tz)
    this.camera.lookAt(tx, 0, tz)
    this.SyncToActor()
  }
}
