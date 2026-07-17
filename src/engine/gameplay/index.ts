/**
 * DemoStudio Gameplay Framework
 * 模仿 Unreal Engine 的游戏框架
 *
 * ├── Actor         基础世界实体（Transform、生命周期、Components）
 * ├── Component     可附加的行为模块
 * ├── Pawn          可被玩家控制的 Actor
 * ├── PlayerController  玩家输入处理 → Pawn
 * ├── GameMode      游戏规则权威
 * ├── GameState     可观察的全局游戏状态
 * ├── World         Actor 管理 + Tick 循环
 * ├── CameraComponent     Actor 可挂载的摄像机
 * ├── PlayerCameraManager 游戏摄像机管理
 * └── InputComponent      输入绑定组件（按键 → 动作）
 */

export { Actor } from './Actor'
export { Component } from './Component'
export { SpawnComponent } from './SpawnComponent'
export { Pawn } from './Pawn'
export { PlayerController } from './PlayerController'
export { GameMode } from './GameMode'
export { GameState } from './GameState'
export { GameInstance } from './GameInstance'
export type { GameInstanceCallbacks } from './GameInstance'
export { Game } from './Game'
export { World } from './World'
export { CameraComponent } from './CameraComponent'
export type { CameraMode } from './CameraComponent'
export { SpriteComponent } from './SpriteComponent'
export { loadTexture, clearTextureCache } from './TextureLoader'
export { PlayerCameraManager } from './PlayerCameraManager'
export { InputComponent } from './InputComponent'
export type { InputEventType } from './InputComponent'
export type { WorldBuilder, WorldBuildConfig, WorldAsset } from './WorldAsset'
export { WorldRegistry } from './WorldRegistry'
export { JsonSceneAssetBuilder } from './JsonSceneAssetBuilder'
export { loadScene } from './SceneLoader'
export type { SceneAsset, SceneNode, SpriteNode, MaterialProps } from './SceneAsset'
export { logger } from '..'
export { DataTable } from './DataTable'
export { ConfigRegistry } from './ConfigRegistry'
