/**
 * ScenePreviewManager — 场景资产 3D 预览
 *
 * 为场景预览编辑器提供专用 3D 视口，自由漫游控制：
 *  - 左键旋转视角 · 右键平移 · 滚轮前进/后退
 *  - WASD 移动 · Q/E 升降
 *
 * 特性：
 *  - 独立的 THREE.Scene（默认光照 + 网格地面）
 *  - 专用 WebGLRenderer
 *  - 通过 loadScene 加载场景资产并将网格生成为 GenericActor + MeshComponent
 *  - 自动清理（dispose）
 */
import * as THREE from 'three'
import { World } from '../engine'
import { logger } from '../engine'
import { loadScene } from '../engine'
import { GenericActor, MeshComponent } from '../engine'
import type { SceneAsset } from '../engine'

export class ScenePreviewManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0

  // ─── Fly 自由漫游 ───
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private isLeftDown = false
  private isRightDown = false
  private prevMouseX = 0
  private prevMouseY = 0
  private flySensitivity = 0.0015

  // ─── WASD ───
  private wasdEnabled = true
  private wasdKeys = new Set<string>()
  private wasdSpeed = 8

  constructor(container: HTMLElement) {
    this.container = container

    // ─── 渲染器 ───
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // ─── 场景 ───
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 摄像机 ───
    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200)
    this.camera.position.set(5, 4, 5)
    this.camera.lookAt(0, 0, 0)

    // ─── 输入 ───
    this.initFlyEuler()
    this.setupFlyMouse()

    // ─── World ───
    this.world = new World(this.scene)

    // ─── 默认内容 ───
    this.setupLighting()
    this.setupHelpers()

    // ─── 启动渲染循环 ───
    this.start()
  }

  /** 处理 WASD 按键按下 */
  onWASDKeyDown(key: string) {
    this.wasdKeys.add(key.toLowerCase())
  }

  /** 处理 WASD 按键释放 */
  onWASDKeyUp(key: string) {
    this.wasdKeys.delete(key.toLowerCase())
  }

  /** 清除所有按键状态 */
  clearWASDKeys() {
    this.wasdKeys.clear()
  }

  // ════════════════════════════════════════
  //  输入初始化
  // ════════════════════════════════════════

  private initFlyEuler() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.euler.setFromQuaternion(this.camera.quaternion)
    this.euler.order = 'YXZ'
  }

  private setupFlyMouse() {
    const canvas = this.renderer.domElement

    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isLeftDown = true
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
      if (e.button === 2) {
        this.isRightDown = true
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isLeftDown && !this.isRightDown) return

      const dx = e.clientX - this.prevMouseX
      const dy = e.clientY - this.prevMouseY
      this.prevMouseX = e.clientX
      this.prevMouseY = e.clientY

      if (this.isLeftDown) {
        // 左键拖拽: 旋转摄像机自身
        this.euler.y -= dx * this.flySensitivity
        this.euler.x -= dy * this.flySensitivity
        this.euler.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.euler.x))
        this.camera.quaternion.setFromEuler(this.euler)
      }

      if (this.isRightDown) {
        // 右键拖拽: 在当前朝向垂直平面上平移
        const dir = new THREE.Vector3()
        this.camera.getWorldDirection(dir)
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
        const up = new THREE.Vector3().crossVectors(right, dir).normalize()
        const panSpeed = 0.03
        this.camera.position.addScaledVector(right, -dx * panSpeed)
        this.camera.position.addScaledVector(up, dy * panSpeed)
      }
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.isLeftDown = false
      if (e.button === 2) this.isRightDown = false
    })

    // 滚轮: 前进/后退
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.camera.position.addScaledVector(dir, -e.deltaY * 0.02)
    }, { passive: false })
  }

  // ════════════════════════════════════════
  //  光照 & 辅助
  // ════════════════════════════════════════

  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    this.scene.add(ambient)

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.5)
    this.scene.add(hemi)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(10, 15, 8)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    this.scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4)
    fillLight.position.set(-5, 10, -8)
    this.scene.add(fillLight)
  }

  private setupHelpers() {
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  // ════════════════════════════════════════
  //  场景资产加载
  // ════════════════════════════════════════

  /** 加载并预览场景资产 */
  loadSceneAsset(sceneData: SceneAsset): boolean {
    this.clearPreview()

    const result = loadScene(sceneData)
    const meshes: THREE.Mesh[] = []
    result.group.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node)
    })
    for (const mesh of meshes) {
      result.group.remove(mesh)
      const actor = new GenericActor(`Preview_${mesh.name || ''}`)
      actor.addComponent(new MeshComponent(actor, mesh))
      this.world.SpawnActor(actor)
    }
    // 应用 skybox
    if (result.skybox) {
      if (result.skybox.backgroundColor) {
        this.scene.background = new THREE.Color(result.skybox.backgroundColor)
      }
      if (result.skybox.fogColor) {
        this.scene.fog = new THREE.Fog(
          result.skybox.fogColor,
          result.skybox.fogNear ?? 30,
          result.skybox.fogFar ?? 60,
        )
      }
    }

    this.world.BeginPlay()
    this.world.manualTick(0)

    // 聚焦
    this.fitToScene(result.group)

    logger.info(`[ScenePreview] 加载场景预览: ${sceneData.name}, ${meshes.length} 个网格`)
    return true
  }

  clearPreview() {
    this.world.DestroyAllActors()
  }

  private fitToScene(group: THREE.Group) {
    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    if (size.length() < 0.01) {
      this.camera.position.set(5, 4, 5)
      this.camera.lookAt(0, 0, 0)
      return
    }

    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2.5 + 2

    this.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.6)
    this.camera.lookAt(center)
    this.initFlyEuler()
  }

  // ════════════════════════════════════════
  //  生命周期
  // ════════════════════════════════════════

  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      // WASD 漫游
      this.updateWASD(dt)

      this.renderer.render(this.scene, this.camera)
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    this.world.DestroyAllActors()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  // ════════════════════════════════════════
  //  WASD 漫游
  // ════════════════════════════════════════

  private updateWASD(dt: number) {
    if (this.wasdKeys.size === 0) return

    const speed = this.wasdSpeed * dt
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)

    if (this.wasdKeys.has('w')) this.camera.position.addScaledVector(forward, speed)
    if (this.wasdKeys.has('s')) this.camera.position.addScaledVector(forward, -speed)
    if (this.wasdKeys.has('a')) this.camera.position.addScaledVector(right, -speed)
    if (this.wasdKeys.has('d')) this.camera.position.addScaledVector(right, speed)
    if (this.wasdKeys.has('q')) this.camera.position.addScaledVector(worldUp, -speed)
    if (this.wasdKeys.has('e')) this.camera.position.addScaledVector(worldUp, speed)
  }
}
