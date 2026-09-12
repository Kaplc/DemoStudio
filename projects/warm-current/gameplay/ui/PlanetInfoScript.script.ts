/**
 * PlanetInfoScript — 星球信息面板 widget 行为脚本（planet_info.widget.json 根节点）
 *
 * 职责（数据由 GameMode.planetInfoSel 驱动，本脚本只做差分呈现）：
 *  - 非航线编辑模式点星球 → GameMode.openPlanetInfo(body) → vm.planetInfo 非空 → 面板展开并填内容
 *  - 点空地 / 面板内 ✕ → GameMode.closePlanetInfo() → vm.planetInfo 为 null → 面板收起
 *  - 内容按天体类型分支：地球（储量/需求/净流）、资源星（满载/油耗/航时，锁定星给解锁幕）、
 *    装饰行星（身份说明 + 双击进行星系提示）
 *  - 「近地轨道建设」按钮：打开该天体的轨道建设面板（GameMode.openOrbitBuild）
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 星球信息面板 widget 资产路径（HudScript 生成入口） */
export const PLANET_INFO_WIDGET = 'asset/blueprints/ui/planet_info.widget.json'

export default class PlanetInfoScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1

  override onStart(): void {
    if (!wcMode()) {
      logger.warn('[PlanetInfoScript] GameMode 未就绪')
    }
    // 面板内 ✕ 关闭 = 清空 GameMode.planetInfoSel（点空地同链路）
    const btn = findButton(this.actor, 'Btn_panel_close')
    if (btn) btn.onClick = () => wcMode()?.closePlanetInfo()
    // 近地轨道建设入口：打开该天体的轨道建设面板（互斥收起本面板，openOrbitBuild 内处理；
    // 太阳无近地轨道语义，不给入口行为）
    const orbitBtn = findButton(this.actor, 'Btn_orbit')
    if (orbitBtn) orbitBtn.onClick = () => {
      const sel = wcMode()?.planetInfoSel
      if (sel && sel !== 'sun') wcMode()?.openOrbitBuild(sel)
    }
    // 全息勘探入口：打开该天体的全息视图（无矿点天体按钮隐藏；openHologram 内有系统视角门）
    const holoBtn = findButton(this.actor, 'Btn_holo')
    if (holoBtn) holoBtn.onClick = () => {
      const sel = wcMode()?.planetInfoSel
      if (sel && sel !== 'sun') wcMode()?.openHologram(sel)
    }
    // 默认收起（脚本置位，先于首帧渲染）
    this.vis.set(this.actor, 'InfoBody', false)
    logger.info('[PlanetInfoScript] 星球信息面板就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const info = mode.buildViewModel().planetInfo
    this.vis.set(this.actor, 'InfoBody', !!info)
    if (!info) return
    // 全息勘探按钮：仅表里有矿点的天体显示（太阳恒隐藏）
    this.vis.set(this.actor, 'Btn_holo', info.hasDeposits)

    this.binder.set(findText(this.actor, 'TitleText'), info.name)
    // 类型行：资源星带解锁状态；地球/装饰行星给身份说明
    let kind = info.kind
    if (info.kind === '资源星') kind += info.unlocked ? ' · 已解锁' : ` · 第${info.unlockAct}幕解锁`
    else if (info.kind === '行星') kind += ' · 非资源星'
    this.binder.set(findText(this.actor, 'KindText'), kind)

    // 主信息：地球 = 收支态势；资源星 = 运力参数（锁定星以解锁提示替代）
    let main: string
    if (info.body === 'earth') {
      const flow = info.netFlow >= 0 ? `+${info.netFlow}` : `${info.netFlow}`
      main = `储量 ${info.earthH3} t · 需求 ${info.demand}/s\n净流 ${flow}/s`
    } else if (info.kind === '资源星' && info.unlocked) {
      main = `单船满载 ${info.load} t\n单程油耗 ${info.fuel} H3 · 单程约 ${Math.round(info.legS)}s`
    } else if (info.kind === '资源星') {
      main = `解锁后可从地球拖线建立氦-3 航线`
    } else {
      main = '无可采集资源 · 不参与航线运输'
    }
    this.binder.set(findText(this.actor, 'InfoText'), main)

    // 航线概况（装饰行星无航线概念，留空）
    const route = info.routable
      ? info.routes > 0
        ? `${info.routes} 条航线 · 配船 ${info.ships} 艘`
        : '暂无航线'
      : ''
    this.binder.set(findText(this.actor, 'RouteText'), route)

    // 引导：随航线编辑模式切换口径（编辑中点不到可拖星球，多见于锁定星/装饰天体）
    let hint: string
    if (!info.routable) hint = '双击行星可进入其行星系'
    else if (info.body !== 'earth' && !info.unlocked) hint = `第${info.unlockAct}幕解锁后可从地球拖线到此星球`
    else if (mode.routeEditMode) hint = '航线编辑中：从地球拖线到此星球即可建立航线'
    else hint = '点底部「航线编辑」进入后，可从地球拖线到此星球'
    this.binder.set(findText(this.actor, 'HintText'), hint)
  }
}
