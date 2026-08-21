/**
 * Gizmos — 即时模式调试绘制 API（对标 Unity 的 Gizmos 类）
 *
 * 用法：Actor / Component 在 OnDrawGizmos() 中调用绘制方法，
 *   引擎每帧把累积的线段一次性渲染到场景覆盖层。
 *
 *   override OnDrawGizmos() {
 *     gizmos.color = 0x00ff00
 *     gizmos.DrawWireSphere(this.position, 2)
 *     gizmos.color = 0xff0000
 *     gizmos.DrawRay(head, dir, 3)
 *   }
 *
 * 渲染原理：所有形状最终归约为「线段」，使用单个 THREE.LineSegments +
 * 逐顶点颜色（vertexColors）一次 draw call。每帧从预分配缓冲区重建几何，
 * 对几十到几百条线段开销极低。
 */
import * as THREE from 'three'

export type GizmoColor = THREE.ColorRepresentation

// ─── 复用临时向量，避免每帧产生 GC ───
const _u = new THREE.Vector3()
const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _p = new THREE.Vector3()
const _p0 = new THREE.Vector3()

export class Gizmos {
  /** 全局开关（关闭后本帧不绘制任何内容）——修改请走 setEnabled（触发委托） */
  private _enabled = true

  /** 开关变化委托（setEnabled 时触发，各 gizmo 物体注册后自行关闭/显示） */
  private _enabledListeners = new Set<(enabled: boolean) => void>()

  /** 全局开关（只读；修改用 setEnabled） */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * 设置全局开关并通知所有委托（编辑器 Gizmos 按钮调用）。
   * 委托（TransformGizmo / AnchorGizmo 等）注册后随开关立即关闭/显示。
   */
  setEnabled(v: boolean): void {
    if (this._enabled === v) return
    this._enabled = v
    for (const cb of this._enabledListeners) {
      cb(v)
    }
  }

  /**
   * 注册开关变化委托：开关变化时触发；注册时立即以当前值回调一次（初始化即同步）。
   * @returns 取消订阅函数
   */
  onEnabledChanged(cb: (enabled: boolean) => void): () => void {
    this._enabledListeners.add(cb)
    cb(this._enabled)
    return () => {
      this._enabledListeners.delete(cb)
    }
  }

  /**
   * 主动广播当前开关状态（不改变开关值）。
   * 用于选中变化等时机：gizmo 物体新 attach/detach 后立即按当前开关刷新可见性。
   */
  refresh(): void {
    for (const cb of this._enabledListeners) {
      cb(this._enabled)
    }
  }

  /** 当前绘制颜色 */
  private _color = new THREE.Color(0xffffff)

  /** 是否穿透几何体始终可见（关闭深度测试） */
  private _alwaysOnTop = false

  // ─── 渲染对象 ───
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.LineBasicMaterial
  private readonly lines: THREE.LineSegments

  /** 顶点缓冲容量（顶点数） */
  private capacity = 8192
  private positions: Float32Array
  private colors: Float32Array
  /** 本帧已写入的顶点数 */
  private vertexCount = 0
  get lastVertexCount(): number { return this.vertexCount }

  private scene: THREE.Scene | null = null

