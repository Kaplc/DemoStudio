/**
 * HoloHudScript — 全息态底部 HUD 行为脚本（holo_hud.widget.json 根节点）
 *
 * 职责（数据由 GameMode.hologramSel / vm.hologram 驱动，本脚本只做差分呈现）：
 *  - vm.hologram 非空（全息态）→ 底栏显形 + 全息风格（青蓝描边/光晕，与 hologram_panel 同观感）
 *  - 全息地球态底部工具条 = 4 按钮（2026-09-18 改版）：
 *      ⚡ 环节点 = 切换落位工具 + 面板切环节点视图；资源/地表建筑/轨道建筑 = 面板内容分类
 *      （内容分组切换在 HologramPanelScript；原建造/运输/航线/科研/聚能环/火箭设计入口下架，
 *       业务面板从主 HUD 底栏进——全息态专心地球建造）
 *  - 模式标题 + 状态行（口径在 holoHudModel，单测锁定）
 *  - ✕ 退出全息 = GameMode.closeHologram()（与 hologram_panel ✕ / Esc 同链路）
 *  - 8Hz 差分同步（TextBinder/VisBinder/ColorBinder，避免逐帧重绘）
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'
import { HOLO_TABS, holoHudModeTitle, holoHudStatusLine, holoTabButtonLabel, holoToolLabel } from './holoHudModel'

/** 全息 HUD widget 资产路径（HudScript 生成入口） */
export const HOLO_HUD_WIDGET = 'asset/blueprints/ui/holo_hud.widget.json'

export default class HoloHudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // ✕ 退出全息（与 hologram_panel ✕ / Esc 同链路；保持当前相机位置）
    bind('HoloBtn_holo_exit', () => wcMode()?.closeHologram())
    // ⚡ 环节点：切换落位工具（再点取消）+ 面板切到环节点视图
    bind('HoloBtn_ring_tool', () => {
      wcMode()?.setHoloTool('ring')
      wcMode()?.setHoloTab('ring')
      logger.info('[HoloHudScript] 环节点工具按钮点击（ring 工具 + 环节点视图）')
    })
    // 资源/地表建筑/轨道建筑：面板内容分类切换（放置工具状态不受影响）
    for (const tab of HOLO_TABS) {
      if (tab === 'ring') continue
      bind(`HoloBtn_tab_${tab}`, () => wcMode()?.setHoloTab(tab))
    }
    // 默认收起（脚本置位，先于首帧渲染）。走 setPanel：UIManager 会把面板根整树
    // 失活，此处需同步置面板根，保证后续打开时不被父链 effective 压制。
    this.vis.setPanel(this.actor, 'HoloBar', false)
    logger.info('[HoloHudScript] 全息 HUD 就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const holo = mode.buildViewModel().hologram
    this.vis.setPanel(this.actor, 'HoloBar', !!holo)
    if (!holo) return

    // 标题 + 状态行（口径在 holoHudModel，单测锁定）
    this.binder.set(findText(this.actor, 'HoloTitle'), holoHudModeTitle(holo))
    this.binder.set(findText(this.actor, 'HoloStatus'), holoHudStatusLine(holo))

    // 底部工具条仅全息地球态显示（矿点勘探态整组隐藏）
    const isEarth = holo.body === 'earth'
    this.vis.set(this.actor, 'HoloBtn_ring_tool', isEarth)
    for (const tab of HOLO_TABS) {
      if (tab !== 'ring') this.vis.set(this.actor, `HoloBtn_tab_${tab}`, isEarth)
    }
    if (isEarth && holo.earth) {
      const e = holo.earth
      // ⚡ 环节点按钮：放置工具选中态金色 ●（与主 HUD 航线编辑激活态同表达）
      const ringLabel = findText(this.actor, 'HoloToolRingLabel')
      this.binder.set(ringLabel, holoToolLabel(e.tools[0], '⚡ 环节点'))
      this.colors.set(ringLabel, e.tools[0]?.selected ? '#ffe9a8' : '#4fd8ff')
      // 分类按钮：当前内容分类金色 + ● 前缀
      for (const tab of HOLO_TABS) {
        if (tab === 'ring') continue
        const label = findText(this.actor, `HoloTabLabel_${tab}`)
        const active = e.tab === tab
        this.binder.set(label, holoTabButtonLabel(tab, active))
        this.colors.set(label, active ? '#ffe9a8' : '#4fd8ff')
      }
    }
  }

  override onDestroy(): void {
    // 随世界销毁，无需单独清理
  }
}
