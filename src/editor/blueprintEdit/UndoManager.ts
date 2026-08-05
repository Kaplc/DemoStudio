/**
 * UndoManager — 蓝图资产撤销/重做快照栈（纯内存，不涉及磁盘）
 *
 * 以蓝图注册 key（asset/...）为粒度维护独立栈：
 *  - push：操作前调用，保存"动作前"完整资产快照（JSON 深拷贝）
 *  - undo/redo：弹出快照并返回（调用方负责应用 + 刷新预览）
 *  - 新操作自动清空 redo 栈（标准撤销语义）
 *
 * 单资产栈上限 50 条，超出丢弃最旧。
 */

const MAX_STACK = 50

interface AssetStacks {
  undo: unknown[]
  redo: unknown[]
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class UndoManager {
  private static stacks = new Map<string, AssetStacks>()

  /** 操作前调用：保存动作前快照（自动清空 redo） */
  static push(key: string, snapshot: unknown): void {
    let s = this.stacks.get(key)
    if (!s) {
      s = { undo: [], redo: [] }
      this.stacks.set(key, s)
    }
    s.undo.push(clone(snapshot))
    if (s.undo.length > MAX_STACK) s.undo.shift()
    s.redo.length = 0
  }

  /** 撤销：传入当前状态（压入 redo 栈），返回要恢复的快照；无历史返回 null */
  static undo(key: string, current: unknown): unknown | null {
    const s = this.stacks.get(key)
    if (!s || s.undo.length === 0) return null
    const snap = s.undo.pop()!
    s.redo.push(clone(current))
    return clone(snap)
  }

  /** 重做：传入当前状态（压回 undo 栈），返回要恢复的快照；无重做记录返回 null */
  static redo(key: string, current: unknown): unknown | null {
    const s = this.stacks.get(key)
    if (!s || s.redo.length === 0) return null
    const snap = s.redo.pop()!
    s.undo.push(clone(current))
    return clone(snap)
  }

  static canUndo(key: string): boolean {
    return (this.stacks.get(key)?.undo.length ?? 0) > 0
  }

  static canRedo(key: string): boolean {
    return (this.stacks.get(key)?.redo.length ?? 0) > 0
  }

  /** 关闭单个资产/页签时清空其栈（重新打开回到干净状态，不残留旧历史） */
  static clear(key: string): void {
    this.stacks.delete(key)
  }

  /** 切换工程/关闭全部资产时清空所有栈 */
  static clearAll(): void {
    this.stacks.clear()
  }

  /** 调试用：栈深 */
  static depth(key: string): { undo: number; redo: number } {
    const s = this.stacks.get(key)
    return { undo: s?.undo.length ?? 0, redo: s?.redo.length ?? 0 }
  }
}
