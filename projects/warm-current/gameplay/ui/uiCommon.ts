/**
 * uiCommon — WarmCurrent UI 脚本公共工具（hoi4 同款）
 *
 * 模式访问、控件查找、文本差分刷新。
 * 注意：此文件不是 .script.ts（不注册为脚本），仅被脚本 import。
 */
import { GameInstance, UIButtonComponent, UITextComponent } from '@/engine'
import type { Actor } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 当前 GameMode（脚本侧统一入口；未运行返回 null） */
export function wcMode(): WarmCurrentGameMode | null {
  const inst = GameInstance.current
  const mode = inst?.world?.gameMode
  return (mode as WarmCurrentGameMode) ?? null
}

/** 递归查找子 Actor（按 root.name 精确匹配） */
export function findChild(root: Actor | null, name: string): Actor | null {
  if (!root) return null
  const walk = (a: Actor): Actor | null => {
    for (const c of a.getChildren()) {
      if (c.root.name === name) return c
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}

/** 查找子 Actor 的文本组件 */
export function findText(root: Actor | null, name: string): UITextComponent | null {
  return findChild(root, name)?.getComponent(UITextComponent) ?? null
}

/** 查找子 Actor 的按钮组件 */
export function findButton(root: Actor | null, name: string): UIButtonComponent | null {
  return findChild(root, name)?.getComponent(UIButtonComponent) ?? null
}

/** 文本差分刷新器（每帧/每tick 调用安全，只有变化才写组件） */
export class TextBinder {
  private last = new Map<UITextComponent, string>()
  set(t: UITextComponent | null | undefined, text: string): void {
    if (!t) return
    if (this.last.get(t) === text) return
    this.last.set(t, text)
    t.text = text
  }
}

/** 颜色差分刷新器（避免每帧 applyAll） */
export class ColorBinder {
  private last = new Map<UITextComponent, string>()
  set(t: UITextComponent | null | undefined, color: string): void {
    if (!t) return
    if (this.last.get(t) === color) return
    this.last.set(t, color)
    t.color = color
  }
}

/** 可见性差分缓存（按节点名；宿主树固定时安全） */
export class VisBinder {
  private last = new Map<string, boolean>()
  set(root: Actor | null, name: string, visible: boolean): void {
    if (this.last.get(name) === visible) return
    this.last.set(name, visible)
    const a = findChild(root, name)
    if (a) a.root.visible = visible
  }
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
