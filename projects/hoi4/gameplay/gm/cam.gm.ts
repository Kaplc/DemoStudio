/**
 * cam — 相机取景（兵模/地图验证用）：cam(x, z, dist)
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'

export default {
  name: 'cam',
  description: '相机取景 cam(x,z,dist)：target 设为 (x,0,z)，距离 d（缺省 40）',
  params: [
    { name: 'x', type: 'float', required: true, desc: '注视点 x' },
    { name: 'z', type: 'float', required: true, desc: '注视点 z' },
    { name: 'dist', type: 'float', required: false, desc: '相机距离（缺省 40）' },
  ],
  handler: (ctx, x, z, dist) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: Hoi4GameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const rig = mode.camera.rig
    const cam = mode.camera.cameraComponent.camera
    const tx = Number(x)
    const tz = Number(z)
    const d = Math.max(rig.minDistance, Math.min(rig.maxDistance, Number(dist ?? 40)))
    rig.target.set(tx, 0, tz)
    // 固定垂直俯视（对齐 Hoi4CameraActor.place() 的机位方向），up 轴 = 世界 -Z（北向朝屏幕上方）
    cam.up.set(0, 0, -1)
    cam.position.set(tx, d, tz)
    cam.lookAt(rig.target)
    mode.camera.SyncToActor()
    ctx.output(`cam → target(${tx.toFixed(1)}, ${tz.toFixed(1)}) dist=${d.toFixed(0)}`)
  },
} as GMCommandDef
