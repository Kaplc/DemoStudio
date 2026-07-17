/**
 * WorldAsset — 世界资产类型定义
 * 定义 WorldBuilder 接口、构建结果、构建配置
 * 所有游戏的地图构建器都遵循此接口
 */
import * as THREE from 'three'

/** 世界构建配置 — 每个游戏可扩展此接口 */
export interface WorldBuildConfig {
  /** 场景网格大小 */
  gridSize?: number
  /** 扩展配置 */
  [key: string]: unknown
}

/** 天空盒/场景氛围配置（与 SceneAsset.SkyboxConfig 一致，便于 JSON 场景文件描述） */
export interface SkyboxConfig {
  backgroundColor?: string
  fogColor?: string
  fogNear?: number
  fogFar?: number
  skyboxPath?: string
  skyboxExt?: string
}

/** 世界构建结果 */
export interface WorldAsset {
  /** 构建出的 3D 对象组 */
  readonly group: THREE.Group
  /** 资源名称（对应游戏名） */
  readonly name: string
  /** 天空盒/场景氛围配置（可选，由 SceneAsset JSON 或自定义 builder 提供） */
  readonly skybox?: SkyboxConfig
  /** 释放资源 */
  dispose(): void
}

/** 世界构建器接口 — 每个游戏实现此接口 */
export interface WorldBuilder {
  /** 构建世界场景（支持同步或异步） */
  build(config: WorldBuildConfig): WorldAsset | Promise<WorldAsset>
}
