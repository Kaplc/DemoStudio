/**
 * ColorblindService — 色盲模式色板服务（资产级替换）
 *
 * 方案：内置 3 套色盲色板（deuteranopia 绿盲 / protanopia 红盲 / tritanopia 蓝黄盲），
 * 按「语义色 → 替代色」的精确颜色映射，遍历 UI Actor 树替换
 * UIImageComponent.color / UITextComponent.color（红→橙棕、绿→蓝等）。
 *
 * 设计要点：
 *  - 可撤销：首次替换时记录每个组件的原始色（WeakMap），切换模式前先还原再应用新模式
 *  - 只替换映射表中出现的颜色：未映射的颜色（中性面板色等）不受影响
 *  - 引擎层无全局设置持久化（由项目按需接入设置 UI）
 *
 * 用法：
 *   ColorblindService.instance.attach(world.ui)
 *   ColorblindService.instance.setMode('deuteranopia')   // 切换色盲模式
 *   ColorblindService.instance.setMode('off')            // 还原
 *
 * 色板映射（输入为资产里实际使用的语义色）：
 *  - danger 红 / ally 绿 / warning 橙 / info 蓝 / coin 金
 */
import { logger } from '../Logger'
import type { Actor } from '../entity/Actor'
import type { UIManager } from './UIManager'
import { UIImageComponent } from './UIImageComponent'
import { UITextComponent } from './UITextComponent'

export type ColorblindMode = 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia'

/** 语义色（原色）→ 各色盲模式替代色 映射表 */
export const COLORBLIND_PALETTES: Record<Exclude<ColorblindMode, 'off'>, Record<string, string>> = {
  // 绿盲（最常见）：红→橙红（亮度区分），绿→蓝（保持明度）
  deuteranopia: {
    '#e53935': '#e07b00', '#ff0000': '#ff7f00', '#d32f2f': '#e07000', '#c62828': '#c05e00',
    '#4caf50': '#2f6fb5', '#00ff00': '#0088ff', '#388e3c': '#2a5d9e', '#2e7d32': '#24528c',
    '#ff9800': '#ffb74d', '#ff6f00': '#ff8f00', '#f57c00': '#ff9c33',
    '#ffd700': '#ffb300',
  },
  // 红盲：红→深棕（亮度保留），绿→蓝绿
  protanopia: {
    '#e53935': '#8a4f00', '#ff0000': '#a04000', '#d32f2f': '#7a4500', '#c62828': '#6e3d00',
    '#4caf50': '#1f7fb0', '#00ff00': '#00a0e0', '#388e3c': '#1c6f9e', '#2e7d32': '#19628c',
    '#2196f3': '#2b8fd6', '#1976d2': '#2b7fbf',
    '#ffd700': '#ffb300',
  },
  // 蓝黄盲：蓝→青绿，黄→粉紫，红→粉
  tritanopia: {
    '#e53935': '#ff5c8a', '#ff0000': '#ff4d6d', '#d32f2f': '#e34d78', '#c62828': '#d14570',
    '#2196f3': '#26a69a', '#1976d2': '#00897b', '#1e88e5': '#15958a',
    '#ffd700': '#f06292', '#ffc107': '#ec7a9e',
  },
}

/** 所有色板覆盖的原始语义色集合（切换模式前还原用） */
export const COLORBLIND_SOURCE_COLORS: string[] = [
  '#e53935', '#ff0000', '#d32f2f', '#c62828',
  '#4caf50', '#00ff00', '#388e3c', '#2e7d32',
  '#ff9800', '#ff6f00', '#f57c00',
  '#2196f3', '#1976d2', '#1e88e5',
  '#ffd700', '#ffc107',
]

export class ColorblindService {
  private static _instance: ColorblindService | null = null

  /** 全局单例（懒创建） */
  static get instance(): ColorblindService {
    if (!ColorblindService._instance) ColorblindService._instance = new ColorblindService()
    return ColorblindService._instance
  }

  private _ui: UIManager | null = null
  private _mode: ColorblindMode = 'off'
  /** 组件 → 原始色（首次应用时记录，切换/还原用） */
  private _originals = new Map<object, string>()

  /** 当前色盲模式 */
  get mode(): ColorblindMode { return this._mode }

  /** 是否已挂接 UIManager */
  get attached(): boolean { return this._ui !== null }

  /** 挂接 UIManager（项目启动时调用一次） */
  attach(ui: UIManager): void {
    this._ui = ui
    logger.info('[ColorblindService] 已挂接 UIManager')
  }

  /** 解除挂接并还原 */
  detach(): void {
    this._restore()
    this._ui = null
  }

  /**
   * 切换色盲模式。
   * @param mode off=还原原色；deuteranopia/protanopia/tritanopia=应用对应色板
   */
  setMode(mode: ColorblindMode): void {
    if (mode === this._mode) return
    // 先还原（用首次记录的原始色），再应用新模式
    this._restore()
    this._mode = mode
    if (mode !== 'off') this._apply(mode)
    logger.info(`[ColorblindService] 色盲模式 → ${mode}（已替换 ${this._originals.size} 个颜色）`)
  }

  // ─── 内部 ─────────────────────────────────

  /** 还原所有已替换组件到原始色，并清空记录 */
  private _restore(): void {
    if (this._originals.size === 0) return
    for (const [comp, original] of this._originals) {
      if (comp instanceof UIImageComponent) comp.color = original
      else if (comp instanceof UITextComponent) comp.color = original
    }
    this._originals.clear()
  }

  /** 应用色板：遍历 UI Actor 树，替换映射命中颜色（记录原始色） */
  private _apply(mode: Exclude<ColorblindMode, 'off'>): void {
    const ui = this._ui
    if (!ui) {
      logger.warn('[ColorblindService] 未挂接 UIManager，跳过色板应用')
      return
    }
    const palette = COLORBLIND_PALETTES[mode]
    const walk = (a: Actor): void => {
      // UIImageComponent：替换 color
      const img = a.getComponent(UIImageComponent)
      if (img) {
        const replacement = palette[img.color.toLowerCase()]
        if (replacement && !this._originals.has(img)) {
          this._originals.set(img, img.color)
          img.color = replacement
        }
      }
      // UITextComponent：替换 color
      const txt = a.getComponent(UITextComponent)
      if (txt) {
        const replacement = palette[txt.color.toLowerCase()]
        if (replacement && !this._originals.has(txt)) {
          this._originals.set(txt, txt.color)
          txt.color = replacement
        }
      }
      for (const child of a.getChildren()) walk(child)
    }
    for (const actor of ui.getAllUIActors()) walk(actor)
  }
}
