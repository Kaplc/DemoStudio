/**
 * HoloHudScript — 全息态底部 HUD 行为脚本（holo_hud.widget.json 根节点）
 *
 * 职责（数据由 GameMode.hologramSel / vm.hologram 驱动，本脚本只做差分呈现）：
 *  - vm.hologram 非空（全息态）→ 底栏显形 + 全息风格（青蓝描边/光晕，与 hologram_panel 同观感）
 *  - 业务入口（建造/运输/航线/科研/聚能环/火箭设计）= 转发主 HUD 同名按钮点击（共用居中互斥逻辑）
 *  - 全息地球态：环节点落位 + 地表建筑工具按钮（直连 GameMode.setHoloTool，选中态金色 ●）
 *  - 模式标题 + 状态行（ghost 校验/落点引导/节点统计/选中详情首行），口径在 holoHudModel（单测锁定）
 *  - ✕ 退出全息 = GameMode.closeHologram()（与 hologram_panel ✕ / Esc 同链路）
 *  - 8Hz 差分同步（TextBinder/VisBinder/ColorBinder，避免逐帧重绘）
 */
import { BehaviourScript, logger } from '@/engine'
import type { Actor } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'
import { HOLO_TOOL_ROWS, holoHudModeTitle, holoHudStatusLine, holoToolLabel } from './holoHudModel'

/** 全息 HUD widget 资产路径（HudScript 生成入口；须挂在主 HUD 根节点下，本脚本经 actor.parent 找转发目标） */
export const HOLO_HUD_WIDGET = 'asset/blueprints/ui/holo_hud.widget.json'

/** 转发主 HUD 按钮的入口（节点名在主 HUD 与本 widget 中同名） */
const FORWARD_BTNS = ['Btn_build', 'Btn_transport', 'Btn_routes', 'Btn_research', 'Btn_ring', 'Btn_design'] as const

export default class HoloHudScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 主 HUD 根 Actor（onStart 缓存；转发按钮用） */
  private hud: Actor | null = null
  /** 工具行号 → 当前绑定工具 id（'ring' 或 building 表行键） */
  private rowToolIds: string[] = new Array(HOLO_TOOL_ROWS).fill('')

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 主 HUD 根：全息 HUD 由 HudScript 生成（与主 HUD 同挂在 HUD 容器下），向上找兄弟
    this.hud = this.actor.parent ?? null
    // ✕ 退出全息（与 hologram_panel ✕ / Esc 同链路；保持当前相机位置）
    bind('HoloBtn_holo_exit', () => wcMode()?.closeHologram())
    // 业务入口 = 转发主 HUD 同名按钮点击（共用居中互斥/独立面板 toggle 逻辑）
    for (const name of FORWARD_BTNS) {
      bind(`Holo${name}`, () => {
        const fwd = findButton(this.hud, name)
        if (fwd?.onClick) fwd.onClick()
        else logger.warn(`[HoloHudScript] 主 HUD 未找到 ${name}，转发失败`)
      })
    }
    // 全息地球工具行：ring = 环节点落位 / building = 地表建筑（再点 = 取消工具）
    bind('HoloBtn_ring_tool', () => wcMode()?.setHoloTool('ring'))
    for (let i = 0; i < HOLO_TOOL_ROWS; i++) {
      bind(`HoloBtn_tool_${i}`, () => {
        const id = this.rowToolIds[i]
        if (id) wcMode()?.setHoloTool('building', id)
      })
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

    // 全息地球工具区显隐（矿点勘探态整组隐藏）
    const isEarth = holo.body === 'earth'
    this.vis.set(this.actor, 'HoloBtn_ring_tool', isEarth)
    for (let i = 0; i < HOLO_TOOL_ROWS; i++) this.vis.set(this.actor, `HoloToolRow_${i}`, isEarth)
    if (isEarth && holo.earth) {
      const e = holo.earth
      // ring 按钮：选中态金色 ●（与主 HUD 航线编辑激活态同表达）
      const ringLabel = findText(this.actor, 'HoloToolRingLabel')
      this.binder.set(ringLabel, holoToolLabel(e.tools[0], '⚡ 环节点'))
      this.colors.set(ringLabel, e.tools[0]?.selected ? '#ffe9a8' : '#4fd8ff')
      // 地表建筑工具行池（下标顺延：tools[0] = ring）
      for (let i = 0; i < HOLO_TOOL_ROWS; i++) {
        const row = e.tools[i + 1]
        this.rowToolIds[i] = row?.id ?? ''
        const rowActor = `HoloToolRow_${i}`
        if (!row) {
          this.vis.set(this.actor, rowActor, false)
          continue
        }
        const label = findText(this.actor, `HoloToolLabel_${i}`)
        this.binder.set(label, holoToolLabel(row, row.name))
        this.colors.set(label, row.selected ? '#ffe9a8' : '#4fd8ff')
        this.vis.set(this.actor, rowActor, row.canUse || row.selected)
      }
    }
  }

  override onDestroy(): void {
    // 随世界销毁，无需单独清理
  }
}
