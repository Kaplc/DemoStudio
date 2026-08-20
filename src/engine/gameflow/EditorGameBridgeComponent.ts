/**
 * EditorGameBridgeComponent — 编辑器只读适配组件（挂游戏 GameInstance）
 *
 * 编辑器在游戏运行时经本组件**只读**访问游戏场景，不向游戏注入任何编辑器内容：
 *  - world：游戏 World（duck-typed，GameInstance 子类持有）
 *  - scene：游戏 World 自建场景（actor 挂载处，编辑器据此渲染/遍历，绝不修改）
 *  - actors：全部 Actor 只读快照
 *
 * 设计动机：编辑器与游戏场景解耦——
 *  游戏保持自己的 SceneComponent 场景；编辑器（大纲/Scene 视图）经本组件
 *  getScene() 读取游戏场景做展示，Game 视口渲染器仍渲染 world.scene，
 *  三者引用同一场景但归属清晰（场景归游戏，编辑器只是观察者）。
 *
 * 由 GameInstance 构造时自动挂载（与 GameViewportComponent 一致）。
 */
import * as THREE from 'three'
import { AObjectComponent } from '../entity/AObjectComponent'
import type { GameInstance } from './GameInstance'
import type { World } from './World'
import type { Actor } from '../entity/Actor'

export class EditorGameBridgeComponent extends AObjectComponent<GameInstance> {
  /** 本实例是否游戏运行中（Game.launch 置 true，shutdown 置 false） */
  gameRunning = false

  /** 游戏 World（GameInstance 基类强类型字段） */
  get world(): World | null {
    return this.owner.world ?? null
  }

  /** 游戏场景（只读引用：编辑器渲染/遍历用，不修改） */
  get scene(): THREE.Scene | null {
    return this.world?.scene ?? null
  }

  /** 游戏全部 Actor（只读快照） */
  get actors(): Actor[] {
    return this.world?.actorMgr.GetAllActors() ?? []
  }
}
