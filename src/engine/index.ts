export { PreviewSceneManager } from './scene/PreviewSceneManager'
export { GameSceneManager } from './scene/GameSceneManager'
export { Compositor2D } from './scene/Compositor2D'
export type { PreviewSceneManagerOptions, ControlMode } from './scene/PreviewSceneManager'
export { logger, Logger } from './Logger'
export type { LogLevel } from './Logger'

// Gameplay Framework (位于 engine/gameplay 下)
export { Actor } from './gameplay/entity/Actor'
export { Component } from './gameplay/entity/Component'
export type { EditableProperty, EditablePropertyType, EditablePropertyAssetTarget } from './gameplay/entity/Component'
export { SpawnComponent } from './gameplay/entity/SpawnComponent'
export { TransformComponent } from './gameplay/entity/TransformComponent'
export { Pawn } from './gameplay/entity/Pawn'
export { PlayerController } from './gameplay/input/PlayerController'
export { GameMode } from './gameplay/gameflow/GameMode'
export { GameState } from './gameplay/gameflow/GameState'
export { GameInstance, NullGameInstance } from './gameplay/gameflow/GameInstance'
export type { GameInstanceCallbacks } from './gameplay/gameflow/GameInstance'
export { Game } from './gameplay/gameflow/Game'
export { World } from './gameplay/gameflow/World'
export { CameraComponent } from './gameplay/input/CameraComponent'
export type { CameraMode } from './gameplay/input/CameraComponent'
export { SpriteComponent } from './gameplay/rendering/SpriteComponent'
export { ClickableComponent } from './gameplay/physics/ClickableComponent'
export { loadTexture, clearTextureCache } from './scene/TextureLoader'
export { PlayerCameraManager } from './gameplay/input/PlayerCameraManager'
export { InputComponent } from './gameplay/input/InputComponent'
export type { InputEventType } from './gameplay/input/InputComponent'
export type { SkyboxConfig } from './scene/SceneAsset'
export { loadScene } from './scene/SceneLoader'

// AI 事件模块（AI 经 MCP 控制游戏场景的事件总线）
export { AIModule, registerBuiltinAIHandlers } from './ai'
export type { AIEventContext, AIEventHandler, AIEmitResult } from './ai'
export {
  AI_EVENT_NOTIFY,
  AI_EVENT_SPAWN_ACTOR,
  AI_EVENT_DESTROY_ACTOR,
  AI_EVENT_TRANSFORM_ACTOR,
  AI_EVENT_SET_SCORE,
  AI_EVENT_ADD_SCORE,
  AI_EVENT_GAME_OVER,
  AI_EVENT_SWITCH_SCENE,
  AI_EVENT_GET_STATE,
  AI_EVENT_SHOW_MESSAGE,
} from './ai'
export type {
  AINotifyPayload,
  AISpawnActorPayload,
  AIDestroyActorPayload,
  AITransformActorPayload,
  AISetScorePayload,
  AIAddScorePayload,
  AISwitchScenePayload,
  AIShowMessagePayload,
  AIGameStateSnapshot,
} from './ai'
export type { SceneGroup } from './scene/SceneLoader'
export type { SceneAsset, SceneNode, SpriteNode, MaterialProps } from './scene/SceneAsset'
export { GameFactoryRegistry } from './gameplay/tools/GameFactoryRegistry'
export type { GameInstanceFactory } from './gameplay/tools/GameFactoryRegistry'
export { GameModeRegistry } from './gameplay/tools/GameModeRegistry'
export { AssetRegistry } from './gameplay/tools/AssetRegistry'
export { ComponentRegistry } from './gameplay/tools/ComponentRegistry'
export type { ComponentFactory, ComponentConfigurator } from './gameplay/tools/ComponentRegistry'
export { ActorRegistry } from './gameplay/tools/ActorRegistry'
export type { ActorFactory } from './gameplay/tools/ActorRegistry'
export { BlueprintRegistry } from './gameplay/blueprint/BlueprintRegistry'
export type {
  BlueprintAsset,
  BlueprintComponentDef,
  BlueprintChildDef,
  ResolvedBlueprint,
} from './gameplay/blueprint/BlueprintAsset'
export { registerBuiltinComponents } from './gameplay/tools/registerBuiltinComponents'
export { registerBuiltinActors } from './gameplay/tools/registerBuiltinActors'
export { GenericActor } from './gameplay/entity/GenericActor'
export { mergePatch, clonePatch, emptyPatch } from './tools/deepMerge'
export type { PropertyPatch } from './tools/deepMerge'
export { SaveSystem } from './tools/SaveSystem'
export { SAVE_FORMAT_VERSION } from './tools/ISaveData'
export type { SaveData, SaveMeta, SaveSlotInfo } from './tools/ISaveData'
export { GameUI } from './gameplay/ui/GameUI'
export { HUD } from './gameplay/ui/HUD'
export { UIManager } from './gameplay/ui/UIManager'
export { UICamera, UICanvas } from './gameplay/ui/UICamera'
export type { UICanvasOptions } from './gameplay/ui/UICamera'

// UI 控件 Component（与 SpriteComponent / MeshComponent 同级）
export { UITextComponent } from './gameplay/ui/UITextComponent'
export type { UITextComponentOptions } from './gameplay/ui/UITextComponent'
export { UIImageComponent } from './gameplay/ui/UIImageComponent'
export type { UIImageComponentOptions } from './gameplay/ui/UIImageComponent'
export { UIButtonComponent } from './gameplay/ui/UIButtonComponent'
export type { UIButtonComponentOptions, ButtonState } from './gameplay/ui/UIButtonComponent'
export { UITransformComponent, ensureUITransformComponent } from './gameplay/ui/UITransformComponent'
export type { UITransformComponentOptions, AnchorPreset } from './gameplay/ui/UITransformComponent'

export { Gizmos, gizmos } from './tools/Gizmos'
export type { GizmoColor } from './tools/Gizmos'
export { ObjectPool } from './tools/ObjectPool'
export type { IPoolable, PoolableActor } from './tools/ObjectPool'
export { MeshComponent } from './gameplay/rendering/MeshComponent'
export { CanvasUIComponent } from './gameplay/rendering/CanvasUIComponent'
export type { CanvasUIOptions } from './gameplay/rendering/CanvasUIComponent'
export { TroikaTextComponent } from './gameplay/rendering/TroikaTextComponent'
export type { TroikaTextOptions } from './gameplay/rendering/TroikaTextComponent'
export { DataTable } from './tools/DataTable'
export { ConfigRegistry } from './tools/ConfigRegistry'
export { InputSys } from './gameplay/input/InputSys'
export { PhySys } from './gameplay/physics/PhySys'
