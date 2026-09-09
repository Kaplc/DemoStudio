/**
 * OrbitPanelScript — 近地轨道建设面板 widget 行为脚本（orbit_build_panel.widget.json 根节点）
 *
 * 职责（数据由 GameMode.orbitBuildSel 驱动，本脚本只做差分呈现）：
 *  - 星球信息面板「近地轨道建设」按钮 / 点轨道设施 → GameMode.openOrbitBuild(anchor)
 *    → vm.orbitBuild 非空 → 面板展开
 *  - 点空地 / 面板内 ✕ → GameMode.closeOrbitBuild() → vm.orbitBuild 为 null → 收起
 *  - 内容全表驱动（orbit_build.table 行序 = 行池序）：
 *    建造区（名称/造价/工期/数量/「建造」按钮 → OrbitBuildComponent.tryPlace）
 *  - 造船入口收口到船坞独立面板（2026-09-09 用户需求：点船坞 → ShipyardPanelScript，
 *    逐船一卡建造队列；本面板不再有造船按钮）
 *  - 8Hz 差分同步；行池容量 ORBIT_ROWS，超出表行数的类型不显示
 */
import { BehaviourScript, logger } from '@/engine'
import { TextBinder, VisBinder, findButton, findText, wcMode } from './uiCommon'

/** 轨道建设面板 widget 资产路径（HudScript 生成入口） */
export const ORBIT_BUILD_PANEL_WIDGET = 'asset/blueprints/ui/orbit_build_panel.widget.json'

/** 建造区行池容量（超出 orbit_build.table 行数的类型不显示） */
const ORBIT_ROWS = 4

export default class OrbitPanelScript extends BehaviourScript {
  private binder = new TextBinder()
  private vis = new VisBinder()
  private acc = 1
  /** 行号 → 当前绑定建筑类型 id（按钮回调经此取参，避免闭包过期） */
  private rowTypeIds: string[] = new Array(ORBIT_ROWS).fill('')

  /** 面板当前是否展开（HudScript 居中互斥读取；唯一权威 = GameMode.orbitBuildSel） */
  get isOpen(): boolean {
    return !!wcMode()?.orbitBuildSel
  }

  override onStart(): void {
    const bind = (name: string, fn: () => void): void => {
      const btn = findButton(this.actor, name)
      if (btn) btn.onClick = fn
    }
    // 面板内 ✕ 关闭 = 清空 GameMode.orbitBuildSel（点空地同链路）
    bind('Btn_panel_close', () => wcMode()?.closeOrbitBuild())
    // 建造区「建造」按钮：落位轨道建筑（预算/上限校验在 placementIssue，失败 hint）
    for (let i = 0; i < ORBIT_ROWS; i++) {
      bind(`Btn_ob_${i}`, () => {
        const typeId = this.rowTypeIds[i]
        const anchor = wcMode()?.orbitBuildSel
        if (typeId && anchor) wcMode()?.orbitBuild.tryPlace(typeId, anchor)
      })
    }
    // 默认收起（脚本置位，先于首帧渲染）
    this.vis.set(this.actor, 'OrbitBody', false)
    logger.info('[OrbitPanelScript] 轨道建设面板就绪（默认收起）')
  }

  override onUpdate(dt: number): void {
    const mode = wcMode()
    if (!mode) return
    this.acc += dt
    if (this.acc < 0.12) return
    this.acc = 0
    const ob = mode.buildViewModel().orbitBuild
    this.vis.set(this.actor, 'OrbitBody', !!ob)
    if (!ob) return

    // 标题 + 船坞引导行（造船操作入口在船坞独立面板：点轨道上的船坞打开）
    this.binder.set(findText(this.actor, 'TitleText'), `近地轨道 · ${ob.anchorName}`)
    this.binder.set(findText(this.actor, 'FleetText'),
      ob.hasShipyard ? `船坞就绪 · 点轨道上的船坞打开造船面板（${ob.shipCost} H3/艘）` : `造船 ${ob.shipCost} H3（建船坞解锁 · 点船坞造船）`)

    // 建造区行池（表驱动）
    for (let i = 0; i < ORBIT_ROWS; i++) {
      const row = ob.rows[i]
      this.rowTypeIds[i] = row?.id ?? ''
      this.vis.set(this.actor, `OrbitRow_${i}`, !!row)
      if (!row) continue
      this.binder.set(findText(this.actor, `OrbitInfo_${i}`),
        `${row.name} · ${row.cost} H3 · 工期 ${row.buildTime}s\n${row.desc}（${row.count}/${row.max}）`)
      this.vis.set(this.actor, `Btn_ob_${i}`, row.canBuild)
    }
  }
}
