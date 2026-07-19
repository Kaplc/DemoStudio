/**
 * SceneLoader — 把声明式 SceneAsset 展开为 THREE.Group
 *
 * loadScene(asset) 返回 SceneGroup（group + name + mode + skybox + dispose）。
 */
import * as THREE from 'three'
import { loadTexture } from './TextureLoader'
import type {
  SceneAsset,
  SceneNode,
  MaterialProps,
  ColorHex,
  SkyboxConfig,
} from './SceneAsset'

/** 加载结果：包含 THREE.Group、场景元数据、资源释放 */
export interface SceneGroup {
  readonly group: THREE.Group
  readonly name: string
  readonly mode?: string
  readonly skybox?: SkyboxConfig
  dispose(): void
}

/** 入口：声明式资产 → SceneGroup */
export function loadScene(asset: SceneAsset): SceneGroup {
  const group = new THREE.Group()
  const disposables: { geo: THREE.BufferGeometry; mats: THREE.Material[] }[] = []

  const track = (mesh: THREE.Mesh) => {
    group.add(mesh)
    disposables.push({
      geo: mesh.geometry,
      mats: Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    })
  }

  for (const node of asset.objects) {
    expandNode(node, track, node.name)
  }

  let disposed = false
  return {
    group,
    name: asset.name,
    mode: asset.mode,
    skybox: asset.skybox,
    dispose: () => {
      if (disposed) return
      for (const d of disposables) {
        d.geo.dispose()
        d.mats.forEach((m) => m.dispose())
      }
      group.clear()
      disposed = true
    },
  }
}

/** 颜色字符串 → THREE.Color（"#rrggbb" / "rrggbb" 均可） */
function toColor(c: ColorHex): THREE.Color {
  return new THREE.Color(c)
}

/** 按 MaterialProps 构造 standard / basic 材质，缺失字段走默认 */
function makeMaterial(
  mp: MaterialProps = {},
  defaultKind: 'standard' | 'basic' = 'standard',
  defaultRough = 0.7,
  defaultMetal = 0.1,
): THREE.Material {
  const kind = mp.kind ?? defaultKind
  const transparent = mp.transparent ?? (mp.opacity !== undefined && mp.opacity < 1)
  const map = mp.texture ? loadTexture(mp.texture) : null
  if (kind === 'basic') {
    return new THREE.MeshBasicMaterial({
      color: mp.color ? toColor(mp.color) : 0xffffff,
      map,
      transparent,
      opacity: mp.opacity ?? 1,
    })
  }
  return new THREE.MeshStandardMaterial({
    color: mp.color ? toColor(mp.color) : 0xffffff,
    map,
    roughness: mp.roughness ?? defaultRough,
    metalness: mp.metalness ?? defaultMetal,
    transparent,
    opacity: mp.opacity ?? 1,
  })
}

