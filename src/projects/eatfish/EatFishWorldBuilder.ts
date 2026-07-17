/**
 * EatFishWorldBuilder — 大鱼吃小鱼水下场景构建器
 * 创建水下竞技场：水面、海底、装饰物
 */
import * as THREE from 'three'
import type { WorldBuilder, WorldBuildConfig, WorldAsset } from '@/engine'
import { ConfigRegistry } from '@/engine'
import type { GameConfig } from './types'

export class EatFishWorldBuilder implements WorldBuilder {
  readonly name = 'EatFish'

  async build(_config: WorldBuildConfig): Promise<WorldAsset> {
    const group = new THREE.Group()
    group.name = 'EatFishArena'

    const half = ConfigRegistry.getConfig<GameConfig>('eatfish').arenaHalf

    // ─── 海底（半透明蓝色平面） ───
    const floorGeo = new THREE.PlaneGeometry(half * 2, half * 2)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a3d6b,
      roughness: 0.8,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.1, 0)
    floor.receiveShadow = true
    group.add(floor)

    // ─── 海水雾效和背景色由 Scene 全局设置 ───

    // ─── 边界柱子 ───
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1a5276,
      roughness: 0.6,
      metalness: 0.3,
      transparent: true,
      opacity: 0.5,
    })
    const pillarPositions = [
      [-half, 0, -half], [half, 0, -half],
      [-half, 0, half], [half, 0, half],
    ]
    for (const [px, py, pz] of pillarPositions) {
      const pillarGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 8)
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(px as number, py as number + 1, pz as number)
      group.add(pillar)
    }

    // ─── 海草装饰 ───
    const seaweedMat = new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    })

    for (let i = 0; i < 20; i++) {
      const sx = (Math.random() - 0.5) * (half * 2 - 4)
      const sz = (Math.random() - 0.5) * (half * 2 - 4)
      const height = 0.5 + Math.random() * 1.0

      const seaweedGeo = new THREE.CylinderGeometry(0.02, 0.05, height, 4)
      const seaweed = new THREE.Mesh(seaweedGeo, seaweedMat)
      seaweed.position.set(sx, height / 2, sz)
      seaweed.rotation.z = (Math.random() - 0.5) * 0.3
      seaweed.rotation.x = (Math.random() - 0.5) * 0.3
      group.add(seaweed)

      // 海草叶子
      const leafMat = new THREE.MeshStandardMaterial({
        color: 0x388e3c,
        roughness: 0.6,
        metalness: 0.0,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      })
      for (let j = 0; j < 3; j++) {
        const leafGeo = new THREE.PlaneGeometry(0.15, 0.2)
        const leaf = new THREE.Mesh(leafGeo, leafMat)
        leaf.position.set(
          (Math.random() - 0.5) * 0.2,
          height * (0.3 + j * 0.25),
          (Math.random() - 0.5) * 0.1,
        )
        leaf.rotation.y = Math.random() * Math.PI
        leaf.rotation.x = (Math.random() - 0.5) * 0.5
        seaweed.add(leaf)
      }
    }

    // ─── 岩石装饰 ───
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.9,
      metalness: 0.1,
    })
    for (let i = 0; i < 8; i++) {
      const rx = (Math.random() - 0.5) * (half * 2 - 6)
      const rz = (Math.random() - 0.5) * (half * 2 - 6)
      const rSize = 0.2 + Math.random() * 0.4

      const rockGeo = new THREE.DodecahedronGeometry(rSize)
      const rock = new THREE.Mesh(rockGeo, rockMat)
      rock.position.set(rx, rSize * 0.3, rz)
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
      group.add(rock)
    }

    // ─── 水面光斑粒子（装饰） ───
    const particleCount = 100
    const particleGeo = new THREE.BufferGeometry()
    const particlePos = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      particlePos[i * 3] = (Math.random() - 0.5) * half * 2
      particlePos[i * 3 + 1] = 0.8 + Math.random() * 0.5
      particlePos[i * 3 + 2] = (Math.random() - 0.5) * half * 2
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3))
    const particleMat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.05,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    })
    const particles = new THREE.Points(particleGeo, particleMat)
    particles.name = 'caustics'
    group.add(particles)

    return {
      group,
      name: 'EatFish',
      dispose() {
        // 清理所有几何和材质
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material?.dispose()
            }
          }
          if (child instanceof THREE.Points) {
            child.geometry?.dispose()
            child.material?.dispose()
          }
        })
      },
    }
  }
}
