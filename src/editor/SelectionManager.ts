/**
 * SelectionManager — 场景对象选择管理
 *
 * 模块级引用 + 递增 key 驱动 React 重渲染。
 * Outline 选中某个对象时记录引用，Inspector 读取其信息展示。
 * 同时持有 sharedScene 引用，使 Outline 能遍历场景中所有对象。
 */
import * as THREE from 'three'
import type { Actor } from '../engine'
import { gizmos } from '../engine'
import { TransformGizmo } from './TransformGizmo'
import { AnchorGizmo } from './AnchorGizmo'
import { SelectionBoundsGizmo } from './SelectionBoundsGizmo'
import { UITransformComponent } from '../engine/ui/UITransformComponent'
import { editorBus } from './EditorEvents'
import { EditorEvent } from './EditorEventNames'

// ─── TransformGizmo 单例（3D Scene 视口） ───

const _gizmo = new TransformGizmo()

/** 获取全局 TransformGizmo 实例 */
export function getTransformGizmo(): TransformGizmo {
  return _gizmo
}

// ─── AnchorGizmo 单例（游戏运行时 UI 节点：父容器范围 + 锚点图标） ───

const _anchorGizmo = new AnchorGizmo()

/** 获取全局 AnchorGizmo 实例（游戏运行时使用） */
export function getAnchorGizmo(): AnchorGizmo {
  return _anchorGizmo
}

// ─── SelectionBoundsGizmo 单例（游戏运行时 UI 节点：青色范围框 + 把手 + 尺寸标签） ───

const _boundsGizmo = new SelectionBoundsGizmo()

/** 获取全局 SelectionBoundsGizmo 实例（游戏运行时使用） */
export function getSelectionBoundsGizmo(): SelectionBoundsGizmo {
  return _boundsGizmo
}

// ─── 游戏运行时 UI 选中辅助 overlay 场景（编辑器独立持有） ───
// 注意：gizmo 不挂入游戏 UI 场景（world.ui.scene）——否则 World.Destroy 的
// 泄漏检测会把它们当作"未被 Actor 跟踪的 THREE 对象"告警。这里用独立 overlay
// 场景承载，由 Viewport 经 SceneRendererComponent.onAfterRender 用 UICamera 叠加渲染。

/** 游戏运行时 UI 选中辅助 overlay 场景（AnchorGizmo + SelectionBoundsGizmo 常驻于此） */
const _runtimeUiOverlayScene = new THREE.Scene()
_runtimeUiOverlayScene.add(_anchorGizmo.group)
_runtimeUiOverlayScene.add(_boundsGizmo.group)

/** 获取游戏运行时 UI 选中辅助 overlay 场景（Viewport 渲染循环经 UICamera 叠加渲染用） */
export function getRuntimeUIOverlayScene(): THREE.Scene {
  return _runtimeUiOverlayScene
}

/**
 * 挂接/解除游戏运行时 UI 选中辅助。
 * gizmo 常驻编辑器独立 overlay 场景（getRuntimeUIOverlayScene），不挂入游戏 UI 场景，
 * 由 Viewport 通过 SceneRendererComponent.onAfterRender 用 UICamera 叠加渲染。
 * scene 参数仅保留兼容旧调用；传入 null（游戏停止）时 detach 目标。
 */
export function attachAnchorGizmoToScene(scene: THREE.Scene | null): void {
  // 不再把 gizmo 挂到外部场景（独立 overlay 常驻）；null = 游戏停止 → 取消选中目标
  if (!scene) {
    _anchorGizmo.detach()
    _boundsGizmo.detach()
  }
}

/**
 * 每帧更新游戏运行时 UI 选中辅助（AnchorGizmo + SelectionBoundsGizmo）跟随。
 * 由 SceneRendererComponent 渲染循环 onUpdate 回调调用。
 * @param worldPerPx 当前 zoom 下 1px 对应的世界距离（屏幕恒定尺寸用；非有限值直接跳过）
 */
export function updateAnchorGizmo(worldPerPx: number): void {
  if (!isFinite(worldPerPx) || worldPerPx <= 0) return
  if (_anchorGizmo.visible) _anchorGizmo.update(worldPerPx)
  if (_boundsGizmo.visible) _boundsGizmo.update(worldPerPx)
}

// ─── sharedScene 引用（Viewport 初始化时设置）───

let _sharedScene: THREE.Scene | null = null
let _sceneMgr: import('./SceneViewport').PreviewSceneManager | null = null

/** 设置共享场景引用（由 Viewport 在 setupScene 后调用） */
export function setSharedScene(scene: THREE.Scene | null): void {
  _sharedScene = scene
  _sceneKey++
  for (const cb of _onChangeCallbacks) cb()
  if (!scene) _gizmo.detach()
}

