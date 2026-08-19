/**
 * EditorActorComponent — 编辑器 Actor 生成组件
 *
 * 提供编辑器专用的 Spawn / Instantiate 转发方法。
 * 由编辑器按需创建并 addComponent(EditorActorComponent) 到 World。
 *
 * 注意：游戏代码请用 spawnActor(actor) / BlueprintAsset.Instantiate()。
 */
import { AObjectComponent } from '../entity/AObjectComponent'
import type { World } from './World'
import type { Actor } from '../entity/Actor'
import type { PropertyPatch } from '../tools/deepMerge'
import type { BlueprintComponentDef } from '../asset/BlueprintAsset'

export class EditorActorComponent extends AObjectComponent<World> {
  /**
   * 将已有 Actor 实例注册到世界（编辑器内部用）。
   */
  Spawn<T extends Actor>(actor: T): T {
    return this.owner.actorMgr.SpawnActor(actor)
  }

  /**
   * 从 Blueprint 实例化 Actor（编辑器内部用）。
   */
  Instantiate(
    path: string,
    overrides?: PropertyPatch,
    componentOverrides?: BlueprintComponentDef[],
  ): Actor | null {
    return this.owner.actorMgr.SpawnActorFromBlueprint(path, overrides, componentOverrides)
  }
}
