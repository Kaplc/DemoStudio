/**
 * SceneLoader — 把声明式 SceneAsset 归集为节点列表
 *
 * loadScene(asset) 返回 SceneGroup（group + name + mode + skybox + dispose + 节点列表）。
 * loader 不再创建任何 mesh：ref/actor 节点统一收集后交由 World 层实例化为 Actor，
 * 渲染由 Actor 的 MeshComponent（预览经 PreviewObjectFactoryComponent）承担。
 */
import * as THREE from 'three'
import type { PropertyPatch } from '../tools/deepMerge'
import type {
  SceneAsset,
  RefNode,
  ActorNode,
} from './SceneAsset'

/** 归一化后的引用节点 */
export interface NormalizedRefNode {
  ref: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  overrides?: PropertyPatch
  /** 实例级组件属性覆盖（collectSaveData 持久化场景 Inspector 对 ref 组件的修改） */
  components?: import('./BlueprintAsset').BlueprintComponentDef[]
  /** 实例级子对象（挂在 ref 实例下，World/预览递归 spawn） */
  children?: import('./BlueprintAsset').BlueprintChildDef[]
  name?: string
}

/** 加载结果：包含场景元数据、节点列表、资源释放 */
export interface SceneGroup {
  readonly group: THREE.Group
  readonly name: string
  readonly mode?: string
  readonly skybox?: import('./SceneAsset').SkyboxConfig
  /** 归一化后的引用节点 */
  readonly refNodes?: NormalizedRefNode[]
  /** 内联 Actor 节点（loadScene 收集，交由 World 层 spawn） */
  readonly actorNodes?: ActorNode[]
  dispose(): void
}

/** 入口：声明式资产 → SceneGroup */
export function loadScene(asset: SceneAsset): SceneGroup {
  const group = new THREE.Group()
  const refNodes: NormalizedRefNode[] = []
  const actorNodes: ActorNode[] = []

  for (const node of asset.objects) {
    // ref 节点 — 引用蓝图
    if (node.type === 'ref') {
      refNodes.push({
        ref: node.ref,
        position: node.position ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0],
        scale: node.scale ?? [1, 1, 1],
        overrides: node.overrides,
        components: node.components,
        children: node.children,
        name: node.name,
      })
      continue
    }
    // actor 节点 — 内联 Actor：收集供 World 层 spawn
    actorNodes.push(node)
  }

  let disposed = false
  return {
    group,
    name: asset.name,
    mode: asset.mode,
    skybox: asset.skybox,
    refNodes,
    actorNodes,
    dispose: () => {
      if (disposed) return
      group.clear()
      disposed = true
    },
  }
}
