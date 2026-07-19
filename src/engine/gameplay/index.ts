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

export { Actor } from './entity/Actor'
export { Component } from './entity/Component'
export { SpawnComponent } from './entity/SpawnComponent'
export { Pawn } from './entity/Pawn'
export { PlayerController } from './input/PlayerController'
export { GameMode } from './gameflow/GameMode'
export { GameState } from './gameflow/GameState'
export { GameInstance } from './gameflow/GameInstance'
export type { GameInstanceCallbacks } from './gameflow/GameInstance'
export { Game } from './gameflow/Game'
export { World } from './gameflow/World'
export { CameraComponent } from './input/CameraComponent'
export type { CameraMode } from './input/CameraComponent'
export { SpriteComponent } from './rendering/SpriteComponent'
export { loadTexture, clearTextureCache } from './scene/TextureLoader'
export { PlayerCameraManager } from './input/PlayerCameraManager'
export { InputComponent } from './input/InputComponent'
export type { InputEventType } from './input/InputComponent'
export { loadScene } from './scene/SceneLoader'
export type { SceneGroup } from './scene/SceneLoader'
export type { SceneAsset, SceneNode, SpriteNode, MaterialProps } from './scene/SceneAsset'
export { logger } from '..'
export { DataTable } from './tools/DataTable'
export { ConfigRegistry } from './tools/ConfigRegistry'
