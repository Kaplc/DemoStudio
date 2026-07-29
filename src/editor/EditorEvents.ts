/**
 * EditorEventBus — 编辑器全局事件总线
 *
 * 解耦底层模块（SelectionManager、BlueprintPreviewManager 等）与 Zustand store / UI 组件。
 * 事件生产者只负责 emit，消费者（store bridge、组件）通过 on() 订阅。
 *
 * 事件名定义在 EditorEventNames.ts 中。
 *
 * 设计约定：
 *   - 事件名使用 `domain:action` 格式
 *   - on() 返回取消订阅函数
 *   - 不依赖任何 React / Zustand，纯 TypeScript
 */

type Listener = (...args: any[]) => void

class EditorEventBus {
  private listeners = new Map<string, Set<Listener>>()

  /** 订阅事件，返回取消订阅函数 */
  on(event: string, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
    return () => {
      this.listeners.get(event)?.delete(listener)
    }
  }

  /** 触发事件 */
  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((fn) => {
      try { fn(...args) } catch (e) { console.error(`[EditorEventBus] ${event} 回调异常:`, e) }
    })
  }

  /** 清除所有监听（仅用于测试/重置） */
  clear(): void {
    this.listeners.clear()
  }
}

/** 全局编辑器事件总线单例 */
export const editorBus = new EditorEventBus()
