/**
 * HologramPanelScript — 全息勘探面板 widget 行为脚本（hologram_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.hologramSel / holoDepositSel 驱动，本脚本只做差分呈现）：
 *  - 星球信息面板「全息勘探」按钮 → GameMode.openHologram(body) → vm.hologram 非空 → 面板展开
 *  - 面板内 ✕ / Esc → GameMode.closeHologram() → vm.hologram 为 null → 收起
 *  - 矿点行（mineral_deposit 表序）：点行 = 选中/取消该矿点（再点同行取消；3D 外环同步高亮）
 *  - 建造区（mine_building 表键序）：「建造」→ MiningComponent.tryPlace(选中矿点, 类型)
 *  - 全息地球态（body==='earth'）内容按底部分类切换（2026-09-18 改版，tab 口径在
 *    GameMode.holoTab / vm.hologram.earth.tab，底部按钮在 HoloHudScript）：
 *      ring      = 环节点视图（⚡ 环节点行：统计 + 落位状态）
 *      resources = 矿点行 + 矿建建造区
 *      surface   = 地表建筑工具行（点「选用」进入放置，点球面落位，融化圈门槛在 GameMode 校验）
 *      orbit     = 轨道建筑类型行（orbit_build 表投影，「建造」→ OrbitBuildComponent.tryPlace）
 *  - 色点 ◆ = 矿种表现色（ColorBinder 差分写色）
 *  - 8Hz 差分同步；矿点行池 HOLO_DEPOSIT_ROWS / 建造行池 HOLO_BUILD_ROWS / 工具行池 HOLO_TOOL_ROWS
 *    / 轨道行池 HOLO_ORBIT_ROWS
 */
import { BehaviourScript, logger, UIScrollContainerComponent, UITransformComponent } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findChild, findText, wcMode } from './uiCommon'
import { HOLO_TOOL_ROWS, holoPanelTitleSuffix } from './holoHudModel'

/** 全息勘探面板 widget 资产路径（HudScript 生成入口） */
export const HOLOGRAM_PANEL_WIDGET = 'asset/blueprints/ui/hologram_panel.widget.json'

/** 矿点行池容量（超出 mineral_deposit 表中该天体矿点数的行不显示） */
const HOLO_DEPOSIT_ROWS = 4
/** 建造行池容量（超出 mine_building 表行数的类型不显示） */
const HOLO_BUILD_ROWS = 3
/** 全息地球地表建筑工具行池容量（building 表行；超出表行数的类型不显示） */
const HOLO_TOOL_ROWS_POOL = HOLO_TOOL_ROWS
/** 轨道建筑行池容量（超出 orbit_build 表行数的类型不显示） */
const HOLO_ORBIT_ROWS = 4

