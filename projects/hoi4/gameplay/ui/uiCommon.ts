/**
 * uiCommon — Hoi4 UI 脚本公共工具
 *
 * 模式访问、控件查找、文本差分刷新、行模板派生。
 * 注意：此文件不是 .script.ts（不注册为脚本），仅被脚本 import。
 */
import { BehaviourScript, UIButtonComponent, UITextComponent, logger, GameInstance } from '@/engine'
import type { Actor } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'

/** 当前 GameMode（脚本侧统一入口；未运行返回 null） */
export function hoi4Mode(): Hoi4GameMode | null {
  const inst = GameInstance.current
  const mode = inst?.world?.gameMode
  return (mode as Hoi4GameMode) ?? null
}

/** 递归查找子 Actor */
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

/** 脚本基类：统一 mode 守卫 + 关闭按钮绑定 */
export class Hoi4PanelScript extends BehaviourScript {
  protected mode(): Hoi4GameMode | null {
    return hoi4Mode()
  }

  /** 面板脚本入口守卫：mode 未就绪返回 false（onStart 里用） */
  protected requireMode(): Hoi4GameMode | null {
    const m = hoi4Mode()
    if (!m) logger.warn(`[${this.constructor.name}] GameMode 未就绪，跳过绑定`)
    return m
  }

  /** 绑定关闭按钮（默认节点名 Btn_close → 销毁宿主） */
  protected bindClose(): void {
    const btn = findButton(this.actor, 'Btn_close')
    if (btn) btn.onClick = () => this.closePanel()
  }

  /** 关闭面板（销毁宿主根 Actor） */
  closePanel(): void {
    const w = this.world
    if (!w || !this.actor) return
    w.ui.destroyUIActor(this.actor)
  }
}
