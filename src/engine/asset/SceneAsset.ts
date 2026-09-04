/**
 * SceneAsset — 声明式场景资产类型定义
 * 由 JSON 文件描述（如 src/projects/fish/asset/fish_base.scene.json），
 * SceneLoader 读取后归集为节点列表，由 World 层实例化为 Actor。
 *
 * 节点只保留新格式两类：
 *   - ref   ：引用另一个蓝图资产，由 World 实例化
 *   - actor ：内联 Actor（baseClass + components + children），位置等变换
 *             一律写在 TransformComponent 组件的 properties 里（组件优先约定）
 *
 * 旧格式几何节点（box/plane/sphere/sprite/checkerFloor/gridLines/pillar/wallRing）
 * 与 blueprint 透传节点已移除；资产中若残留会由 assetLint 报 error。
 */

import type { PropertyPatch } from '../tools/deepMerge'

/** 颜色：CSS hex 字符串 "#rrggbb" */
export type ColorHex = string

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

/** 引用节点 — 引用另一个蓝图资产，由 World 实例化为 ref 实例（isRefInstance） */
export interface RefNode extends BaseNode {
  type: 'ref'
  /** 引用的蓝图路径（asset/.../*.blueprint.json） */
  ref: string
  /** 世界坐标位置 */
  position?: Vec3
  /** 欧拉旋转角弧度 */
  rotation?: Vec3
  /** 缩放 */
  scale?: Vec3
  /** 实例级属性覆盖（叠加在蓝图 CDO 之上） */
  overrides?: PropertyPatch
  /** 实例级组件属性覆盖（按 baseClass 覆盖蓝图组件属性，如改 MeshComponent.size） */
  components?: import('./BlueprintAsset').BlueprintComponentDef[]
  /** 实例级子对象（递归，挂到 ref 实例下；组件优先约定同 ActorNode.children） */
  children?: import('./BlueprintAsset').BlueprintChildDef[]
}

/** 内联 Actor 节点 — 直接在场景中定义一个 Actor（baseClass + components + children） */
export interface ActorNode extends BaseNode {
  type: 'actor'
  /** ActorRegistry 类型名（如 'Actor'、'FishHouse' 等） */
  baseClass: string
  /** 默认挂载的 Component（变换必须写在 TransformComponent 的 properties 里） */
  components?: import('./BlueprintAsset').BlueprintComponentDef[]
  /** 子 Actor（递归，支持内联和引用） */
  children?: import('./BlueprintAsset').BlueprintChildDef[]
}

interface BaseNode {
  name?: string
}

export type SceneNode = RefNode | ActorNode

/** 天空盒/场景氛围配置 */
export interface SkyboxConfig {
  /** 背景颜色 (#rrggbb)，不设置则使用引擎默认 (0x1a1a2e) */
  backgroundColor?: ColorHex
  /** 天空盒立方体贴图路径前缀（如 /textures/skybox/sky），
   *  6 张图片命名约定为 {skyboxPath}_px.{ext}, _nx, _py, _ny, _pz, _nz */
  skyboxPath?: string
  /** 立方体贴图文件后缀，默认 .jpg */
  skyboxExt?: string
}

/** 场景资产根文档 */
export interface SceneAsset {
  name: string
  /** 场景对应的游戏阶段/模式标识（如 "menu"、"base"、"game"），由 GameInstance 据此决定启动哪个 GameMode */
  mode?: string
  objects: SceneNode[]
  /** 天空盒/背景/雾效配置（可选） */
  skybox?: SkyboxConfig
}
