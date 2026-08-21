/**
 * ColliderDebugDrawer — 编辑器预览视口碰撞盒线框绘制器（蓝图/场景预览共用）
 *
 * 预览 World 的碰撞体组件不注册物理 body（PhysicsWorld.active=false），
 * 无法走 OnDrawGizmos（需要 body.position）；本绘制器直接从组件属性
 * （size/radius/length/offset + owner 位置）解析几何，用单个 LineSegments
 * 每帧重建，挂到预览场景。
 *
 * 显隐跟随 colliderGizmos.enabled（编辑器 V 键 / 引擎 Game 视口共用同一开关）。
 */
import * as THREE from 'three'
import { colliderGizmos, BoxColliderComponent, CircleColliderComponent, CapsuleColliderComponent, ColliderComponent, type Actor } from '@/engine'
import { logger } from '@/engine/Logger'

/** 线框颜色（static 建筑绿 / dynamic 兵橙，与引擎 gizmos 一致） */
const COLOR_STATIC = 0x00e676
const COLOR_DYNAMIC = 0xff9100

export class ColliderDebugDrawer {
  /** 绘制目标场景 */
  readonly scene: THREE.Scene
  private lines: THREE.LineSegments
  private geometry: THREE.BufferGeometry
  /** 顶点缓冲（扩容式） */
  private positions: Float32Array
  private capacity: number
  private vertexCount = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.capacity = 2048
    this.positions = new Float32Array(this.capacity * 3)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setDrawRange(0, 0)
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    this.lines = new THREE.LineSegments(this.geometry, mat)
    this.lines.frustumCulled = false
    this.lines.renderOrder = 998
    this.lines.visible = colliderGizmos.enabled
    scene.add(this.lines)
    // V 键切换时立即刷新显隐（KeyboardShortcuts 派发）
    window.addEventListener('collider-gizmos-toggled', this.applyEnabled)
  }

  /** 移除线框对象（预览销毁时调用） */
  dispose(): void {
    window.removeEventListener('collider-gizmos-toggled', this.applyEnabled)
    this.lines.removeFromParent()
    this.geometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
  }

  /** 开关（V 键切换后调用：立即显隐；箭头函数字段保证 this 绑定） */
  /** 开关（V 键切换后调用：立即显隐；箭头函数字段保证 this 绑定） */
  private readonly applyEnabled = (): void => {
    this.lines.visible = colliderGizmos.enabled
    if (!this.lines.visible) this.vertexCount = 0
  }

  /**
   * 每帧更新：遍历 Actor 子树收集碰撞体组件，重建线框顶点。
   * @param actors 预览 World 的 Actor 列表
   */
  update(actors: Actor[]): void {
    if (!colliderGizmos.enabled) return
    this.vertexCount = 0
    const v = new THREE.Vector3()
    const pos = new THREE.Vector3()
    for (const actor of actors) {
      this.collect(actor, pos, v)
    }
    if (this.vertexCount > 0) {
      ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
    this.geometry.setDrawRange(0, this.vertexCount)
    this.lines.visible = colliderGizmos.enabled && this.vertexCount > 0
  }

  /** 递归收集一个 Actor 子树内的碰撞体形状 */
  private collect(actor: Actor, worldPos: THREE.Vector3, tmp: THREE.Vector3): void {
    if (actor.bPendingDestroy) return
    for (const comp of actor.getAllComponents()) {
      if (!(comp instanceof ColliderComponent)) continue
      actor.root.getWorldPosition(worldPos)
      // worldPos：世界坐标 = actor.root 局部 + 所有祖先的累积偏移
      // 打印 actor 自身 root.position（局部）vs worldPos（世界）
      const local = actor.root.position
      logger.info(`[SpawnPos] ColliderDraw "${actor.name}" local=[${local.x.toFixed(2)}, ${local.y.toFixed(2)}, ${local.z.toFixed(2)}] worldPos=[${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)}]`)
      worldPos.x += comp.offset[0]
      worldPos.y += comp.offset[1]
      worldPos.z += comp.offset[2]
      const color = comp.bodyType === 'static' ? COLOR_STATIC : COLOR_DYNAMIC
      if (comp instanceof BoxColliderComponent) {
        this.drawBox(worldPos, comp.size[0], comp.size[1], comp.size[2], color, tmp)
      } else if (comp instanceof CircleColliderComponent) {
        this.drawRing(worldPos, comp.radius, color, tmp, -comp.height / 2)
        this.drawRing(worldPos, comp.radius, color, tmp, comp.height / 2)
      } else if (comp instanceof CapsuleColliderComponent) {
        const half = comp.length / 2
        this.drawRing(worldPos, comp.radius, color, tmp, -half)
        this.drawRing(worldPos, comp.radius, color, tmp, half)
        this.drawVerticalEdges(worldPos, comp.radius, half, color, tmp)
      }
    }
    for (const child of actor.getChildren()) {
      this.collect(child, worldPos, tmp)
    }
  }

  // ─── 形状写入（分段 append 到顶点缓冲）───

  private push(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    if (this.vertexCount + 2 > this.capacity) this.grow()
    const i = this.vertexCount * 3
    this.positions[i] = a.x; this.positions[i + 1] = a.y; this.positions[i + 2] = a.z
    this.positions[i + 3] = b.x; this.positions[i + 4] = b.y; this.positions[i + 5] = b.z
    void color // 单色线框（材质统一颜色，不逐顶点着色）
    this.vertexCount += 2
  }

  private grow(): void {
    const newCap = this.capacity * 2
    const next = new Float32Array(newCap * 3)
    next.set(this.positions)
    this.capacity = newCap
    this.positions = next
    this.geometry.setAttribute('position', new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage))
  }

  /** 12 边线框盒（中心 + 全尺寸） */
  private drawBox(center: THREE.Vector3, sx: number, sy: number, sz: number, color: number, tmp: THREE.Vector3): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2
    // 8 顶点
    const cs: Array<[number, number, number]> = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
      [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
    ]
    const p: THREE.Vector3[] = cs.map(([x, y, z]) => tmp.clone().set(center.x + x, center.y + y, center.z + z))
    const edges: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]
    for (const [i, j] of edges) this.push(p[i], p[j], color)
  }

  /** 水平圆环（y 偏移 dy） */
  private drawRing(center: THREE.Vector3, radius: number, color: number, tmp: THREE.Vector3, dy: number): void {
    const seg = 24
    let px = center.x + radius, pz = center.z
    for (let i = 1; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2
      const nx = center.x + radius * Math.cos(t)
      const nz = center.z + radius * Math.sin(t)
      this.push(tmp.set(px, center.y + dy, pz), tmp.clone().set(nx, center.y + dy, nz), color)
      px = nx; pz = nz
    }
  }

  /** 胶囊 4 条竖边 */
  private drawVerticalEdges(center: THREE.Vector3, r: number, half: number, color: number, tmp: THREE.Vector3): void {
    const pts: Array<[number, number]> = [[r, 0], [-r, 0], [0, r], [0, -r]]
    for (const [dx, dz] of pts) {
      this.push(
        tmp.set(center.x + dx, center.y - half, center.z + dz),
        tmp.clone().set(center.x + dx, center.y + half, center.z + dz),
        color,
      )
    }
  }
}
