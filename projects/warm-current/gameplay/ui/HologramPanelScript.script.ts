/**
 * HologramPanelScript — 全息勘探面板 widget 行为脚本（hologram_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.hologramSel / holoDepositSel 驱动，本脚本只做差分呈现）：
 *  - 星球信息面板「全息勘探」按钮 → GameMode.openHologram(body) → vm.hologram 非空 → 面板展开
 *  - 面板内 ✕ / Esc → GameMode.closeHologram() → vm.hologram 为 null → 收起
 *  - 矿点行（mineral_deposit 表序）：点行 = 选中/取消该矿点（再点同行取消；3D 外环同步高亮）
 *  - 建造区（mine_building 表键序）：「建造」→ MiningComponent.tryPlace(选中矿点, 类型)
 *  - 全息地球态（body==='earth'）：节点工具行（⚡ 环节点落位）+ 地表建筑工具行
 *    （building 表行键；点「选用」进入放置，点球面落位，融化圈门槛在 GameMode 校验）
 *  - 色点 ◆ = 矿种表现色（ColorBinder 差分写色）
 *  - 8Hz 差分同步；矿点行池 HOLO_DEPOSIT_ROWS / 建造行池 HOLO_BUILD_ROWS / 工具行池 HOLO_TOOL_ROWS
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 全息勘探面板 widget 资产路径（HudScript 生成入口） */
export const HOLOGRAM_PANEL_WIDGET = 'asset/blueprints/ui/hologram_panel.widget.json'

/** 矿点行池容量（超出 mineral_deposit 表中该天体矿点数的行不显示） */
const HOLO_DEPOSIT_ROWS = 4
/** 建造行池容量（超出 mine_building 表行数的类型不显示） */
const HOLO_BUILD_ROWS = 3
/** 全息地球工具行池容量（ring 1 行 + building 表行；超出表行数的类型不显示） */
const HOLO_TOOL_ROWS = 3

