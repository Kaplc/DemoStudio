/**
 * GameEvents — 游戏内事件总线
 *
 * 各组件通过 emit() 广播事件，其他组件通过 on() 订阅。
 * 由 FishGameInstance 创建并持有生命周期，stop 时自动清空。
 */
type Listener<T> = (data: T) => void

export class GameEvents {
  private listeners = new Map<string, Set<Listener<unknown>>>()

  on<T>(event: string, cb: Listener<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb as Listener<unknown>)
    return () => this.listeners.get(event)?.delete(cb as Listener<unknown>)
  }

  emit<T>(event: string, data: T): void {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }

  clear(): void {
    this.listeners.clear()
  }
}
