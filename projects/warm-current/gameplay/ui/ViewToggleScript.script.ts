/**
 * ViewToggleScript — 星图视角切换面板行为脚本（view_toggle.widget.json 根节点）
 *
 * 由 HudScript 一次 spawn（research_panel 同款惯例），常驻右下角：
 *  - Btn_view_earth → GameMode.setViewMode('earth')：地球系跟随视角（开局默认）
 *  - Btn_view_solar → GameMode.setViewMode('solar')：太阳系全景
 * 选中态高亮：当前视角按钮文本亮色（0.15s 差分刷新，ColorBinder 避免逐帧重绘）。
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, findButton, findText, wcMode } from './uiCommon'

/** 视角切换 widget 资产路径（HudScript spawn 用） */
export const VIEW_TOGGLE_WIDGET = 'asset/blueprints/ui/view_toggle.widget.json'

const ACTIVE_COLOR = '#ffd76a'
const IDLE_COLOR = '#cfe3ee'

export default class ViewToggleScript extends BehaviourScript {
  private colors = new ColorBinder()
  private acc = 0.2

  override onStart(): void {
    const bind = (name: string, mode: 'earth' | 'solar'): void => {
      const btn = findButton(this.actor, name)
      if (!btn) {
        logger.warn(`[ViewToggleScript] ${name} 未找到`)
        return
      }
      btn.onClick = () => {
        const m = wcMode()
        if (!m) return
        m.setViewMode(mode)
        logger.info(`[ViewToggleScript] 切换视角 → ${mode}`)
      }
    }
    bind('Btn_view_earth', 'earth')
    bind('Btn_view_solar', 'solar')
    this.refresh()
    logger.info('[ViewToggleScript] 视角切换面板就绪（地球系 / 太阳系）')
  }

  override onUpdate(dt: number): void {
    this.acc += dt
    if (this.acc < 0.15) return
    this.acc = 0
    this.refresh()
  }

  /** 选中态刷新：当前视角按钮文本亮色（差分写入，无变化不触碰组件） */
  private refresh(): void {
    const earthActive = wcMode()?.viewMode === 'earth'
    this.colors.set(findText(this.actor, 'Label_earth'), earthActive ? ACTIVE_COLOR : IDLE_COLOR)
    this.colors.set(findText(this.actor, 'Label_solar'), earthActive ? IDLE_COLOR : ACTIVE_COLOR)
  }
}
