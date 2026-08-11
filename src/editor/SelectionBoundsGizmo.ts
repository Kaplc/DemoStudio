/**
 * SelectionBoundsGizmo — UI 节点选中范围 gizmo（独立于编辑器视口的通用模块）
 *
 * 选中 UI 节点时显示：
 *  - 青色（#00e5ff）线框包围盒（可复用 BoxHelper 风格的顶点更新）
 *  - 8 个圆形把手（4 角 TL/TR/BL/BR + 4 边中点 T/R/B/L）
 *  - 尺寸标签（"W × H"）放在右上角外侧
 * 全部挂在指定 scene（游戏运行时为 UI 场景，由 UICamera 渲染）。
 *
 * 设计理念与 UIPreviewManager 内部的 boundsHelper/cornerHandles/boundsLabel 一致，
 * 但抽到独立类，使游戏运行时（UI 大纲点击）也能复用，无需 UIPreviewManager 介入。
 *
 * 注意：所有物体 z 设在 ≈ 0，匹配 UI 节点平面（UICamera 看向 z=0）。
 */
import * as THREE from 'three'
import type { Actor } from '../engine/entity/Actor'
import { UITransformComponent } from '../engine/ui/UITransformComponent'
import { gizmos } from '../engine'

/** 把手屏幕直径换算基准（与 UIPreviewManager 一致）：角 2.5，边 1.75（单位 px，缩放后是几何直径） */
const HANDLE_PX = [2.5, 2.5, 2.5, 2.5, 1.75, 1.75, 1.75, 1.75]

export class SelectionBoundsGizmo {
  readonly group: THREE.Group
  /** 青色包围盒线框（BoxHelper 直接复用顶点更新接口） */
  private boundsHelper: THREE.BoxHelper
  /** 尺寸标签 sprite */
  private boundsLabel: THREE.Sprite
  /** 8 个圆形把手（4 角 + 4 边中点） */
  private cornerHandles: THREE.Mesh[] = []
  /** 标签画布 + 上下文（绘制 "W × H"） */
  private labelCanvas: HTMLCanvasElement
  private labelCtx: CanvasRenderingContext2D

  private _target: Actor | null = null
  private _unsubGizmosToggle: (() => void) | null = null

  /** 是否显示 8 个拖拽把手（Game 窗口 = false：不可编辑；UIScene 页签 = true：可编辑） */
  private _showHandles = false

  // 复用临时向量（避免每帧分配）
  private _tmpBox = new THREE.Box3()
  private _tmpSize = new THREE.Vector3()
  private _tmpCenter = new THREE.Vector3()
  private _tmpVec = new THREE.Vector3()

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'SelectionBoundsGizmo'
    this.group.visible = false
    this.group.renderOrder = 998

    // 包围盒线框
    this.boundsHelper = new THREE.BoxHelper(new THREE.Object3D(), 0x00e5ff)
    const mat = this.boundsHelper.material as THREE.LineBasicMaterial
    mat.depthTest = false
    mat.depthWrite = false
    mat.transparent = true
    mat.opacity = 0.8
    this.boundsHelper.renderOrder = 998
    this.group.add(this.boundsHelper)

    // 标签画布（与 UIPreviewManager 一致）
    this.labelCanvas = document.createElement('canvas')
    this.labelCanvas.width = 256
    this.labelCanvas.height = 96
    this.labelCtx = this.labelCanvas.getContext('2d')!
    const tex = new THREE.CanvasTexture(this.labelCanvas)
    const labelMat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    this.boundsLabel = new THREE.Sprite(labelMat)
    this.boundsLabel.renderOrder = 998
    this.group.add(this.boundsLabel)