export default class HologramPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定矿点 id（行回调经此取参，避免闭包过期） */
  private rowDepositIds: string[] = new Array(HOLO_DEPOSIT_ROWS).fill('')
  /** 行号 → 当前绑定矿建类型 id */
  private rowBuildIds: string[] = new Array(HOLO_BUILD_ROWS).fill('')
  /** 行号 → 当前绑定工具 id（'ring' 或 building 表行键） */
  private rowToolIds: string[] = new Array(HOLO_TOOL_ROWS).fill('')

  /** 面板当前是否展开（唯一权威 = GameMode.hologramSel） */
  get isOpen(): boolean {
    return !!wcMode()?.hologramSel
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭 = 退出全息（复位俯视取景）
    bind('Btn_panel_close', () => wcMode()?.closeHologram())
    // 矿点行：点行选中；再点同行取消（3D 标记外环同步高亮）
    for (let i = 0; i < HOLO_DEPOSIT_ROWS; i++) {
      bind(`DepositRow_${i}`, () => {
        const mode = wcMode()
        const id = this.rowDepositIds[i]
        if (!mode || !id) return
        mode.selectHoloDeposit(mode.holoDepositSel === id ? null : id)
      })
    }
    // 建造区「建造」：对当前选中矿点落位矿建（校验在 placementIssue，失败 hint）
    for (let i = 0; i < HOLO_BUILD_ROWS; i++) {
      bind(`Btn_build_${i}`, () => {
        const mode = wcMode()
        const typeId = this.rowBuildIds[i]
        if (!mode?.holoDepositSel || !typeId) return
        mode.mining.tryPlace(mode.holoDepositSel, typeId)
      })
    }
    // 全息地球工具行：ring = 环节点落位 / building = 地表建筑（再点 = 取消工具）
    bind('Btn_tool_ring', () => {
      const mode = wcMode()
      if (mode) mode.setHoloTool('ring')
    })
    for (let i = 0; i < HOLO_TOOL_ROWS; i++) {
      bind(`Btn_tool_${i}`, () => {
        const mode = wcMode()
        const id = this.rowToolIds[i]
        if (!mode || !id) return
        mode.setHoloTool('building', id)
      })
    }
    // 默认收起（脚本置位，先于首帧渲染）
    this.vis.set(this.actor, 'HoloBody', false)
    logger.info('[HologramPanelScript] 全息勘探面板就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const holo = mode.buildViewModel().hologram
    this.vis.set(this.actor, 'HoloBody', !!holo)
    if (!holo) return

    const isEarth = holo.body === 'earth'
    this.binder.set(findText(this.actor, 'TitleText'),
      isEarth ? `全息地球 · ${holo.bodyName}建造` : `全息勘探 · ${holo.bodyName}`)

    // 堆场水位行（资源星专属；2026-09-13 堆场耦合——产量入堆场、船从堆场拉货）
    this.vis.set(this.actor, 'StockText', !isEarth && !!holo.stockyard)
    if (!isEarth && holo.stockyard) {
      const y = holo.stockyard
      const pct = y.cap > 0 ? Math.floor((y.stock / y.cap) * 100) : 0
      this.binder.set(findText(this.actor, 'StockText'),
        `堆场 ${Math.floor(y.stock)}/${y.cap} t（${pct}%）· 产量 ${y.miningRate}/s${pct >= 100 ? ' · ⚠ 已满停产' : ''}`)
    }

    // 全息地球工具区显隐（矿点勘探态整组隐藏）
    this.vis.set(this.actor, 'Btn_tool_ring', isEarth)
    for (let i = 0; i < HOLO_TOOL_ROWS; i++) this.vis.set(this.actor, `ToolRow_${i}`, isEarth)
    // 提示行口径分支
    this.binder.set(findText(this.actor, 'HintText'), isEarth
      ? '右键拖拽旋转 · 选中工具后点球面落位 · Esc 取消/退出'
      : '拖拽旋转检视 · 点矿点或列表行选中 · Esc 退出')

    // 矿点行池（表序；色点 = 矿种表现色，状态列带选中标记）
    for (let i = 0; i < HOLO_DEPOSIT_ROWS; i++) {
      const row = holo.deposits[i]
      this.rowDepositIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `DepositRow_${i}`, !!row)
      if (!row) continue
      this.colors.set(findText(this.actor, `Dot_${i}`), row.color)
      this.binder.set(findText(this.actor, `DepositInfo_${i}`),
        `${row.typeName} · 余 ${Math.round(row.left)}/${row.reserve} t`)
      this.binder.set(findText(this.actor, `DepositStatus_${i}`),
        `${row.selected ? '▶ ' : ''}${row.status}`)
    }

    // 全息地球态：节点统计行 + 工具行池 + ghost 校验文案
    if (isEarth && holo.earth) {
      const e = holo.earth
      this.binder.set(findText(this.actor, 'ToolRingInfo'),
        `⚡ 环节点 已落位 ${e.placedNodes}/${e.builtSlots} · 融冰 ${e.meltRadiusDeg}°`)
      this.binder.set(findText(this.actor, 'ToolRingStatus'),
        e.tools[0]?.selected ? '▶ 点球面落位' : `${e.pendingNodes} 待落位`)
      for (let i = 0; i < HOLO_TOOL_ROWS; i++) {
        const row = e.tools[i + 1] // 下标 0 = ring 工具行，建筑行顺延
        this.rowToolIds[i] = row?.id ?? ''
        if (!row) continue
        this.binder.set(findText(this.actor, `ToolInfo_${i}`), `${row.name} · ${row.desc}`)
        const label = findText(this.actor, `ToolLabel_${i}`)
        if (label) this.binder.set(label, row.selected ? '已选' : '选用')
        this.vis.set(this.actor, `Btn_tool_${i}`, row.canUse || row.selected)
      }
      // 详情 = ghost 校验 / 工具引导（建筑模式下覆盖矿点详情）
      this.binder.set(findText(this.actor, 'DetailText'),
        e.ghostLabel || (e.toolActive ? '移动指针选择落点…' : '选上方工具后在球面点击落位；融化圈内可放地表建筑'))
    } else {
      this.binder.set(findText(this.actor, 'DetailText'), holo.detail)
    }

    // 建造区行池（表键序；无选中/预算不足 → 按钮隐藏；全息地球态矿建行仍按选中矿点驱动）
    for (let i = 0; i < HOLO_BUILD_ROWS; i++) {
      const row = holo.buildRows[i]
      this.rowBuildIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `BuildRow_${i}`, !!row)
      if (!row) continue
      this.binder.set(findText(this.actor, `BuildInfo_${i}`),
        `${row.name} · ${row.cost} H3 · 工期 ${row.buildTime}s\n产出 ${row.yieldPerS}/s · ${row.desc}`)
      this.vis.set(this.actor, `Btn_build_${i}`, row.canBuild)
    }
  }
}
