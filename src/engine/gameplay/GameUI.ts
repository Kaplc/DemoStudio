/**
 * GameUI — 游戏 UI 覆盖层渲染系统
 * 使用正交摄像机 + 独立场景渲染游戏 UI 元素
 * 通过 CanvasTexture 生成文字，支持计分牌、GameOver 等
 */
import * as THREE from 'three'

export interface GameUIElement {
  readonly object: THREE.Object3D
  setText(text: string): void
  setPosition(x: number, y: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export class GameUI {
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera

  private elements: GameUIElement[] = []

  /** UI 可视宽高（像素坐标系） */
  private width: number
  private height: number

  constructor(width = 480, height = 360) {
    this.width = width
    this.height = height

    this.camera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      height / 2, -height / 2,
      0.1, 100,
    )
    this.camera.position.z = 10

    this.scene = new THREE.Scene()
    this.scene.background = null // 透明
  }

  /** 更新 UI 尺寸（与游戏视口同步） */
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.camera.left = -width / 2
    this.camera.right = width / 2
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.updateProjectionMatrix()
  }

  /** 创建一个文字 UI 元素 */
  createText(options: {
    text?: string
    x?: number
    y?: number
    fontSize?: number
    color?: string
    fontFamily?: string
  } = {}): GameUIElement {
    const {
      text = '',
      x = 0,
      y = 0,
      fontSize = 28,
      color = '#ffffff',
      fontFamily = 'monospace',
    } = options

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    canvas.width = 512
    canvas.height = 128

    // 初始纹理
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    // Sprite 大小基于 UI 坐标
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(Math.max(text.length, 1) * fontSize * 0.6, fontSize * 1.2, 1)
    sprite.position.set(x, y, 0)
    sprite.renderOrder = 999

    const updateTexture = (t: string) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = color
      ctx.fillText(t, canvas.width / 2, canvas.height / 2)
      sprite.material.map = new THREE.CanvasTexture(canvas)
      sprite.material.map.needsUpdate = true
      // 更新 Sprite 宽度
      sprite.scale.x = Math.max(t.length, 1) * fontSize * 0.6
    }

    const element: GameUIElement = {
      object: sprite,
      setText(t: string) { updateTexture(t) },
      setPosition(px: number, py: number) { sprite.position.set(px, py, 0) },
      setVisible(v: boolean) { sprite.visible = v },
      dispose() {
        sprite.geometry?.dispose()
        sprite.material.dispose()
      },
    }

    this.scene.add(sprite)
    this.elements.push(element)
    return element
  }

  /** 渲染 UI 覆盖层（由外部在每帧调用） */
  render(renderer: THREE.WebGLRenderer) {
    // 只清除深度缓冲，保留主场景颜色
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
  }

  /** 销毁所有 UI 元素 */
  dispose() {
    for (const el of this.elements) {
      el.dispose()
    }
    this.elements = []
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0]
      this.scene.remove(child)
    }
  }
}
