/**
 * ObjectRegistry — 全局对象注册表（模仿 UE GUObjectArray）
 *
 * 所有 OObject 构造时自动注册、markDestroyed 时自动注销。
 * 用途：销毁 World 时遍历注册表，回收所有归属于该 World 的对象
 * （组件 / Actor / GameMode / GameState / Controller / UI Actor ...），
 * 确保不遗漏任何"谁创建谁拥有"之外的漏网引用。
 *
 * 与语言 GC 的区别：JS GC 只回收"不可达"对象；注册表解决的是
 * "逻辑已死亡但仍有全局强引用（闭包/单例）"的对象 —— 通过显式回收切断。
 */
import type { OObject } from '../entity/OObject'
import type { World } from '../gameflow/World'

class ObjectRegistryImpl {
  private objects = new Set<OObject>()

  /** OObject 构造时注册 */
  register(obj: OObject): void {
    this.objects.add(obj)
  }

  /** markDestroyed 时注销（对象已死，不再需要回收） */
  unregister(obj: OObject): void {
    this.objects.delete(obj)
  }

  /** 当前存活对象数（调试用） */
  get size(): number {
    return this.objects.size
  }

  /**
   * 当前存活对象快照（调试/泄漏诊断用）。
   * 返回副本数组，供调用方记录基线后与后续状态对比。
   */
  snapshot(): OObject[] {
    return [...this.objects]
  }

  /**
   * 泄漏诊断：从当前存活集合中剔除基线（launch 时 snapshot 的结果），
   * 返回“基线之后新创建、且至今仍未 markDestroyed”的对象。
   */
  diffSince(baseline: ReadonlySet<OObject>): OObject[] {
    const result: OObject[] = []
    for (const obj of this.objects) {
      if (!baseline.has(obj)) result.push(obj)
    }
    return result
  }

  /**
   * 场景切换诊断：基线中仍存活（未 markDestroyed）且归属于指定 World 的 BObject。
   * 用于 SwitchScene 后检查旧场景对象（GameMode / GameState / Controller / Actor / HUD）是否全部回收。
   * 自动过滤 AObject 体系基础设施（World / GameInstance / UIManager / ActorManagerComponent 等均非 BObject，
   * 无 EndPlay 生命周期钩子）。注意：uid 已在 OObject 上，全部对象都有，不能用 uid 区分。
   */
  aliveGameObjectsOf(baseline: ReadonlySet<OObject>, world: World): OObject[] {
    const result: OObject[] = []
    for (const obj of baseline) {
      if (!this.objects.has(obj)) continue // 已 markDestroyed（正常回收）
      // 仅统计 BObject 体系（EndPlay 生命周期钩子是 BObject 独有）；AObject 基础设施不属于游戏对象
      const b = obj as Partial<{ EndPlay?: unknown }>
      if (typeof b.EndPlay !== 'function') continue
      if (!this.belongsTo(obj, world)) continue // 不属于本 World（其他 World / 编辑器对象）
      result.push(obj)
    }
    return result
  }

  /**
   * 判断对象是否归属于指定 World：
   *  - 对象自身 world === target（Actor / World 自身）
   *  - 或沿 owner 链（组件 → owner → ...）最终到达 target
   */
  private belongsTo(obj: OObject, target: World): boolean {
    let cur: unknown = obj
    let hops = 0
    while (cur && hops < 32) {
      if (cur === target) return true
      const c = cur as { world?: unknown; owner?: unknown }
      if (c.world === target) return true
      cur = c.owner ?? null // 组件链向上
      hops++
    }
    return false
  }

  /**
   * 回收所有归属于指定 World 的对象：
   *  - 有 EndPlay 的对象（BObject 体系）先 EndPlay（幂等，清理组件）
   *  - 全部 markDestroyed（终态标记 + 从注册表注销）
   *
   * 注意：场景移除等副作用由 World.Destroy 的具体清理（DestroyAllActors 等）负责，
   * 本方法只做"兜底回收"——处理 GameState / Controller / World 组件等漏网对象。
   */
  reclaimForWorld(world: World): void {
    const doomed: OObject[] = []
    for (const obj of this.objects) {
      if (this.belongsTo(obj, world)) doomed.push(obj)
    }
    for (const obj of doomed) {
      const b = obj as Partial<{ EndPlay: () => void }>
      try {
        if (typeof b.EndPlay === 'function') b.EndPlay()
      } catch (e) {
        // EndPlay 抛错不阻断回收
      }
      obj.markDestroyed()
    }
  }
}

/** 全局单例 */
export const ObjectRegistry = new ObjectRegistryImpl()
