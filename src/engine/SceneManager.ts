/**
 * DemoStudio Three.js 引擎核心
 * 封装场景、摄像机、渲染器管理
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class SceneManager {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  public controls: OrbitControls
  private animationId: number | null = null
  private lastTime = 0
  private updateCallbacks: Array<(dt: number) => void> = []

  constructor(container: HTMLElement) {
    // ─── 渲染器 ───
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x1a1a2e, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // ─── 场景 ───
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)
    this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 60)

    // ─── 摄像机 ───
    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 200)
    this.camera.position.set(15, 20, 15)
    this.camera.lookAt(0, 0, 0)

    // ─── 轨道控制 ───
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 5
    this.controls.maxDistance = 80
    this.controls.maxPolarAngle = Math.PI / 2.1
    this.controls.target.set(0, 0, 0)
    this.controls.update()

    // ─── 基础光照 ───
    this.setupLighting()

    // ─── 辅助工具 ───
    this.setupHelpers()

    // ─── 窗口 Resize ───
    window.addEventListener('resize', () => this.handleResize(container))
  }

  private setupLighting() {
    // 环境光
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)

    // 半球光
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.4)
    this.scene.add(hemi)

    // 主方向光
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(20, 30, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.camera.near = 1
    dirLight.shadow.camera.far = 60
    dirLight.shadow.camera.left = -25
    dirLight.shadow.camera.right = 25
    dirLight.shadow.camera.top = 25
    dirLight.shadow.camera.bottom = -25
    this.scene.add(dirLight)

    // 补光
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3)
    fillLight.position.set(-10, 15, -10)
    this.scene.add(fillLight)
  }

  private setupHelpers() {
    // 网格地面
    const grid = new THREE.GridHelper(40, 40, 0x444466, 0x333355)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  private handleResize(container: HTMLElement) {
    const width = container.clientWidth
    const height = container.clientHeight
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  // ─── 动画循环 ───

  start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.controls.update()

      // 执行更新回调
      for (const cb of this.updateCallbacks) {
        cb(dt)
      }

      this.renderer.render(this.scene, this.camera)
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  onUpdate(callback: (dt: number) => void) {
    this.updateCallbacks.push(callback)
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter((cb) => cb !== callback)
    }
  }

  // ─── 场景道具 ───

  addObject(object: THREE.Object3D) {
    this.scene.add(object)
  }

  removeObject(object: THREE.Object3D) {
    this.scene.remove(object)
  }

  clearScene() {
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0]
      if (child.type === 'Scene' || child.type === 'PerspectiveCamera') {
        // 跳过场景和摄像机
        this.scene.children.shift()
        continue
      }
      this.scene.remove(child)
    }
    // 重新添加基础元素
    this.setupLighting()
    this.setupHelpers()
  }

  // ─── 摄像机预设 ───

  setCameraOrbit(azimuth: number, elevation: number, distance: number) {
    const theta = (azimuth * Math.PI) / 180
    const phi = (elevation * Math.PI) / 180
    this.camera.position.set(
      distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
      distance * Math.cos(phi) * Math.cos(theta)
    )
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  // ─── 清理 ───

  dispose() {
    this.stop()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
