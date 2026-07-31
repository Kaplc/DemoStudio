/**
 * Compositor2D — 同一渲染器上的 2D 叠加合成层
 *
 * 在已有的 THREE.WebGLRenderer 上叠加渲染第二个摄像机的画面，
 * 用于实现 3D 场景之上的 2D UI 面板层（小地图、任务指引、HUD 面板）。
 *
 * 原理：
 *   1. 主场景正常渲染（透视/正交相机）
 *   2. 切换到 2D 覆盖层相机（正交，屏幕空间 -1..1）
 *   3. 清空 depth buffer，不清空 color buffer
 *   4. 渲染 2D 叠加层（永远在 3D 场景之上）
 *
 * 用法：
 *   const comp = new Compositor2D(sceneMgr.renderer)
 *   sceneMgr.onAfterRender(() => comp.render())
 *   // 添加 2D 元素
 *   comp.scene.add(my2DMesh)
 */
import * as THREE from 'three'

export class Compositor2D {
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera

  private renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer

    // 2D 叠加场景（独立的场景图，与主场景完全分离）
    this.scene = new THREE.Scene()

    // 正交相机：屏幕空间 NDC (-1..1)，z=0 为叠加平面
    // left=-1, right=1, bottom=-1, top=1, near=0, far=1
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.camera.position.set(0, 0, 1)
    this.camera.lookAt(0, 0, 0)
  }

  /** 执行叠加渲染（在主场景渲染完成后调用） */
  render(): void {
    if (this.scene.children.length === 0) return

    // 保存当前 autoClear 状态并设置为 false
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false

    // 只清除深度缓冲，保留主场景的颜色缓冲
    this.renderer.clearDepth()

    // 切换到覆盖层相机渲染
    this.renderer.render(this.scene, this.camera)

    // 恢复 autoClear
    this.renderer.autoClear = prevAutoClear
  }

  /**
   * 在 NDC 屏幕空间添加一个 2D 面板。
   * @param width  宽度（NDC 单位，1=半个屏幕宽）
   * @param height 高度（NDC 单位）
   * @param x      中心 X（NDC，-1..1）
   * @param y      中心 Y（NDC，-1..1）
   */
  createPanel(width: number, height: number, x = 0, y = 0): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(width, height)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,  // 始终在顶层，不受 3D 深度影响
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, 0)
    this.scene.add(mesh)
    return mesh
  }

  /**
   * 在 NDC 屏幕空间添加一段文字（通过 CanvasTexture 实现）。
   * 返回 mesh，可通过 mesh.position 定位，或后续用 textMesh.userData 更新文字。
   */
  createText(
    text: string,
    options: {
      fontSize?: number
      color?: string
      width?: number
      height?: number
    } = {},
  ): THREE.Mesh {
    const w = options.width ?? 256
    const h = options.height ?? 64
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = options.color ?? '#ffffff'
    ctx.font = `${options.fontSize ?? 24}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter

    const ndcW = (w / h) * 0.3  // 按宽高比换算 NDC 宽度
    const ndcH = 0.3
    const geo = new THREE.PlaneGeometry(ndcW, ndcH)
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0, 0)
    this.scene.add(mesh)
    return mesh
  }

  /** 清除所有 2D 元素 */
  clear(): void {
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0]
      this.scene.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }
  }

  dispose(): void {
    this.clear()
  }
}
