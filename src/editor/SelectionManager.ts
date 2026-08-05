/**
 * SelectionManager — 场景对象选择管理
 *
 * 模块级引用 + 递增 key 驱动 React 重渲染。
 * Outline 选中某个对象时记录引用，Inspector 读取其信息展示。
 * 同时持有 sharedScene 引用，使 Outline 能遍历场景中所有对象。
 */
import * as THREE from 'three'
import type { Actor } from '../engine'
import { TransformGizmo } from './TransformGizmo'
import { editorBus } from './EditorEvents'
import { EditorEvent } from './EditorEventNames'

// ─── TransformGizmo 单例 ───

const _gizmo = new TransformGizmo()

/** 获取全局 TransformGizmo 实例 */
export function getTransformGizmo(): TransformGizmo {
  return _gizmo
}

// ─── sharedScene 引用（Viewport 初始化时设置）───

let _sharedScene: THREE.Scene | null = null
let _sceneMgr: import('../engine').PreviewSceneManager | null = null

/** 设置共享场景引用（由 Viewport 在 setupScene 后调用） */
export function setSharedScene(scene: THREE.Scene | null): void {
  _sharedScene = scene
  _sceneKey++
  for (const cb of _onChangeCallbacks) cb()
  if (!scene) _gizmo.detach()
}

/** 设置 Scene 视口的 PreviewSceneManager（由 Viewport 在 setupScene 后调用） */
export function setSceneMgr(mgr: import('../engine').PreviewSceneManager | null): void {
  _sceneMgr = mgr
}

/** 获取 Scene 视口的 PreviewSceneManager */
export function getSceneMgr(): import('../engine').PreviewSceneManager | null {
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

/** 选中某个对象 */
export function select(obj: Selectable | null): void {
  _selected = obj
  _selectionKey++
  for (const cb of _onChangeCallbacks) cb()

  // 同步 TransformGizmo：选中对象时显示 Gizmo，取消选中时隐藏
  if (obj && _gizmo) {
    // Actor → 取其 root Group，普通 Object3D → 直接使用
    const target = obj instanceof THREE.Object3D ? obj : (obj as Actor).root
    _gizmo.attach(target)
  } else {
    _gizmo.detach()
  }
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
  if (!_sharedScene) return result

  function walk(obj: THREE.Object3D, depth: number) {
    // 跳过内部保留对象（GridHelper、AxesHelper、所有灯光——灯光挂载在灯光 Actor 的 root 下，
    // 是组件的渲染对象而非独立节点；灯光本身经 LightComponent 由父 Actor 表达）
    // 大纲眼睛隐藏的节点（__outlineHidden）仅预览不渲染，树中仍保留显示
    if (!obj.visible && !(obj as any).userData?.__outlineHidden && obj.type !== 'Scene') return
    if ((obj as THREE.Light).isLight || obj.type === 'GridHelper' || obj.type === 'AxesHelper') return
    // 跳过编辑 gizmo（TransformGizmo 及其子对象）
    if (obj.name === 'TransformGizmo') return

    // 跳过场景根节点自身（它只是一个容器，没有 actor）
    const isRoot = obj === _sharedScene
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

  walk(_sharedScene, 0)
  return result
}