function expandNode(node: SceneNode, track: (m: THREE.Mesh) => void, defaultName?: string): void {
  const nodeName = node.name || defaultName || node.type
  switch (node.type) {
    case 'box': {
      const [w, h, d] = node.size
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        makeMaterial(node.material, 'standard'),
      )
      mesh.name = nodeName
      mesh.position.fromArray(node.pos ?? [0, 0, 0])
      if (node.rot) mesh.rotation.set(node.rot[0], node.rot[1], node.rot[2])
      // box 原子：cast/receive 默认 true（对齐旧 addBox）
      mesh.castShadow = node.material?.castShadow ?? true
      mesh.receiveShadow = node.material?.receiveShadow ?? true
      track(mesh)
      break
    }
    case 'plane': {
      const [w, h] = node.size
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        makeMaterial(node.material, 'standard'),
      )
      mesh.name = nodeName
      mesh.position.fromArray(node.pos ?? [0, 0, 0])
      if (node.rot) mesh.rotation.set(node.rot[0], node.rot[1], node.rot[2])
      mesh.castShadow = node.material?.castShadow ?? false
      mesh.receiveShadow = node.material?.receiveShadow ?? false
      track(mesh)
      break
    }
    case 'sprite': {
      const [w, h] = node.size
      const tex = node.texture ?? node.material?.texture
      const mat = new THREE.MeshBasicMaterial({
        color: node.material?.color ? toColor(node.material.color) : 0xffffff,
        transparent: (node.material?.opacity ?? 1) < 1,
        opacity: node.material?.opacity ?? 1,
      })
      if (tex) {
        mat.map = loadTexture(tex)
        mat.color.set(0xffffff) // 贴图时白色基底，避免叠加染色
        mat.needsUpdate = true
      }
      // sprite 位于 XY 平面，法线 +Z，天然面向 -Z 正交相机，无需旋转
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
      mesh.name = nodeName
      mesh.position.fromArray(node.pos ?? [0, 0, 0])
      if (node.rot) mesh.rotation.set(node.rot[0], node.rot[1], node.rot[2])
      track(mesh)
      break
    }
    case 'sphere': {
      const segs = node.segments ?? 12
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.radius, segs, segs),
        makeMaterial(node.material, 'basic'),
      )
      mesh.name = nodeName
      mesh.position.fromArray(node.pos ?? [0, 0, 0])
      mesh.castShadow = node.material?.castShadow ?? false
      mesh.receiveShadow = node.material?.receiveShadow ?? false
      track(mesh)
      break
    }
    case 'checkerFloor': {
      let checkerIdx = 0
      const gs = node.gridSize
      const half = gs / 2
      const colors = node.colors ?? ['#4a4a5a', '#5a5a6a']
      const tile = node.tileSize ?? 0.96
      const y = node.y ?? 0.02
      for (let x = -half; x < half; x++) {
        for (let z = -half; z < half; z++) {
          // 复刻 Math.abs((round(x)+round(z))%2)：负坐标下 %2 为负，须取绝对值，否则 colors[-1] 越界
          const idx = Math.abs((Math.round(x) + Math.round(z)) % 2)
          const m = new THREE.Mesh(
            new THREE.PlaneGeometry(tile, tile),
            new THREE.MeshStandardMaterial({
              color: toColor(colors[idx]),
              roughness: node.material?.roughness ?? 0.8,
              metalness: node.material?.metalness ?? 0.1,
            }),
          )
          m.rotation.x = -Math.PI / 2
          m.position.set(x + 0.5, y, z + 0.5)
          m.castShadow = node.material?.castShadow ?? false
          m.receiveShadow = node.material?.receiveShadow ?? true
          m.name = `${nodeName}_${checkerIdx++}`
          track(m)
        }
      }
      break
    }
    case 'gridLines': {
      const gs = node.gridSize
      const half = gs / 2
      const color = toColor(node.color ?? '#444466')
      const opacity = node.opacity ?? 0.15
      const th = node.thickness ?? 0.02
      const y = node.y ?? 0.025
      let gridIdx = 0
      // 所有线共享同一 material（对齐旧 lineMat）
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
      for (let i = -half; i <= half; i++) {
        const hLine = new THREE.Mesh(new THREE.PlaneGeometry(th, gs), mat)
        hLine.name = `${nodeName}_h${gridIdx}`
        hLine.rotation.x = -Math.PI / 2
        hLine.position.set(0, y, i)
        track(hLine)
        const vLine = new THREE.Mesh(new THREE.PlaneGeometry(gs, th), mat)
        vLine.name = `${nodeName}_v${gridIdx}`
        vLine.rotation.x = -Math.PI / 2
        vLine.position.set(i, y, 0)
        track(vLine)
        gridIdx++
      }
      break
    }
    case 'pillar': {
      const [px, pz] = node.pos
      const c = node.colors ?? {}
      // 柱身
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 5, 0.5),
        new THREE.MeshStandardMaterial({
          color: toColor(c.shaft ?? '#5599dd'),
          roughness: 0.7,
          metalness: 0.1,
        }),
      )
      shaft.name = `${nodeName}_shaft`
      shaft.position.set(px, 2.5, pz)
      shaft.castShadow = true
      shaft.receiveShadow = true
      track(shaft)
      // 顶盖
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.15, 0.7),
        new THREE.MeshStandardMaterial({
          color: toColor(c.cap ?? '#77bbff'),
          roughness: 0.7,
          metalness: 0.1,
        }),
      )
      cap.name = `${nodeName}_cap`
      cap.position.set(px, 5, pz)
      cap.castShadow = true
      cap.receiveShadow = true
      track(cap)
      // 顶部球（basic，无 shadow）
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: toColor(c.orb ?? '#64b4ff') }),
      )
      orb.name = `${nodeName}_orb`
      orb.position.set(px, 5.3, pz)
      track(orb)
      break
    }
    case 'wallRing': {
      const gs = node.gridSize
      const half = gs / 2
      const H = node.height ?? 1.2
      const th = node.thickness ?? 0.3
      const wallMat = new THREE.MeshStandardMaterial({
        color: toColor(node.wallColor ?? '#336699'),
        roughness: node.wallMaterial?.roughness ?? 0.6,
        metalness: node.wallMaterial?.metalness ?? 0.2,
      })
      const capMat = new THREE.MeshStandardMaterial({
        color: toColor(node.capColor ?? '#5588bb'),
        roughness: node.capMaterial?.roughness ?? 0.5,
        metalness: node.capMaterial?.metalness ?? 0.3,
      })
      let wallIdx = 0
      // Z 轴两堵（长度沿 X）
      for (const z of [-half, half]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(gs, H, th), wallMat)
        wall.name = `${nodeName}_wall${wallIdx}`
        wall.position.set(0, H / 2, z)
        wall.castShadow = true // 旧码只设 castShadow，receive 保持 false
        track(wall)
        const cap = new THREE.Mesh(new THREE.BoxGeometry(gs - 0.1, 0.08, th + 0.05), capMat)
        cap.name = `${nodeName}_cap${wallIdx}`
        cap.position.set(0, H, z)
        track(cap)
        wallIdx++
      }
      // X 轴两堵（长度沿 Z）
      for (const x of [-half, half]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(th, H, gs), wallMat)
        wall.name = `${nodeName}_wall${wallIdx}`
        wall.position.set(x, H / 2, 0)
        wall.castShadow = true
        track(wall)
        const cap = new THREE.Mesh(new THREE.BoxGeometry(th + 0.05, 0.08, gs - 0.1), capMat)
        cap.name = `${nodeName}_cap${wallIdx}`
        cap.position.set(x, H, 0)
        track(cap)
        wallIdx++
      }
      break
    }
  }
}
