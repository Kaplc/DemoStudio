/**
 * ResourcesComponent — 资源系统组件（金币等经济资源的通用钱包）
 *
 * 挂载到持有资源的 AObject 上（GameInstance / GameMode / Actor 均可），
 * 以 `资源名 → 数量` 的 Map 形式管理多资源（如 'coins'）。
 * 提供统一的 查询/增/减/校验 接口，资源变化通过 onChange 回调通知
 * （HUD 金币文本、兵营面板状态栏等据此刷新）。
 *
 * 本项目约定：挂载到 FishGameInstance（跨阶段共享金币，基地/出征同一钱包），
 * 各 GameMode / Pawn 直接取组件使用，不做转发。
 *
 * 用法：
 *   const res = new ResourcesComponent(instance, { coins: INITIAL_COINS })
 *   instance.addComponent(res)
 *   res.spend('coins', 25)   // 足够则扣减返回 true
 *   res.add('coins', 100)
 *   res.onChange = () => hudText.text = `金币: ${res.get('coins')}`
 */
import { AObjectComponent } from '@/engine'
import type { AObject } from '@/engine'

/** 资源钱包接口：任何"能扣费"的对象（组件 / GameMode）实现此接口即可被消费方使用 */
export interface ResourceWallet {
  /** 当前某资源数量（如 'coins'） */
  get(resource: string): number
  /** 尝试扣减某资源：足够则扣并返回 true；不足返回 false 不扣 */
  spend(resource: string, amount: number): boolean
}

export class ResourcesComponent extends AObjectComponent<AObject> {
  /** 资源表：资源名 → 数量（如 'coins' → 100） */
  private resources = new Map<string, number>()

  /** 资源变化回调（add/spend/set 后触发，用于刷新 UI） */
  onChange: (() => void) | null = null

  constructor(owner: AObject, initial: Record<string, number> = {}) {
    super(owner)
    this.name = 'ResourcesComponent'
    for (const [k, v] of Object.entries(initial)) {
      this.resources.set(k, v)
    }
  }

  // ═════════ 查询 ═════════

  /** 获取资源数量（未初始化返回 0） */
  get(resource: string): number {
    return this.resources.get(resource) ?? 0
  }

  /** 是否拥有 >= amount 的指定资源 */
  has(resource: string, amount: number): boolean {
    return this.get(resource) >= amount
  }

  /** 资源名列表 */
  getResourceNames(): string[] {
    return [...this.resources.keys()]
  }

  // ═════════ 变更 ═════════

  /** 设置资源为指定数量（>= 0） */
  set(resource: string, value: number): void {
    const v = Math.max(0, Math.floor(value))
    if (this.resources.get(resource) === v) return
    this.resources.set(resource, v)
    this.onChange?.()
  }

  /** 增加资源 */
  add(resource: string, amount: number): void {
    if (amount <= 0) return
    this.resources.set(resource, this.get(resource) + Math.floor(amount))
    this.onChange?.()
  }

  /**
   * 尝试扣减资源（消费方唯一入口）：
   * 足够 → 扣减并返回 true；不足 → 不扣减返回 false。
   */
  spend(resource: string, amount: number): boolean {
    if (amount <= 0) return true
    if (!this.has(resource, amount)) return false
    this.resources.set(resource, this.get(resource) - Math.floor(amount))
    this.onChange?.()
    return true
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return {
      ...Object.fromEntries(this.resources),
      ResourceCount: this.resources.size,
    }
  }
}