    // 8 个把手（仅 _showHandles=true 时推动显示与位置；Game 窗口置 false 关闭）
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.CircleGeometry(1, 24)
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, m)
      mesh.renderOrder = 999
      mesh.visible = false
      this.group.add(mesh)
      this.cornerHandles.push(mesh)
    }

    // 全局 gizmos 开关跟随
    this._unsubGizmosToggle = gizmos.onEnabledChanged((v) => {
      if (this._target) this.group.visible = v
    })
  }

  /** 是否显示 8 个拖拽把手（关闭时仅显示范围框，Game 窗口用于不可编辑的可视化） */
  setShowHandles(v: boolean): void {
    this._showHandles = v
    if (!v) for (const h of this.cornerHandles) h.visible = false
  }

  /** 挂载目标 actor（显示范围框） */
  attach(actor: Actor): void {
    this._target = actor
    this.group.visible = gizmos.enabled
    this.update(0)
  }

  /** 分离（隐藏） */
  detach(): void {
    this._target = null
    this.group.visible = false
  }

  get visible(): boolean {
    return this.group.visible
  }

  /**
   * 每帧更新（在 SelectionManager 渲染循环调用）：跟随目标位置/尺寸。
   * @param worldPerPx 当前 zoom 下 1px 对应的世界距离（把手屏幕恒定尺寸）
   */
  update(worldPerPx: number): void {
    const actor = this._target
    // 防御：worldPerPx 非有限值（如隐藏视口 clientHeight=0 → Infinity）时跳过，避免把手/标签位置变 Infinity
    if (!actor || !isFinite(worldPerPx) || worldPerPx <= 0) {
      this.boundsHelper.visible = false
      this.boundsLabel.visible = false
      for (const h of this.cornerHandles) h.visible = false
      return
    }
    const box = this.computeBoundsBox(actor, this._tmpBox)
    if (!box) {
      this.boundsHelper.visible = false
      this.boundsLabel.visible = false
      for (const h of this.cornerHandles) h.visible = false
      return
    }

    // 更新 BoxHelper 顶点
    this.applyBox(this.boundsHelper, box)
    this.boundsHelper.visible = true

    // 更新尺寸标签
    box.getSize(this._tmpSize)
    box.getCenter(this._tmpCenter)
    this.updateLabel(this._tmpSize.x, this._tmpSize.y)
    const labelScale = 1.2
    const cw = this.labelCanvas.width
    const ch = this.labelCanvas.height
    this.boundsLabel.scale.set(cw / 96 * labelScale * 0.12, ch / 96 * labelScale * 0.12, 1)
    this.boundsLabel.position.set(box.max.x + 0.3, box.max.y + 0.25, 0.01)
    this.boundsLabel.visible = true

    // 更新把手位置 + 屏幕 size（仅可编辑模式显示；Game 窗口等只读模式跳过）
    if (!this._showHandles) return
    const cx = (box.min.x + box.max.x) / 2
    const cy = (box.min.y + box.max.y) / 2
    const pts: [number, number][] = [
      [box.min.x, box.max.y], [box.max.x, box.max.y],
      [box.min.x, box.min.y], [box.max.x, box.min.y],
      [cx, box.max.y], [box.max.x, cy],
      [cx, box.min.y], [box.min.x, cy],
    ]
    for (let i = 0; i < this.cornerHandles.length; i++) {
      const h = this.cornerHandles[i]
      const [hx, hy] = pts[i]
      const radius = HANDLE_PX[i] * worldPerPx
      h.visible = true
      h.position.set(hx, hy, 0.02)
      h.scale.setScalar(radius)
    }
  }

  /**
   * 计算目标 actor 的范围 box（统一以 uitransform worldWidth/worldHeight 矩形为基准，
   * 子节点嵌套时用世界坐标）。
   */
  private computeBoundsBox(actor: Actor, out: THREE.Box3): THREE.Box3 | null {
    const root = actor.root
    const uiTf = actor.getComponent(UITransformComponent)
    if (uiTf) {
      const [ww, wh] = uiTf.getWorldSize()
      if (ww > 0 && wh > 0) {
        // 子节点 root.position 是局部坐标；嵌套时父节点移动后局部≠世界 → 用世界位置
        root.updateWorldMatrix(true, true)
        const p = root.getWorldPosition(this._tmpVec)
        out.min.set(p.x - ww / 2, p.y - wh / 2, -1)
        out.max.set(p.x + ww / 2, p.y + wh / 2, 1)
        return out
      }
    }
    // 无 uitransform：退化用几何包围盒
    out.setFromObject(root)
    if (!isFinite(out.min.x) || out.isEmpty()) return null
    return out
  }

  /** 按 BoxHelper 内部顶点顺序写入 box（min/max） */
  private applyBox(helper: THREE.BoxHelper, box: THREE.Box3): void {
    const position = helper.geometry.attributes.position as THREE.BufferAttribute
    const a = position.array as Float32Array
    const min = box.min, max = box.max
    a[0] = max.x; a[1] = max.y; a[2] = max.z
    a[3] = min.x; a[4] = max.y; a[5] = max.z
    a[6] = min.x; a[7] = min.y; a[8] = max.z
    a[9] = max.x; a[10] = min.y; a[11] = max.z
    a[12] = max.x; a[13] = max.y; a[14] = min.z
    a[15] = min.x; a[16] = max.y; a[17] = min.z
    a[18] = min.x; a[19] = min.y; a[20] = min.z
    a[21] = max.x; a[22] = min.y; a[23] = min.z
    position.needsUpdate = true
    helper.geometry.computeBoundingSphere()
  }

  /** 绘制尺寸标签 */
  private updateLabel(w: number, h: number): void {
    const ctx = this.labelCtx
    const cw = this.labelCanvas.width
    const ch = this.labelCanvas.height
    ctx.clearRect(0, 0, cw, ch)
    const text = `${w.toFixed(2)} × ${h.toFixed(2)}`
    ctx.font = 'bold 40px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const tw = ctx.measureText(text).width
    ctx.fillRect(cw / 2 - tw / 2 - 14, ch / 2 - 26, tw + 28, 52)
    ctx.fillStyle = '#00e5ff'
    ctx.fillText(text, cw / 2, ch / 2)
    ;(this.boundsLabel.material.map as THREE.CanvasTexture).needsUpdate = true
  }

  /** 释放资源 */
  dispose(): void {
    this._unsubGizmosToggle?.()
    this._unsubGizmosToggle = null
    this.detach()
    this.group.removeFromParent()
    this.boundsHelper.geometry.dispose()
    ;(this.boundsHelper.material as THREE.Material).dispose()
    ;(this.boundsLabel.material.map as THREE.CanvasTexture | null)?.dispose()
    ;(this.boundsLabel.material as THREE.SpriteMaterial).dispose()
    for (const h of this.cornerHandles) {
      h.geometry.dispose()
      ;(h.material as THREE.Material).dispose()
    }
    this.cornerHandles = []
  }
}
