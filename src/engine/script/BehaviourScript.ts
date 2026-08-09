/**
 * BehaviourScript — UI 资产可挂载的行为脚本基类（Unity MonoBehaviour 对应物）
 *
 * 与 Component 并列的轻量行为载体：由 UIScriptComponent 在 BeginPlay 时实例化、
 * 注入宿主 Actor，并转发生命周期：
 *   - onStart(args?)  树构建完成、actor 注入后调用一次（绑定按钮 / 初始化引用）
 *   - onUpdate(dt)     每帧调用（驱动动态 UI）
 *   - onDestroy()      宿主销毁时调用（清理引用 / 取消订阅）
 *
 * 继承 BObject：纳入引擎对象体系（构造自动注册到 ObjectRegistry，获得 uid/name 身份），
 * 宿主销毁时由 UIScriptComponent 调 EndPlay() —— BObject.EndPlay 自动 markDestroyed 注销。
 * 脚本内部可在异步回调/定时器入口调用 assertValid() 防御“已销毁脚本被调用”。
 *
 * 用法：写一个子类，默认导出，文件用 `.script.ts` 后缀；项目 asset/index.ts 用
 * import.meta.glob 自动扫描注册（详见 ScriptRegistry）。资产中通过 UIScriptComponent
 * 的 `script` 属性按路径式 id 引用。
 */
import { BObject } from '../entity/BObject'
import type { Actor } from '../entity/Actor'
import type { World } from '../gameflow/World'
import type { GameMode } from '../gameflow/GameMode'

export class BehaviourScript extends BObject {
  /** 宿主 Actor（由 UIScriptComponent 在 BeginPlay 时注入） */
  actor!: Actor

  /** uid/name 继承自 BObject；name 取实际子类名（如 BaseHudScript） */
  constructor() {
    super(new.target.name)
  }

  /** 所在世界（= actor.world） */
  get world(): World | null {
    return this.actor?.world ?? null
  }

  /** 当前 GameMode 便捷访问（UI 脚本常需调用 GameMode 的方法） */
  get gameMode(): GameMode | null {
    return this.actor?.world?.gameMode ?? null
  }

  /** 生命周期：树就绪后调用一次 */
  onStart(_args?: Record<string, unknown>): void {
    this.assertValid('脚本 onStart')
  }

  /** 生命周期：每帧调用 */
  onUpdate(_deltaTime: number): void {
    this.assertValid('脚本 onUpdate')
  }

  /** 生命周期：宿主销毁时调用 */
  onDestroy(): void {
    this.assertValid('脚本 onDestroy')
  }

  // ─── 便捷查询（委托宿主 Actor）───

  /**
   * 在宿主 Actor 子树中递归查找名为 name 的子 Actor（按 root.name 精确匹配）。
   * 供脚本按节点名定位 UI 控件（如 'Btn_townhall'）。
   */
  findInChildren(name: string): Actor | null {
    if (!this.actor) return null
    const walk = (a: Actor): Actor | null => {
      for (const child of a.getChildren()) {
        if (child.root.name === name) return child
        const hit = walk(child)
        if (hit) return hit
      }
      return null
    }
    return walk(this.actor)
  }
}
