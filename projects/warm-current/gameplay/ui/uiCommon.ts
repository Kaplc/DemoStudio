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

/** 可见性差分缓存（按节点名；宿主树固定时安全）
 *
 * 走引擎 Actor.bActive 而非直接写 root.visible：bActive 的 setter 会 applyActiveTree
 * 递归整树（子树全停渲染）；直接写 visible 只藏单个节点，面板根/边框/标题/装饰仍
 * 留在绘制路径 —— warm 18 个常驻面板因此全量提交 GPU（2665 draw call → 20fps）。
 */
export class VisBinder {
  private last = new Map<string, boolean>()
  set(root: Actor | null, name: string, visible: boolean): void {
    if (this.last.get(name) === visible) return
    this.last.set(name, visible)
    const a = findChild(root, name)
    if (!a) return
    // 兜底：显示子节点时同步激活面板根。引擎 applyActiveTree 的生效值 =
    // 自身 bActive && 父链 effective —— 面板根失活时，子节点置 true 依然不可见。
    // UIManager 会把二级面板根默认整树失活，仅置 Body 会导致面板永远打不开，
    // 故此处统一兜底激活（对未失活的面板是无害的重复置位）。
    if (visible && root && !root.bActive) root.bActive = true
    a.bActive = visible
  }

  /**
   * 面板级显隐：同时作用"面板根"与"内容 Body"两处。
   *
   * 引擎 applyActiveTree 的生效值 = 自身 bActive && 父链 effective，即面板根失活时
   * 子节点无论 bActive 为何都不可见。故 UIManager 把面板根默认整树失活后，仅把
   * Body 置 true 无法让面板显形 —— 必须同步激活面板根，否则面板永远打不开。
   *
   * @param panel 面板根 Actor
   * @param bodyName 内容 Body 子节点名（传空串表示无 Body，只切面板根）
   */
  setPanel(panel: Actor | null, bodyName: string, visible: boolean): void {
    if (!panel) return
    if (panel.bActive !== visible) panel.bActive = visible
    if (bodyName) this.set(panel, bodyName, visible)
  }
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─── 游戏历（2026-09-15 真实自转公转周期配套：1 仿真秒 = 1 游戏分钟，见 B.celestial） ───

/** 仿真秒 → 游历秒（×60）与日内时刻（HH:MM）共用换算；86400 游历秒 = 1 游历日，
 *  与真实地球自转同源的昼夜钟（太阳日 ≈86400 游历秒） */
function gameClockParts(sec: number): { d: number; hh: string; mm: string } {
  const gs = Math.max(0, Math.floor(sec)) * 60
  const d = Math.floor(gs / 86400)
  const h = Math.floor((gs % 86400) / 3600)
  const m = Math.floor((gs % 3600) / 60)
  return { d, hh: String(h).padStart(2, '0'), mm: String(m).padStart(2, '0') }
}

/** 游历时刻（HUD 时钟）：`第N天 HH:MM` */
export function fmtGameClock(sec: number): string {
  const { d, hh, mm } = gameClockParts(sec)
  return `第${d + 1}天 ${hh}:${mm}`
}

/** 游历时长（结算屏存活时长）：`N天HH:MM`，首日内省略天数 */
export function fmtGameDur(sec: number): string {
  const { d, hh, mm } = gameClockParts(sec)
  return d > 0 ? `${d}天${hh}:${mm}` : `${hh}:${mm}`
}
