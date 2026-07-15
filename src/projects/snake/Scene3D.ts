/**
 * 贪吃蛇 3D 场景构建
 * 使用 Three.js 创建棋盘格地板、围墙、柱子等
 * 实现 WorldBuilder 接口，支持通过 WorldRegistry 注册
 */
import * as THREE from 'three'
import type { WorldBuilder, WorldBuildConfig, WorldAsset } from '@/engine'

export class SnakeScene3D implements WorldBuilder {
  public group: THREE.Group
  private meshes: THREE.Mesh[] = []

  constructor() {
    this.group = new THREE.Group()
  }

  build(config: WorldBuildConfig): WorldAsset {
    const gridSize = (config.gridSize ?? 20) as number
    const half = gridSize / 2

    // 地基
    this.addBox(gridSize + 1, 0.3, gridSize + 1, 0, -0.15, 0, 0x2a2a3a)
    // 主地板
    this.addBox(gridSize, 0.2, gridSize, 0, 0, 0, 0x3a3a4a)

    // 棋盘格地板
    const colors = [0x4a4a5a, 0x5a5a6a]
    for (let x = -half; x < half; x++) {
      for (let z = -half; z < half; z++) {
        const idx = (Math.round(x) + Math.round(z)) % 2
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(0.96, 0.96),
          new THREE.MeshStandardMaterial({
            color: colors[Math.abs(idx)],
            roughness: 0.8,
            metalness: 0.1,
          })
        )
        tile.rotation.x = -Math.PI / 2
        tile.position.set(x + 0.5, 0.02, z + 0.5)
        tile.receiveShadow = true
        this.group.add(tile)
        this.meshes.push(tile)
      }
    }

    // 网格线
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0x444466,
      transparent: true,
      opacity: 0.15,
    })
    for (let i = -half; i <= half; i++) {
      const hLine = new THREE.Mesh(new THREE.PlaneGeometry(0.02, gridSize), lineMat)
      hLine.rotation.x = -Math.PI / 2
      hLine.position.set(0, 0.025, i)
      this.group.add(hLine)
      this.meshes.push(hLine)

      const vLine = new THREE.Mesh(new THREE.PlaneGeometry(gridSize, 0.02), lineMat)
      vLine.rotation.x = -Math.PI / 2
      vLine.position.set(i, 0.025, 0)
      this.group.add(vLine)
      this.meshes.push(vLine)
    }

    // 四角柱子
    const pillarPositions = [
      [-half, -half],
      [-half, half],
      [half, -half],
      [half, half],
    ]
    for (const [px, pz] of pillarPositions) {
      this.addBox(0.5, 5, 0.5, px as number, 2.5, pz as number, 0x5599dd)
      this.addBox(0.7, 0.15, 0.7, px as number, 5, pz as number, 0x77bbff)

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x64b4ff })
      )
      sphere.position.set(px as number, 5.3, pz as number)
      this.group.add(sphere)
      this.meshes.push(sphere)
    }

    // 围墙
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x336699,
      roughness: 0.6,
      metalness: 0.2,
    })
    const wallCapMat = new THREE.MeshStandardMaterial({
      color: 0x5588bb,
      roughness: 0.5,
      metalness: 0.3,
    })
    const wallH = 1.2

    for (const z of [-half, half]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(gridSize, wallH, 0.3), wallMat)
      wall.position.set(0, wallH / 2, z)
      wall.castShadow = true
      this.group.add(wall)
      this.meshes.push(wall)

      const cap = new THREE.Mesh(new THREE.BoxGeometry(gridSize - 0.1, 0.08, 0.35), wallCapMat)
      cap.position.set(0, wallH, z)
      this.group.add(cap)
      this.meshes.push(cap)
    }
    for (const x of [-half, half]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, wallH, gridSize), wallMat)
      wall.position.set(x, wallH / 2, 0)
      wall.castShadow = true
      this.group.add(wall)
      this.meshes.push(wall)

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, gridSize - 0.1), wallCapMat)
      cap.position.set(x, wallH, 0)
      this.group.add(cap)
      this.meshes.push(cap)
    }

    return { group: this.group, name: 'Snake', dispose: () => this.dispose() }
  }

  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
    const geo = new THREE.BoxGeometry(w, h, d)
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this.meshes.push(mesh)
    return mesh
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose())
      } else {
        mesh.material.dispose()
      }
    }
    this.meshes = []
    this.group.clear()
  }
}