export default class HologramPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定矿点 id（行回调经此取参，避免闭包过期） */
  private rowDepositIds: string[] = new Array(HOLO_DEPOSIT_ROWS).fill('')
  /** 行号 → 当前绑定矿建类型 id */
  private rowBuildIds: string[] = new Array(HOLO_BUILD_ROWS).fill('')
  /** 行号 → 当前绑定工具 id（building 表行键） */
  private rowToolIds: string[] = new Array(HOLO_TOOL_ROWS_POOL).fill('')
  /** 行号 → 当前绑定轨道建筑类型 id */
  private rowOrbitIds: string[] = new Array(HOLO_ORBIT_ROWS).fill('')
  /** 滚动容器（懒查找缓存；行显隐后重排 + refresh 用） */
  private scroll: UIScrollContainerComponent | null = null

  /** 滚动区内行名，按堆叠序（与 widget 源顺序一致；隐藏行出流） */
  private static readonly SCROLL_ROWS = [
    'DepositRow_0', 'DepositRow_1', 'DepositRow_2', 'DepositRow_3',
    'DetailBox', 'Btn_tool_ring', 'ToolRow_0', 'ToolRow_1', 'ToolRow_2',
    'OrbitIntro', 'OrbitRow_0', 'OrbitRow_1', 'OrbitRow_2', 'OrbitRow_3',
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
    // 全息地球地表建筑工具行：点「选用」进入放置（再点 = 取消工具）
    for (let i = 0; i < HOLO_TOOL_ROWS_POOL; i++) {
      bind(`Btn_tool_${i}`, () => {
        const mode = wcMode()
        const id = this.rowToolIds[i]
        if (!mode || !id) return
        mode.setHoloTool('building', id)
      })
    }
    // 轨道建筑「建造」：投放 earth 轨道施工（预算/上限校验在 OrbitBuildComponent）
    for (let i = 0; i < HOLO_ORBIT_ROWS; i++) {
      bind(`Btn_orbit_${i}`, () => {
        const mode = wcMode()
        const typeId = this.rowOrbitIds[i]
        if (!mode || !typeId) return
        mode.orbitBuild.tryPlace(typeId, 'earth')
        logger.info(`[HologramPanelScript] 全息轨道建造：${typeId} @ earth`)
      })
    }
    // 默认收起（脚本置位，先于首帧渲染）。走 setPanel：UIManager 会把面板根整树
    // 失活，此处需同步置面板根，保证后续打开时不被父链 effective 压制。
    this.vis.setPanel(this.actor, 'HoloBody', false)
    logger.info('[HologramPanelScript] 全息勘探面板就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const holo = mode.buildViewModel().hologram
    this.vis.setPanel(this.actor, 'HoloBody', !!holo)
    if (!holo) return

    const isEarth = holo.body === 'earth'
    const e = holo.earth
    // 面板内容分类（地球态跟随底部按钮；勘探态不分组）
    const tab = e?.tab ?? 'resources'
    this.binder.set(findText(this.actor, 'TitleText'),
      isEarth ? `全息地球 · ${holoPanelTitleSuffix(tab)}` : `全息勘探 · ${holo.bodyName}`)

    // 堆场水位行（资源星专属；2026-09-13 堆场耦合——产量入堆场、船从堆场拉货）
    this.vis.set(this.actor, 'StockText', !isEarth && !!holo.stockyard)
    if (!isEarth && holo.stockyard) {
      const y = holo.stockyard
      const pct = y.cap > 0 ? Math.floor((y.stock / y.cap) * 100) : 0
      this.binder.set(findText(this.actor, 'StockText'),
        `堆场 ${Math.floor(y.stock)}/${y.cap} t（${pct}%）· 产量 ${y.miningRate}/s${pct >= 100 ? ' · ⚠ 已满停产' : ''}`)
    }

    // 提示行口径分支
    this.binder.set(findText(this.actor, 'HintText'), isEarth
      ? '右键拖拽旋转 · 选中工具后点球面落位 · Esc 取消/退出'
      : '拖拽旋转检视 · 点矿点或列表行选中 · Esc 退出')

    // ── 内容分组显隐（2026-09-18 底部分类改版；勘探态保持矿点 + 矿建全显） ──
    const showDeposits = !isEarth || tab === 'resources'
    const showRing = isEarth && tab === 'ring'
    const showSurface = isEarth && tab === 'surface'
    const showOrbit = isEarth && tab === 'orbit'
    const showMineBuild = !isEarth || tab === 'resources'

    // 矿点行池（表序；色点 = 矿种表现色，状态列带选中标记）
    for (let i = 0; i < HOLO_DEPOSIT_ROWS; i++) {
      const row = holo.deposits[i]
      this.rowDepositIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `DepositRow_${i}`, !!row && showDeposits)
      if (!row || !showDeposits) continue
      this.colors.set(findText(this.actor, `Dot_${i}`), row.color)
      this.binder.set(findText(this.actor, `DepositInfo_${i}`),
        `${row.typeName} · 余 ${Math.round(row.left)}/${row.reserve} t`)
      this.binder.set(findText(this.actor, `DepositStatus_${i}`),
        `${row.selected ? '▶ ' : ''}${row.status}`)
    }

    // 全息地球态：节点统计行 + 地表建筑工具行池 + ghost 校验文案
    if (isEarth && e) {
      this.vis.set(this.actor, 'Btn_tool_ring', showRing)
      if (showRing) {
        this.binder.set(findText(this.actor, 'ToolRingInfo'),
          `⚡ 环节点 已落位 ${e.placedNodes}/${e.builtSlots} · 融冰 ${e.meltRadiusDeg}°`)
        this.binder.set(findText(this.actor, 'ToolRingStatus'),
          e.tools[0]?.selected ? '▶ 点球面落位' : `${e.pendingNodes} 待落位`)
      }
      for (let i = 0; i < HOLO_TOOL_ROWS_POOL; i++) {
        const row = e.tools[i + 1] // 下标 0 = ring 工具行，建筑行顺延
        this.rowToolIds[i] = row?.id ?? ''
        this.vis.set(this.actor, `ToolRow_${i}`, !!row && showSurface)
        if (!row || !showSurface) continue
        this.binder.set(findText(this.actor, `ToolInfo_${i}`), `${row.name} · ${row.desc}`)
        const label = findText(this.actor, `ToolLabel_${i}`)
        if (label) this.binder.set(label, row.selected ? '已选' : '选用')
        this.vis.set(this.actor, `Btn_tool_${i}`, row.canUse || row.selected)
      }
      // 轨道建筑行池（表序；「建造」按钮按 canBuild 显隐）
      this.vis.set(this.actor, 'OrbitIntro', showOrbit)
      if (showOrbit) this.binder.set(findText(this.actor, 'OrbitIntro'), e.orbitIntro)
      for (let i = 0; i < HOLO_ORBIT_ROWS; i++) {
        const row = e.orbitRows[i]
        this.rowOrbitIds[i] = row?.id ?? ''
        this.vis.set(this.actor, `OrbitRow_${i}`, !!row && showOrbit)
        if (!row || !showOrbit) continue
        this.binder.set(findText(this.actor, `OrbitInfo_${i}`),
          `${row.name} · ${row.cost} H3 · 工期 ${row.buildTime}s\n${row.desc}（${row.count}/${row.max}）`)
        this.vis.set(this.actor, `Btn_orbit_${i}`, row.canBuild)
      }
      // 详情 = 分类引导 / ghost 校验 / 工具引导
      let detail: string
      if (tab === 'orbit') detail = '点「建造」投放轨道施工 · 建成后点轨道设施管理（船坞点开造船）'
      else if (tab === 'surface') detail = e.ghostLabel || (e.toolActive ? '移动指针选择落点…' : '点「选用」进入放置 · 融化圈内点球面落位')
      else if (tab === 'ring') detail = e.ghostLabel || (e.toolActive ? '移动指针选择落点…' : '点底部「⚡ 环节点」选落位工具 · 点球面落位')
      else detail = holo.detail
      this.binder.set(findText(this.actor, 'DetailText'), detail)
    } else {
      this.binder.set(findText(this.actor, 'DetailText'), holo.detail)
    }

    // 建造区行池（表键序；无选中/预算不足 → 按钮隐藏；全息地球态归「资源」分类）
    for (let i = 0; i < HOLO_BUILD_ROWS; i++) {
      const row = holo.buildRows[i]
      this.rowBuildIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `BuildRow_${i}`, !!row && showMineBuild)
      if (!row || !showMineBuild) continue
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
