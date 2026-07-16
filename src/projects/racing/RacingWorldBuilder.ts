/**
 * RacingWorldBuilder — 赛车赛道场景构建器
 * 创建环形赛道：路面、草地、护栏、装饰
 */
import * as THREE from 'three'
import type { WorldBuilder, WorldBuildConfig, WorldAsset } from '@/engine'
import { DEFAULT_CONFIG } from './types'

export class RacingWorldBuilder implements WorldBuilder {
  readonly name = 'Racing'

  async build(_config: WorldBuildConfig): Promise<WorldAsset> {
    const group = new THREE.Group()
    group.name = 'RacingTrack'

    const r = DEFAULT_CONFIG.trackRadius
    const halfW = DEFAULT_CONFIG.trackWidth / 2
    const segments = DEFAULT_CONFIG.trackSegments

    // ─── 地面 (草地) ───
    const groundGeo = new THREE.PlaneGeometry(80, 80)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a9e4a,
      roughness: 0.9,
      metalness: 0.0,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, -0.01, 0)
    ground.receiveShadow = true
    group.add(ground)

    // ─── 赛道路面 (环形) ───
    // 使用多个扇形分段拼成圆环
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.7,
      metalness: 0.2,
    })

    const roadInner = r - halfW
    const roadOuter = r + halfW

    for (let i = 0; i < segments; i++) {
      const angle1 = (Math.PI * 2 / segments) * i
      const angle2 = (Math.PI * 2 / segments) * (i + 1)

      // 每个分段是一个梯形路面片
      const shape = new THREE.Shape()
      const inner1 = { x: Math.cos(angle1) * roadInner, z: Math.sin(angle1) * roadInner }
      const outer1 = { x: Math.cos(angle1) * roadOuter, z: Math.sin(angle1) * roadOuter }
      const inner2 = { x: Math.cos(angle2) * roadInner, z: Math.sin(angle2) * roadInner }
      const outer2 = { x: Math.cos(angle2) * roadOuter, z: Math.sin(angle2) * roadOuter }

      shape.moveTo(inner1.x, inner1.z)
      shape.lineTo(outer1.x, outer1.z)
      shape.lineTo(outer2.x, outer2.z)
      shape.lineTo(inner2.x, inner2.z)
      shape.closePath()

      const points = shape.getPoints(4)
      const roadGeo = new THREE.BufferGeometry().setFromPoints(
        points.map(p => new THREE.Vector3(p.x, 0.01, p.y))
      )
      // 用平面几何体展现
      const roadShapeGeo = new THREE.ShapeGeometry(shape)
      const roadSegment = new THREE.Mesh(roadShapeGeo, roadMat)
      roadSegment.rotation.x = -Math.PI / 2
      roadSegment.position.y = 0.01
      roadSegment.receiveShadow = true
      group.add(roadSegment)
    }

    // ─── 赛道边线 (白色) ───
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.5, metalness: 0.0,
    })
    // 内外圈边线
    for (const radius of [roadInner + 0.1, roadOuter - 0.1]) {
      const linePoints: THREE.Vector3[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (Math.PI * 2 / segments) * i
        linePoints.push(new THREE.Vector3(
          Math.cos(angle) * radius, 0.02, Math.sin(angle) * radius
        ))
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff }))
      group.add(line)
    }

    // ─── 起点/终点线 (黑白格纹) ───
    const startLineMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.0,
    })
    for (let i = 0; i < 12; i++) {
      const x = roadInner + (roadOuter - roadInner) * (i / 12)
      const isWhite = Math.floor(i / 2) % 2 === 0
      const checker = new THREE.Mesh(
        new THREE.PlaneGeometry((roadOuter - roadInner) / 12, 0.3),
        new THREE.MeshStandardMaterial({
          color: isWhite ? 0xffffff : 0x111111,
          roughness: 0.5, metalness: 0.0,
        })
      )
      checker.rotation.x = -Math.PI / 2
      checker.position.set(x, 0.03, 0)
      group.add(checker)
    }

    // ─── 护栏 (内外圈) ───
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc, roughness: 0.6, metalness: 0.3,
    })
    const barrierCount = 48
    for (const radius of [roadInner - 0.5, roadOuter + 0.5]) {
      for (let i = 0; i < barrierCount; i++) {
        const angle = (Math.PI * 2 / barrierCount) * i
        const bx = Math.cos(angle) * radius
        const bz = Math.sin(angle) * radius

        const barrierGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.5, 6)
        const barrier = new THREE.Mesh(barrierGeo, barrierMat)
        barrier.position.set(bx, 0.25, bz)
        barrier.castShadow = true
        group.add(barrier)
      }
    }

    // ─── 轮胎堆装饰 (弯道外侧) ───
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.9, metalness: 0.0,
    })
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 / 24) * i + 0.1
      const radius = roadOuter + 1.2
      const tire = new THREE.Mesh(
        new THREE.TorusGeometry(0.15, 0.06, 6, 8),
        tireMat
      )
      tire.position.set(
        Math.cos(angle) * radius,
        0.1,
        Math.sin(angle) * radius
      )
      tire.rotation.x = Math.PI / 2
      group.add(tire)
    }

    // ─── 赛道指示牌 (方向箭头) ───
    // 省略复杂指示牌，用简单柱体替代
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xff4444, roughness: 0.5, metalness: 0.0,
    })
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 / 4) * i
      const pr = roadOuter + 2
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6),
        poleMat
      )
      pole.position.set(Math.cos(angle) * pr, 0.6, Math.sin(angle) * pr)
      group.add(pole)
    }

    return {
      group,
      name: 'Racing',
      dispose() {
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material?.dispose()
            }
          }
          if (child instanceof THREE.Line) {
            child.geometry?.dispose()
            child.material?.dispose()
          }
        })
      },
    }
  }
}