/** 设置 Scene 视口的 PreviewSceneManager（由 Viewport 在 setupScene 后调用） */
export function setSceneMgr(mgr: import('./SceneViewport').PreviewSceneManager | null): void {
  _sceneMgr = mgr
}

/** 获取 Scene 视口的 PreviewSceneManager */
export function getSceneMgr(): import('./SceneViewport').PreviewSceneManager | null {
  return _sceneMgr
}

/** 获取共享场景引用 */
export function getSharedScene(): THREE.Scene | null {
  return _sharedScene
}

/** 将 Scene 摄像机聚焦到指定 3D 对象上 */
export function focusOn(target: THREE.Object3D, distance?: number): void {
  _sceneMgr?.focusOn(target, distance)
}

// ─── 选中对象管理 ───

type Selectable = Actor | THREE.Object3D

/** 当前选中的对象 */
let _selected: Selectable | null = null

/** 递增 key，每次选中/场景变化时 +1，驱动 React 重渲染 */
let _selectionKey = 0
let _sceneKey = 0
/** 选中变化回调集合（多槽：Outline / Inspector 各自注册，互不覆盖） */
const _onChangeCallbacks = new Set<() => void>()

/** 获取当前选中对象 */
export function getSelected(): Selectable | null {
  return _selected
}

/** 获取当前选中对象（Actor 兼容） */
export function getSelectedActor(): Actor | null {
  if (_selected instanceof THREE.Object3D && (_selected as any).userData?.actorRef) {
    return (_selected as any).userData.actorRef as Actor
  }
  return _selected as Actor | null
}

/**
 * 判断选中目标是否为游戏运行时的 UI 节点（用 AnchorGizmo 显示）。
 * 条件：游戏运行中 + 目标是 Actor + 拥有 UITransformComponent。
 */
function isRuntimeUINode(obj: Selectable | null): obj is Actor {
  if (!obj) return false
  if (!_runningWorld) return false
  if (obj instanceof THREE.Object3D) return false
  const actor = obj as Actor
  return !!actor.getComponent(UITransformComponent)
}

/** 选中某个对象 */
export function select(obj: Selectable | null): void {
  _selected = obj
  _selectionKey++
  for (const cb of _onChangeCallbacks) cb()

  // 游戏运行时 UI 节点：用 AnchorGizmo + SelectionBoundsGizmo 显示
  //   AnchorGizmo：父容器范围 + 锚点图标（Unity 锚点风格）
  //   SelectionBoundsGizmo：青色范围框 + 8 把手 + 尺寸标签（控件自身边界）
  if (isRuntimeUINode(obj)) {
    _gizmo.detach()
    const actor = obj as Actor
    _anchorGizmo.attach(actor)
    _boundsGizmo.attach(actor)
  } else {
    // 取消旧 UI 选中辅助（避免从 UI 节点切到 3D 节点时残留）
    _anchorGizmo.detach()
    _boundsGizmo.detach()

    // 同步 TransformGizmo：选中对象时显示 Gizmo，取消选中时隐藏
    if (obj && _gizmo) {
      // Actor → 取其 root Group，普通 Object3D → 直接使用
      const target = obj instanceof THREE.Object3D ? obj : (obj as Actor).root
      _gizmo.attach(target)
    } else {
      _gizmo.detach()
    }
  }
  // 主动触发 gizmos 开关委托：新 attach/detach 的 gizmo 立即按当前开关刷新可见性
  // （点击大纲节点 → select → 这里广播，所有注册委托的 gizmo 物体立即显示/隐藏）
  gizmos.refresh()
}

/** 选中某个 Actor（保持向后兼容） */
export function selectActor(actor: Actor | null): void {
  select(actor)
}

/** 获取当前选中 key（用于 React key / deps 触发重渲染） */
export function getSelectionKey(): number {
  return _selectionKey + _sceneKey
}

/** 注册选中变化回调（多槽：多个组件可同时订阅，互不覆盖） */
export function onSelectionChange(cb: () => void): () => void {
  _onChangeCallbacks.add(cb)
  return () => {
    _onChangeCallbacks.delete(cb)
  }
}

/** 触发选中变化通知（带 key 递增，驱动 React 重渲染） */
export function notifySelectionChange(): void {
  _selectionKey++
  for (const cb of _onChangeCallbacks) cb()
  // 通过事件总线通知（不再直接耦合 Zustand store）
  editorBus.emit(EditorEvent.SELECTION_CHANGED)
}

// ─── World Actor 变化 → 大纲刷新（自动连接）───

