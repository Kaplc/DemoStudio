/**
 * HologramPanelScript — 全息勘探面板 widget 行为脚本（hologram_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.hologramSel / holoDepositSel 驱动，本脚本只做差分呈现）：
 *  - 星球信息面板「全息勘探」按钮 → GameMode.openHologram(body) → vm.hologram 非空 → 面板展开
 *  - 面板内 ✕ / Esc → GameMode.closeHologram() → vm.hologram 为 null → 收起
 *  - 矿点行（mineral_deposit 表序）：点行 = 选中/取消该矿点（再点同行取消；3D 外环同步高亮）
 *  - 建造区（mine_building 表键序）：「建造」→ MiningComponent.tryPlace(选中矿点, 类型)
 *  - 色点 ◆ = 矿种表现色（ColorBinder 差分写色）
 *  - 8Hz 差分同步；矿点行池 HOLO_DEPOSIT_ROWS / 建造行池 HOLO_BUILD_ROWS，超出表行数不显示
 */
import { BehaviourScript, logger } from '@/engine'
import { ColorBinder, TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 全息勘探面板 widget 资产路径（HudScript 生成入口） */
export const HOLOGRAM_PANEL_WIDGET = 'asset/blueprints/ui/hologram_panel.widget.json'

/** 矿点行池容量（超出 mineral_deposit 表中该天体矿点数的行不显示） */
const HOLO_DEPOSIT_ROWS = 4
/** 建造行池容量（超出 mine_building 表行数的类型不显示） */
const HOLO_BUILD_ROWS = 3

export default class HologramPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private colors = new ColorBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定矿点 id（行回调经此取参，避免闭包过期） */
  private rowDepositIds: string[] = new Array(HOLO_DEPOSIT_ROWS).fill('')
  /** 行号 → 当前绑定矿建类型 id */
  private rowBuildIds: string[] = new Array(HOLO_BUILD_ROWS).fill('')

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

    this.binder.set(findText(this.actor, 'TitleText'), `全息勘探 · ${holo.bodyName}`)

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

    this.binder.set(findText(this.actor, 'DetailText'), holo.detail)

    // 建造区行池（表键序；无选中/预算不足 → 按钮隐藏）
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
