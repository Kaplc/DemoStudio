/**
 * TopBarScript — 顶栏 HUD 行为脚本（面板总管）
 *
 * 职责：
 *  - 日期/速度/暂停/资源条目刷新（onUpdate 差分，避免逐帧重绘）
 *  - 九个面板按钮：同一时刻至多开一个主面板（开新关旧）
 *  - 地形图/政治图切换、存档按钮
 *  - 开局弹选国面板、事件队非空弹事件窗、终局弹结算窗、bootstrap 后常驻省面板
 */
import { UIButtonComponent, UITextComponent, logger, GameInstance } from '@/engine'
import { BehaviourScript } from '@/engine'
import { hoi4Mode, findButton, findText, TextBinder } from './uiCommon'
import type { Actor } from '@/engine'
import { formatGameDate } from '../core/GameTime'
import { resourceIncome } from '../core/Economy'

const PANEL_WIDGETS: Record<string, string> = {
  Btn_construction: 'asset/blueprints/ui/construction.widget.json',
  Btn_production: 'asset/blueprints/ui/production.widget.json',
  Btn_research: 'asset/blueprints/ui/research.widget.json',
  Btn_focus: 'asset/blueprints/ui/focus_tree.widget.json',
  Btn_diplomacy: 'asset/blueprints/ui/diplomacy.widget.json',
  Btn_recruit: 'asset/blueprints/ui/recruit.widget.json',
  Btn_laws: 'asset/blueprints/ui/laws.widget.json',
  Btn_designer: 'asset/blueprints/ui/division_designer.widget.json',
}

const COUNTRY_SELECT_WIDGET = 'asset/blueprints/ui/country_select.widget.json'
const EVENT_POPUP_WIDGET = 'asset/blueprints/ui/event_popup.widget.json'
const RESULT_WIDGET = 'asset/blueprints/ui/result_panel.widget.json'
const PROVINCE_WIDGET = 'asset/blueprints/ui/province_panel.widget.json'