/** 已连接 Actor 变化监听的 World（WeakSet 防同一 World 重复注册） */
const _watchedWorlds = new WeakSet<import('../engine').World>()

/** 当前运行中游戏的 World（Viewport 游戏启动时设置，停止时清空；大纲运行中 UI 树数据源） */
let _runningWorld: import('../engine').World | null = null

/** 当前运行中游戏的编辑器只读桥（挂 GameInstance，Viewport 启动/停止游戏时设置） */
let _runningBridge: import('../engine').EditorGameBridgeComponent | null = null

/** 记录当前运行中游戏的编辑器只读桥（Viewport 启动/停止游戏时调用） */
export function setRunningBridge(bridge: import('../engine').EditorGameBridgeComponent | null): void {
  _runningBridge = bridge
}

/** 获取当前运行中游戏的编辑器只读桥（未运行返回 null） */
export function getRunningBridge(): import('../engine').EditorGameBridgeComponent | null {
  return _runningBridge
}

/** 记录当前运行中游戏的 World（Viewport 启动/停止游戏时调用） */
export function setRunningWorld(world: import('../engine').World | null): void {
  _runningWorld = world
  // 游戏停止（world = null）：清理运行时 UI 选中辅助（detach 目标；场景分离由 attachAnchorGizmoToScene(null) 处理）
  if (!world) {
    _anchorGizmo.detach()
    _boundsGizmo.detach()
  }
}

/** 获取当前运行中游戏的 World（大纲运行中 UI 树数据源；未运行返回 null） */
export function getRunningWorld(): import('../engine').World | null {
  return _runningWorld
}

/**
 * 连接 World 的 Actor 列表变化 → 刷新大纲（递增 selectionKey + 通知回调）。
 * 同一 World 只连接一次；invalidate 可选回调用于清预览树缓存（如 getActorTree 缓存）。
 * 由预览管理器注册（AssetPreviewManager.register）与 Viewport 游戏/预览 World 创建处调用。
 */
export function watchWorldActorChanges(
  world: import('../engine').World | null | undefined,
  invalidate?: () => void,
): void {
  if (!world || _watchedWorlds.has(world)) return
  _watchedWorlds.add(world)
  world.onActorListChanged(() => {
    invalidate?.()
    notifySelectionChange()
  })
}

/**
 * 遍历场景树，返回平铺节点列表（带缩进级别、类型、actorRef）
 */
export interface SceneTreeNode {
  depth: number
  name: string
  actor: Actor | null
}

export function getSceneTree(): SceneTreeNode[] {
  const result: SceneTreeNode[] = []
  // 游戏运行时：只读遍历游戏场景（经桥组件，不注入编辑器内容）；否则遍历共享场景
  const scene = _runningBridge?.scene ?? _sharedScene
  if (!scene) return result

  function walk(obj: THREE.Object3D, depth: number) {
    // 跳过内部保留对象（GridHelper、AxesHelper、所有灯光——灯光挂载在灯光 Actor 的 root 下，
    // 是组件的渲染对象而非独立节点；灯光本身经 LightComponent 由父 Actor 表达）
    // 可见性过滤：无 actor 的纯渲染对象不可见时跳过；有 actor 的节点始终保留显示
    // （含被 canvas active 隐藏 / 大纲眼睛 previewHidden 隐藏的节点，便于恢复选择）
    const refActor = (obj as any).userData?.actorRef as Actor | undefined
    if (!obj.visible && !refActor && obj.type !== 'Scene') return
    if ((obj as THREE.Light).isLight || obj.type === 'GridHelper' || obj.type === 'AxesHelper') return
    // 跳过编辑 gizmo（TransformGizmo 及其子对象）
    if (obj.name === 'TransformGizmo') return

    // 跳过场景根节点自身（它只是一个容器，没有 actor）
    const isRoot = obj === scene
    if (!isRoot) {
      const actorRef = (obj as any).userData?.actorRef as Actor | undefined
      // 只显示有 Actor 的节点：无 actorRef 的纯容器 Group / 场景资产 mesh / 灯光子对象
      // 不显示（与 BlueprintPreviewManager/ScenePreviewManager 的 getActorTree 语义一致），
      // 但继续递归子节点，不遗漏嵌套的 Actor
      if (actorRef) {
        result.push({
          depth,
          name: obj.name || obj.type,
          actor: actorRef,
        })
        // ref 实例（类似预制体）不展开其内部子 Actor
        if (actorRef.isRefInstance) return
      }
    }

    // 根节点不加深 depth，直接平铺
    const nextDepth = isRoot ? depth : depth + 1
    for (const child of obj.children) {
      walk(child, nextDepth)
    }
  }

  walk(scene, 0)
  return result
}