  constructor() {
    this.positions = new Float32Array(this.capacity * 3)
    this.colors = new Float32Array(this.capacity * 3)

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    )
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage),
    )
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })

    this.lines = new THREE.LineSegments(this.geometry, this.material)
    this.lines.frustumCulled = false // 不依赖视锥剔除，确保始终绘制
    this.lines.renderOrder = 999 // 渲染顺序靠后，便于穿透模式叠加
    this.lines.visible = false
  }

  // ════════════════════════════════════════════
  //  状态
  // ════════════════════════════════════════════

  /** 当前颜色 */
  get color(): THREE.Color { return this._color }
  set color(c: GizmoColor) { this._color.set(c) }
  /** 链式设置颜色 */
  setColor(c: GizmoColor): this { this._color.set(c); return this }

  /** 是否穿透几何体始终可见 */
  get alwaysOnTop(): boolean { return this._alwaysOnTop }
  set alwaysOnTop(v: boolean) {
    this._alwaysOnTop = v
    this.material.depthTest = !v
  }

  // ════════════════════════════════════════════
  //  场景挂载（幂等）
  // ════════════════════════════════════════════

  /** 挂载到指定场景（重复挂到同一场景为空操作） */
  attach(scene: THREE.Scene) {
    this.scene = scene
    if (this.lines.parent !== scene) {
      this.lines.removeFromParent()
      scene.add(this.lines)
    }
  }

  /** 从当前场景分离 */
  detach() {
    this.lines.removeFromParent()
    this.scene = null
  }

  // ════════════════════════════════════════════
  //  帧生命周期
  // ════════════════════════════════════════════

  /** 开始一帧：清空缓冲区 */
  beginFrame() {
    this.vertexCount = 0
  }

  /** 结束一帧：上传缓冲区到 GPU；无内容则隐藏 */
  flush() {
    if (this.vertexCount > 0) {
      ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
    this.geometry.setDrawRange(0, this.vertexCount)
    this.lines.visible = this.vertexCount > 0
  }

  // ════════════════════════════════════════════
  //  底层写入
  // ════════════════════════════════════════════

  /** 写入一条线段（6 个坐标分量），自动扩容 */
  private push(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    if (this.vertexCount + 2 > this.capacity) this.grow()
    const i = this.vertexCount * 3
    const pos = this.positions
    const col = this.colors
    pos[i] = ax; pos[i + 1] = ay; pos[i + 2] = az
    pos[i + 3] = bx; pos[i + 4] = by; pos[i + 5] = bz
    const { r, g, b } = this._color
    col[i] = r; col[i + 1] = g; col[i + 2] = b
    col[i + 3] = r; col[i + 4] = g; col[i + 5] = b
    this.vertexCount += 2
  }

  /** 容量翻倍并迁移已有数据 */
  private grow() {
    const newCap = this.capacity * 2
    const newPos = new Float32Array(newCap * 3)
    const newCol = new Float32Array(newCap * 3)
    newPos.set(this.positions)
    newCol.set(this.colors)
    this.capacity = newCap
    this.positions = newPos
    this.colors = newCol
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(newPos, 3).setUsage(THREE.DynamicDrawUsage),
    )
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(newCol, 3).setUsage(THREE.DynamicDrawUsage),
    )
  }

  // ════════════════════════════════════════════
  //  绘制 API
  // ════════════════════════════════════════════

  /** 画一条线段 */
  DrawLine(a: THREE.Vector3, b: THREE.Vector3) {
    this.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }

  /** 画一条射线（origin 出发沿 dir 方向延伸 length） */
  DrawRay(origin: THREE.Vector3, dir: THREE.Vector3, length = 1) {
    this.push(
      origin.x, origin.y, origin.z,
      origin.x + dir.x * length, origin.y + dir.y * length, origin.z + dir.z * length,
    )
  }

  /** 沿一组点画折线；closed=true 时闭合 */
  DrawLines(points: THREE.Vector3[], closed = false) {
    for (let i = 0; i < points.length - 1; i++) {
      this.DrawLine(points[i], points[i + 1])
    }
    if (closed && points.length > 2) {
      this.DrawLine(points[points.length - 1], points[0])
    }
  }

  /** 画线框立方体（center 为中心，size 为完整边长） */
  DrawWireCube(center: THREE.Vector3, size: THREE.Vector3) {
    const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2
    _p0.set(center.x - hx, center.y - hy, center.z - hz)
    _p.set(center.x + hx, center.y + hy, center.z + hz)
    this.DrawWireBox(_p0, _p)
  }

  /** 画线框盒（min/max 对角） */
  DrawWireBox(min: THREE.Vector3, max: THREE.Vector3) {
    const x0 = min.x, y0 = min.y, z0 = min.z
    const x1 = max.x, y1 = max.y, z1 = max.z
    // 底面
    this.push(x0, y0, z0, x1, y0, z0)
    this.push(x1, y0, z0, x1, y0, z1)
    this.push(x1, y0, z1, x0, y0, z1)
    this.push(x0, y0, z1, x0, y0, z0)
    // 顶面
    this.push(x0, y1, z0, x1, y1, z0)
    this.push(x1, y1, z0, x1, y1, z1)
    this.push(x1, y1, z1, x0, y1, z1)
    this.push(x0, y1, z1, x0, y1, z0)
    // 竖边
    this.push(x0, y0, z0, x0, y1, z0)
    this.push(x1, y0, z0, x1, y1, z0)
    this.push(x1, y0, z1, x1, y1, z1)
    this.push(x0, y0, z1, x0, y1, z1)
  }

  /**
   * 画线框球：用三条正交大圆近似（XY / XZ / YZ 平面）。
   * 简洁高效，调试时可读性好。
   */
  DrawWireSphere(center: THREE.Vector3, radius: number, segments = 16) {
    this.drawCircle(center, _n.set(1, 0, 0), radius, segments)
    this.drawCircle(center, _n.set(0, 1, 0), radius, segments)
    this.drawCircle(center, _n.set(0, 0, 1), radius, segments)
  }

  /**
   * 画一个圆：位于以 normal 为法线、过 center 的平面，半径 radius。
   * segments 越大越圆滑。
   */
  DrawCircle(center: THREE.Vector3, normal: THREE.Vector3, radius: number, segments = 32) {
    _n.copy(normal).normalize()
    this.drawCircle(center, _n, radius, segments)
  }

  private drawCircle(center: THREE.Vector3, normal: THREE.Vector3, radius: number, segments: number) {
    // 在平面内构造两个正交基向量 u、v
    if (Math.abs(normal.y) < 0.99) {
      _u.set(0, 1, 0)
    } else {
      _u.set(0, 0, 1)
    }
    _v.crossVectors(normal, _u).normalize() // v = normal × u
    _u.crossVectors(_v, normal).normalize() // u = v × normal

    // 起点 = t=0 处的圆周点（center + radius*u），随后沿圆周逐段连接，自然闭合
    _p0.set(center.x + radius * _u.x, center.y + radius * _u.y, center.z + radius * _u.z)
    for (let i = 1; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2
      const ct = Math.cos(t), st = Math.sin(t)
      _p.set(
        center.x + radius * (ct * _u.x + st * _v.x),
        center.y + radius * (ct * _u.y + st * _v.y),
        center.z + radius * (ct * _u.z + st * _v.z),
      )
      this.push(_p0.x, _p0.y, _p0.z, _p.x, _p.y, _p.z)
      _p0.copy(_p)
    }
  }

  /**
   * 画线框网格：读取 mesh 几何的三角形边，应用 mesh 世界矩阵。
   * 不去重边；适合调试用的小网格。
   */
  DrawWireMesh(mesh: THREE.Mesh) {
    const geo = mesh.geometry
    if (!geo) return
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!posAttr) return
    mesh.updateMatrixWorld()
    const mx = mesh.matrixWorld
    const index = geo.getIndex()
    const triangleCount = index ? index.count / 3 : posAttr.count / 3

    const getVertex = (i: number, out: THREE.Vector3) => {
      out.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mx)
    }

    for (let t = 0; t < triangleCount; t++) {
      let a: number, b: number, c: number
      if (index) {
        a = index.getX(t * 3); b = index.getX(t * 3 + 1); c = index.getX(t * 3 + 2)
      } else {
        a = t * 3; b = t * 3 + 1; c = t * 3 + 2
      }
      // _u/_v/_p 分别持有三角形三个顶点（世界坐标）
      getVertex(a, _u); getVertex(b, _v); getVertex(c, _p)
      this.push(_u.x, _u.y, _u.z, _v.x, _v.y, _v.z)
      this.push(_v.x, _v.y, _v.z, _p.x, _p.y, _p.z)
      this.push(_p.x, _p.y, _p.z, _u.x, _u.y, _u.z)
    }
  }
}

/**
 * 全局 Gizmos 单例（对标 Unity 的静态 Gizmos 类）。
 * 由 World/Viewport 负责挂载与每帧 flush，业务代码只需调用绘制方法。
 */
export const gizmos = new Gizmos()
