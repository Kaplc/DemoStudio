export { SceneRendererComponent } from './gameflow/SceneRendererComponent'
export { Compositor2D } from './rendering/Compositor2D'
export type { SceneRenderHost } from './rendering/SceneRenderHost'
export { logger, Logger } from './Logger'
export type { LogLevel } from './Logger'

// Gameplay Framework (引擎实体/游戏流/组件体系，直接位于 engine 下)
export { OObject } from './entity/OObject'
export { AObject } from './entity/AObject'
export { BObject } from './entity/BObject'
export { Actor } from './entity/Actor'
export { Component } from './entity/Component'
export type { EditableProperty, EditablePropertyType, EditablePropertyAssetTarget } from './entity/Component'
export { AObjectComponent } from './entity/AObjectComponent'
export { BObjectComponent } from './entity/BObjectComponent'
export { ActorComponent } from './entity/ActorComponent'
export { SpawnComponent } from './entity/SpawnComponent'
export { TransformComponent } from './entity/TransformComponent'
export { Pawn } from './entity/Pawn'
export { PlayerController } from './input/PlayerController'
export { GameMode } from './gameflow/GameMode'
export { GameState } from './gameflow/GameState'
export { GameInstance } from './gameflow/GameInstance'
export type { GameInstanceCallbacks } from './gameflow/GameInstance'
export { EditorGameBridgeComponent } from './gameflow/EditorGameBridgeComponent'
export { Game } from './gameflow/Game'
export { World } from './gameflow/World'
export { SceneComponent } from './gameflow/SceneComponent'
export { GameViewportComponent } from './gameflow/GameViewportComponent'
export { EditorActorComponent } from './gameflow/EditorActorComponent'
export { ThreeFactoryComponent } from './gameflow/ThreeFactoryComponent'
export { PreviewObjectFactoryComponent } from './gameflow/PreviewObjectFactoryComponent'
export { GCComponent } from './gameflow/GCComponent'
export { ActorManagerComponent } from './gameflow/ActorManagerComponent'
export { destroyActor, destroyObject, findActor, findActors, getAllActors, getAllActorComponents, spawnActor, spawnActorOfType, spawnFromBlueprint } from './gameflow/ActorUtils'
export { CameraComponent } from './rendering/CameraComponent'
export type { CameraMode } from './rendering/CameraComponent'
export { CameraActor } from './rendering/CameraActor'
export { CameraZoomComponent } from './rendering/CameraZoomComponent'
export { CameraRigComponent } from './rendering/CameraRigComponent'
export { BehaviourScript } from './script/BehaviourScript'
export { ScriptRegistry } from './script/ScriptRegistry'
export type { BehaviourScriptConstructor, ScriptModules } from './script/ScriptRegistry'
export { UIScriptComponent } from './ui/UIScriptComponent'
export { SpriteComponent } from './rendering/SpriteComponent'
export { ClickableComponent } from './physics/ClickableComponent'
export { loadTexture, clearTextureCache } from './rendering/TextureLoader'
export { PlayerCameraManager } from './rendering/PlayerCameraManager'
export { InputComponent } from './input/InputComponent'
export type { InputEventType } from './input/InputComponent'
export type { SkyboxConfig } from './asset/SceneAsset'
export { loadScene } from './asset/SceneLoader'

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
export type { SceneGroup } from './asset/SceneLoader'
export type { SceneAsset, SceneNode, SpriteNode, MaterialProps } from './asset/SceneAsset'
export { GameFactoryRegistry } from './tools/GameFactoryRegistry'
export type { GameInstanceFactory } from './tools/GameFactoryRegistry'
export { GameModeRegistry } from './tools/GameModeRegistry'
export { AssetRegistry } from './asset/AssetRegistry'
export { ComponentRegistry } from './tools/ComponentRegistry'
export type { ComponentFactory, ComponentConfigurator } from './tools/ComponentRegistry'
export { ActorRegistry } from './tools/ActorRegistry'
export type { ActorFactory } from './tools/ActorRegistry'
export { ObjectRegistry } from './tools/ObjectRegistry'
export { BlueprintRegistry } from './asset/BlueprintRegistry'
export type {
  BlueprintAsset,
  BlueprintComponentDef,
  BlueprintChildDef,
  ResolvedBlueprint,
} from './asset/BlueprintAsset'
export { registerBuiltinComponents } from './tools/registerBuiltinComponents'
export { registerBuiltinActors } from './tools/registerBuiltinActors'
export { GenericActor } from './entity/GenericActor'
export { mergePatch, clonePatch, emptyPatch } from './tools/deepMerge'
export { Instantiate } from './asset/BlueprintAsset'
export type { PropertyPatch } from './tools/deepMerge'
export { SaveSystem } from './tools/SaveSystem'
export { SAVE_FORMAT_VERSION } from './tools/ISaveData'
export type { SaveData, SaveMeta, SaveSlotInfo } from './tools/ISaveData'
export { SaveSlotComponent } from './gameflow/SaveSlotComponent'
export type { SaveSlotComponentOptions, KVValue } from './gameflow/SaveSlotComponent'
export { HUD } from './ui/HUD'
export { UIManager } from './ui/UIManager'
export { UICamera, UI_CANVAS_W, UI_CANVAS_H } from './rendering/UICamera'