export default class TopBarScript extends BehaviourScript {
  private binder = new TextBinder()
  /** 当前打开的主面板与其 widget 路径（省面板/事件窗/选国窗除外） */
  private mainPanel: Actor | null = null
  private mainPanelPath: string | null = null
  private countrySelect: Actor | null = null
  private eventPopup: Actor | null = null
  private resultPanel: Actor | null = null
  private provincePanel: Actor | null = null
  private resultShown: 'victory' | 'defeat' | null = null

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[TopBarScript] GameMode 未就绪')
      return
    }
    for (const [btnName, path] of Object.entries(PANEL_WIDGETS)) {
      const btn = findButton(this.actor, btnName)
      if (btn) btn.onClick = () => this.togglePanel(path)
    }
    const pauseBtn = findButton(this.actor, 'Btn_pause')
    if (pauseBtn) pauseBtn.onClick = () => {
      const m = hoi4Mode()
      m?.setPaused(!(m.coreState?.paused ?? true))
    }
    for (let s = 1; s <= 5; s++) {
      const b = findButton(this.actor, `Btn_speed${s}`)
      if (b) b.onClick = () => hoi4Mode()?.setSpeed(s)
    }
    const mapModeBtn = findButton(this.actor, 'Btn_mapmode')
    if (mapModeBtn) mapModeBtn.onClick = () => {
      const m = hoi4Mode()
      if (!m?.mapRender) return
      const next = m.mapRender.getMapMode() === 'political' ? 'terrain' : 'political'
      m.setMapMode(next)
    }
    const saveBtn = findButton(this.actor, 'Btn_save')
    if (saveBtn) saveBtn.onClick = () => {
      const inst = GameInstance.current as { saveGame?: () => Promise<boolean> } | null
      void inst?.saveGame?.()
    }
    logger.info('[TopBarScript] 顶栏按钮已绑定')
  }

  /** 开/关主面板（单实例互斥；点同按钮 = 关闭） */
  togglePanel(path: string): void {
    if (this.mainPanel) {
      const same = this.mainPanelPath === path
      this.closeMainPanel()
      if (same) return
    }
    const world = this.world
    if (!world) return
    const panel = world.ui.spawnUIActor(path)
    if (!panel) {
      logger.warn(`[TopBarScript] 面板生成失败: ${path}`)
      return
    }
    panel.bActive = true
    this.mainPanel = panel
    this.mainPanelPath = path
  }

  private closeMainPanel(): void {
    if (!this.mainPanel) return
    this.world?.ui.destroyUIActor(this.mainPanel)
    this.mainPanel = null
    this.mainPanelPath = null
  }

  override onUpdate(_dt: number): void {
    const mode = hoi4Mode()
    if (!mode) return
    // 面板自销毁（自身关闭按钮/事件窗放完）→ 清悬挂引用
    if (this.mainPanel?.bPendingDestroy) { this.mainPanel = null; this.mainPanelPath = null }
    if (this.countrySelect?.bPendingDestroy) this.countrySelect = null
    if (this.eventPopup?.bPendingDestroy) this.eventPopup = null
    if (this.resultPanel?.bPendingDestroy) this.resultPanel = null
    if (this.provincePanel?.bPendingDestroy) this.provincePanel = null
    const state = mode.coreState
    const tables = mode.bootedFlag ? mode.getTables() : null

    // 日期/暂停
    this.binder.set(findText(this.actor, 'DateText'), formatGameDate(mode.gameTime.hour))
    const pauseBtnActor = findButton(this.actor, 'Btn_pause')
    void pauseBtnActor

    if (!state || !tables) return

    // 资源行
    const c = state.playerTag ? state.countries[state.playerTag] : null
    const inc = state.playerTag ? resourceIncome(state, mode.map, state.playerTag) : { steel: 0, oil: 0 }
    this.binder.set(findText(this.actor, 'PpText'), c ? `${Math.floor(c.pp)}` : '-')
    this.binder.set(findText(this.actor, 'MpText'), c ? `${(c.manpower / 1000).toFixed(0)}k` : '-')
    this.binder.set(findText(this.actor, 'CivText'), c ? `${c.civFactories}` : '-')
    this.binder.set(findText(this.actor, 'MilText'), c ? `${c.milFactories}` : '-')
    this.binder.set(findText(this.actor, 'StabText'), c ? `${c.stability.toFixed(0)}%` : '-')
    this.binder.set(findText(this.actor, 'WsText'), c ? `${c.warSupport.toFixed(0)}%` : '-')
    this.binder.set(findText(this.actor, 'SteelText'), c ? `+${inc.steel.toFixed(0)}` : '-')
    this.binder.set(findText(this.actor, 'OilText'), c ? `+${inc.oil.toFixed(0)}` : '-')

    // 未选国 → 选国面板（玩家点"暂不选择"后不再自动弹，可从 GM 重开）
    if (!state.playerTag && !mode.countrySelectDismissed) {
      if (!this.countrySelect) {
        this.countrySelect = this.world?.ui.spawnUIActor(COUNTRY_SELECT_WIDGET) ?? null
        if (this.countrySelect) this.countrySelect.bActive = true
      }
    } else if (this.countrySelect) {
      this.world?.ui.destroyUIActor(this.countrySelect)
      this.countrySelect = null
    }

    // 省面板：bootstrap 且已选国后常驻（玩家点 × 关闭后不再自动弹，选中新省时重开）
    if (state.playerTag && !mode.provincePanelDismissed && !this.provincePanel) {
      this.provincePanel = this.world?.ui.spawnUIActor(PROVINCE_WIDGET) ?? null
      if (this.provincePanel) this.provincePanel.bActive = true
    }

    // 事件窗（队列非空；一次一条）
    if (state.playerTag && state.pendingEvents.length > 0 && !this.eventPopup) {
      this.eventPopup = this.world?.ui.spawnUIActor(EVENT_POPUP_WIDGET) ?? null
      if (this.eventPopup) this.eventPopup.bActive = true
    }

    // 终局
    if (state.result && !this.resultPanel && this.resultShown !== state.result) {
      this.resultShown = state.result
      this.resultPanel = this.world?.ui.spawnUIActor(RESULT_WIDGET) ?? null
      if (this.resultPanel) this.resultPanel.bActive = true
    }
  }

  override onDestroy(): void {
    this.closeMainPanel()
  }
}
