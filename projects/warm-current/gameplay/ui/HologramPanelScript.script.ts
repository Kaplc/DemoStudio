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
import { BehaviourScript, logger, UIScrollContainerComponent, UITransformComponent } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'

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
  /** 滚动容器（懒查找缓存；行显隐后重排 + refresh 用） */
  private scroll: UIScrollContainerComponent | null = null

  /** 滚动区内行名，按堆叠序（与 widget 源顺序一致；隐藏行出流） */
  private static readonly SCROLL_ROWS = [
    'DepositRow_0', 'DepositRow_1', 'DepositRow_2', 'DepositRow_3',
    'DetailBox', 'Btn_tool_ring', 'ToolRow_0', 'ToolRow_1', 'ToolRow_2',
    'BuildRow_0', 'BuildRow_1', 'BuildRow_2',
  ]

  /** 面板当前是否展开（唯一权威 = GameMode.hologramSel） */
  get isOpen(): boolean {
    return !!wcMode()?.hologramSel
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭 = 退出全息（保持当前相机位置，2026-09-15 用户定案：关闭不重新取景）
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

    // 可见行重排（内容层是编译期烘焙的静态位置，行显隐必须重排；hidden 行出流）
    this.relayoutScrollRows()
  }

  /**
   * 滚动区可见行重排：按 SCROLL_ROWS 序从内容层顶部堆叠可见行（隐藏行不占位），
   * 内容高写回后 refresh() 重测（引擎侧重钉起始边 + 钳制偏移 + 刷滚动条）。
   * 8Hz 调用无害：位置写值幂等，refresh 尺寸不变时不重钉。
   */
  private relayoutScrollRows(): void {
    if (!this.scroll) {
      const scrollActor = findChild(this.actor, 'HoloScroll')
      this.scroll = scrollActor?.getComponent(UIScrollContainerComponent) ?? null
      if (!this.scroll) return
    }
    const content = this.scroll.contentActor
    const contentTf = content?.getComponent(UITransformComponent)
    if (!content || !contentTf) return
    const GAP = 6
    const visible: Array<{ tf: UITransformComponent; h: number }> = []
    let total = 0
    for (const name of HologramPanelScript.SCROLL_ROWS) {
      const row = findChild(content, name)
      const tf = row?.getComponent(UITransformComponent)
      if (!row || !tf) continue
      if (!row.root.visible) continue
      const h = tf.getWorldSize()[1]
      visible.push({ tf, h })
      total += h
    }
    total += GAP * Math.max(0, visible.length - 1)
    // 从内容层顶部堆叠（内容层坐标 +y 朝上；首行中心 = total/2 - 行高/2）
    let cum = 0
    for (const { tf, h } of visible) {
      const p = tf.owner.root.position
      tf.setPosition(p.x, total / 2 - cum - h / 2, p.z)
      cum += h + GAP
    }
    // 内容高写回 + 重测（钳制滚动范围 / 刷滚动条 / 起始边重钉在引擎侧）
    const [cw] = contentTf.getWorldSize()
    if (Math.abs(contentTf.getWorldSize()[1] - total) > 0.01) contentTf.setWorldSize(cw, total)
    this.scroll.refresh()
  }
}