// GM 命令系统（引擎级调试命令：控制台面板 + ai.gmCommand 桥接）
export { GMRegistry } from './gm/GMRegistry'
export type { GMCommandModules } from './gm/GMRegistry'
export { GMModule } from './gm/GMModule'
export type { GMExecuteResult, GMConsoleFactory } from './gm/GMModule'
export { GMConsoleHUD, GM_ZORDER_BASE, GM_TEXT_LAYER, MAX_OUTPUT_LINES } from './gm/GMConsoleHUD'
export {
  convertGMArg,
  formatGMUsage,
} from './gm/GMCommand'
export type {
  GMCommandArg,
  GMCommandContext,
  GMCommandDef,
  GMCommandHandler,
  GMCommandParam,
  GMCommandParamType,
} from './gm/GMCommand'
export { registerGMBridge } from './gm/registerGMBridge'
export { registerBuiltinGMCommands } from './gm/builtin/registerBuiltinGMCommands'

// UI 控件 Component（与 SpriteComponent / MeshComponent 同级）
export { UITextComponent } from './ui/UITextComponent'
export type { UITextComponentOptions } from './ui/UITextComponent'
export { UITextInputComponent } from './ui/UITextInputComponent'
export type { UITextInputComponentOptions } from './ui/UITextInputComponent'
export { UIImageComponent } from './ui/UIImageComponent'
export type { UIImageComponentOptions } from './ui/UIImageComponent'
export { UIButtonComponent } from './ui/UIButtonComponent'
export type { UIButtonComponentOptions, ButtonState } from './ui/UIButtonComponent'
export { UITransformComponent, ensureUITransformComponent } from './ui/UITransformComponent'
export type { UITransformComponentOptions, AnchorPreset } from './ui/UITransformComponent'
export { UILayoutComponent } from './ui/UILayoutComponent'
export type { UILayoutComponentOptions, UILayoutMode } from './ui/UILayoutComponent'
export { TweenSystem, Easing } from './ui/TweenSystem'
export type { TweenOptions, TweenHandle, Tweenable, EasingName, EasingFn } from './ui/TweenSystem'
export { ToastSystem, TOAST_TEXT_NODE } from './ui/ToastSystem'
export type { ToastOptions, ToastPriority } from './ui/ToastSystem'
export { UITooltipComponent, DEFAULT_TOOLTIP_WIDGET, TOOLTIP_TEXT_NODE } from './ui/UITooltipComponent'
export type { UITooltipComponentOptions } from './ui/UITooltipComponent'
export { ColorblindService, COLORBLIND_PALETTES, COLORBLIND_SOURCE_COLORS } from './ui/ColorblindService'
export type { ColorblindMode } from './ui/ColorblindService'
export { InputPromptSystem } from './ui/InputPromptSystem'
export type { InputDevice } from './ui/InputPromptSystem'
export { UIProgressBarComponent } from './ui/UIProgressBarComponent'
export type { UIProgressBarComponentOptions, UIProgressDirection } from './ui/UIProgressBarComponent'
export { UIScrollListComponent } from './ui/UIScrollListComponent'
export type { UIScrollListComponentOptions, UIScrollDirection } from './ui/UIScrollListComponent'

export { Gizmos, gizmos } from './tools/Gizmos'
export type { GizmoColor } from './tools/Gizmos'
export { ObjectPool } from './tools/ObjectPool'
export type { IPoolable, PoolableActor } from './tools/ObjectPool'
export { ObjectPoolManager } from './pools/ObjectPoolManager'
export { MeshComponent } from './rendering/MeshComponent'
export { BoxMeshComponent } from './rendering/BoxMeshComponent'
export { SphereMeshComponent } from './rendering/SphereMeshComponent'
export { PlaneMeshComponent } from './rendering/PlaneMeshComponent'
export { CapsuleMeshComponent } from './rendering/CapsuleMeshComponent'
export { LineComponent } from './rendering/LineComponent'
export { ThreeObject } from './rendering/ThreeObject'
/** @deprecated 使用 GCComponent 替代，由 world.gc 访问 */
export { ThreeObjectFactory } from './gameflow/ThreeObjectFactory'
export { LightComponent } from './rendering/LightComponent'
export type { LightType, LightComponentOptions } from './rendering/LightComponent'
export { CanvasUIComponent } from './rendering/CanvasUIComponent'
export type { CanvasUIOptions, UIHitTestMode } from './rendering/CanvasUIComponent'
export { TroikaTextComponent } from './rendering/TroikaTextComponent'
export type { TroikaTextOptions } from './rendering/TroikaTextComponent'
export { DataTable } from './tools/DataTable'
export { ConfigRegistry } from './tools/ConfigRegistry'
export type { ConfigGlobModules } from './tools/ConfigRegistry'
export { ConfigLoaderBase } from './tools/ConfigLoaderBase'
export { InputSys } from './input/InputSys'
export { PhySys } from './physics/PhySys'
export { PhysicsWorld, CollisionLayer, COLLISION_LAYER_GROUPS } from './physics/PhysicsWorld'
export type { OverlapHit } from './physics/PhysicsWorld'
export { ColliderComponent } from './physics/ColliderComponent'
export type { ColliderBodyType, CollisionEvent } from './physics/ColliderComponent'
export { BoxColliderComponent, CircleColliderComponent, CapsuleColliderComponent } from './physics/ColliderComponents'
export { colliderGizmos } from './physics/ColliderGizmos'
export { NavigationModule } from './navigation/NavigationModule'
export { NavGrid } from './navigation/NavGrid'
export { AStarPathfinder } from './navigation/AStarPathfinder'
