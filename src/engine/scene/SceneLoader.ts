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
  BlueprintNode,
  RefNode,
  ActorNode,
} from './SceneAsset'

/** 归一化后的引用节点（兼容 BlueprintNode 旧格式） */
export interface NormalizedRefNode {
  ref: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  overrides?: import('./SceneAsset').BlueprintNode['overrides']
  name?: string
}

/** 加载结果：包含 THREE.Group、场景元数据、资源释放 */
export interface SceneGroup {
  readonly group: THREE.Group
  readonly name: string
  readonly mode?: string
  readonly skybox?: SkyboxConfig
  /** blueprint 节点（loadScene 过滤收集，交由 World 层实例化） */
  readonly blueprintNodes?: BlueprintNode[]
  /** 归一化后的引用节点（RefNode + BlueprintNode 统一为此格式） */
  readonly refNodes?: NormalizedRefNode[]
  /** 内联 Actor 节点（loadScene 收集，preview 已渲染 mesh） */
  readonly actorNodes?: ActorNode[]
  dispose(): void
}

/** 入口：声明式资产 → SceneGroup */
export function loadScene(asset: SceneAsset): SceneGroup {
  const group = new THREE.Group()
  const disposables: { geo: THREE.BufferGeometry; mats: THREE.Material[] }[] = []
  const blueprintNodes: BlueprintNode[] = []
  const refNodes: NormalizedRefNode[] = []
  const actorNodes: ActorNode[] = []

  const track = (mesh: THREE.Mesh) => {
    group.add(mesh)
    disposables.push({
      geo: mesh.geometry,
      mats: Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    })
  }

  for (const node of asset.objects) {
    // blueprint 节点透传给 World 层实例化，不在 loader 展开
    if (node.type === 'blueprint') {
      blueprintNodes.push(node)
      // 同时归一化到 refNodes
      refNodes.push({
        ref: node.blueprint,
        position: node.pos ?? [0, 0, 0],
        rotation: node.rot ?? [0, 0, 0],
        scale: node.scale ?? [1, 1, 1],
        overrides: node.overrides,
        name: node.name,
      })
      continue
    }
    // ref 节点 — 新格式：引用蓝图
    if (node.type === 'ref') {
      refNodes.push({
        ref: node.ref,
        position: node.position ?? node.pos ?? [0, 0, 0],
        rotation: node.rotation ?? node.rot ?? [0, 0, 0],
        scale: node.scale ?? [1, 1, 1],
        overrides: node.overrides,
        name: node.name,
      })
      continue
    }
    // actor 节点 — 内联 Actor：渲染 mesh 组件预览，收集供 World 层 spawn
    if (node.type === 'actor') {
      actorNodes.push(node)
      renderActorMesh(node, track)
      continue
    }
    expandNode(node, track, node.name)
  }

  let disposed = false
  return {
    group,
    name: asset.name,
    mode: asset.mode,
    skybox: asset.skybox,
    blueprintNodes,
    refNodes,
    actorNodes,
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

/**
 * 将内联 Actor / BlueprintChildDef 节点中的 mesh 组件渲染为预览用的 THREE.Mesh。
 * 只处理 baseClass === 'MeshComponent' 的组件。
 * 使用 Group 正确表达父子变换层级。
 */
function renderActorMesh(node: ActorNode, track: (m: THREE.Mesh) => void): void {
  const actorGroup = new THREE.Group()
  actorGroup.name = node.name ?? 'actor'

  // 渲染自身的 mesh 组件
  const comps = node.components ?? []
  for (const comp of comps) {
    const mesh = componentToMesh(comp, node.name ?? 'actor_mesh')
    if (mesh) actorGroup.add(mesh)
  }

  // 递归渲染 children 的 mesh（只处理内联 baseClass 的，ref 跳过）
  for (const child of (node.children ?? [])) {
    if (child.ref) continue
    const childGroup = childDefToGroup(child)
    if (childGroup) actorGroup.add(childGroup)
  }

  // 应用 Actor 的 transform
  const p = node.position ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0]
  const s = node.scale ?? [1, 1, 1]
  actorGroup.position.set(p[0], p[1], p[2])
  actorGroup.rotation.set(r[0], r[1], r[2])
  actorGroup.scale.set(s[0], s[1], s[2])

  // 展开 Group 中的 mesh 并 track
  actorGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) track(obj)
  })
}

/** 将 BlueprintChildDef（内联 baseClass）递归转为 THREE.Group */
function childDefToGroup(child: import('../gameplay/blueprint/BlueprintAsset').BlueprintChildDef): THREE.Group | null {
  const g = new THREE.Group()
  g.name = child.name ?? 'child'

  const comps = child.components ?? []
  let hasMesh = false
  for (const comp of comps) {
    const mesh = componentToMesh(comp, child.name ?? 'child_mesh')
    if (mesh) { g.add(mesh); hasMesh = true }
  }

  // 递归子节点
  for (const sub of (child.children ?? [])) {
    if (sub.ref) continue
    const subGroup = childDefToGroup(sub)
    if (subGroup) g.add(subGroup)
  }

  // 纯容器节点（没有 mesh 也没有子节点）→ 跳过
  if (!hasMesh && g.children.length === 0) return null

  const cp = child.position ?? [0, 0, 0]
  const cr = child.rotation ?? [0, 0, 0]
  const cs = child.scale ?? [1, 1, 1]
  g.position.set(cp[0], cp[1], cp[2])
  g.rotation.set(cr[0], cr[1], cr[2])
  g.scale.set(cs[0], cs[1], cs[2])
  return g
}

/** 单个 mesh 组件 → THREE.Mesh */
function componentToMesh(
  comp: { baseClass: string; properties?: Record<string, unknown> },
  fallbackName: string,
): THREE.Mesh | null {
  if (comp.baseClass !== 'MeshComponent') return null
  const props = (comp.properties ?? {}) as Record<string, unknown>
  const geoType = (props.geometry as string) ?? 'box'
  const color = (props.color as string) ?? '#ffffff'
  const name = (props.name as string) ?? fallbackName

  let geo: THREE.BufferGeometry
  let mat: THREE.Material

  switch (geoType) {
    case 'box': {
      const size = (props.size as [number, number, number]) ?? [1, 1, 1]
      geo = new THREE.BoxGeometry(size[0], size[1], size[2])
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 })
      break
    }
    case 'plane': {
      const sz = (props.size as [number, number, number]) ?? [1, 1]
      geo = new THREE.PlaneGeometry(sz[0], sz[1])
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 })
      break
    }
    case 'sphere': {
      const radius = (props.radius as number) ?? 1
      const segs = (props.segments as number) ?? 12
      geo = new THREE.SphereGeometry(radius, segs, segs)
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 })
      break
    }
    default: {
      geo = new THREE.BoxGeometry(1, 1, 1)
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 })
    }
  }

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = `${name}_mesh`
  mesh.castShadow = props.castShadow !== false
  mesh.receiveShadow = props.receiveShadow !== false
  return mesh
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
      }
      break
    }
  }
}
