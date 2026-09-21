/**
 * FleetCommandComponent — 耀斑预警舰队指挥组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 船选择/框选/下令方法原样迁入）：
 *  - 船命中（shipAt：画布坐标；冻毁船不可选，命中半径 16 + 表容差）；
 *  - 选择态：单选增减（toggleShipSelection）/ 框选替换式结算（selectShipsInRect）/ 清空；
 *  - 下令（orderSelectedShips）：照跑/就近靠站/原地待命，仅耀斑预警窗口期可下（hazards 门）。
 *  框选手势矩形（boxDrag）留在 GameMode 指针胶水层，落点结算调本组件。
 */
import { BObjectComponent, audioSys } from '@/engine'
import { B } from '../core/balance'
import { shipPos } from '../core/helpers'
import type { SimShip, ShipOrder } from '../core/types'
import { dist } from './MapHitTestComponent'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class FleetCommandComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 耀斑预警框选的船 id 集（决策条下达对象；耀斑结束自动清空） */
  selectedShips: number[] = []

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'FleetCommandComponent'
  }

  /** 船命中（画布坐标；冻毁船不可选；命中半径与建筑同量级） */
  shipAt(p: { x: number; y: number }): SimShip | null {
    const s = this.owner.simState.state
    for (const ship of s.ships) {
      if (ship.state === 'frozen') continue
      const pos = shipPos(s, ship)
      if (dist(p.x, p.y, pos.x, pos.y) <= 16 + B.map.hitTolerance) return ship
    }
    return null
  }

  /** 点击增减框选（预警期点船） */
  toggleShipSelection(shipId: number): void {
    const idx = this.selectedShips.indexOf(shipId)
    if (idx >= 0) this.selectedShips.splice(idx, 1)
    else this.selectedShips.push(shipId)
    audioSys.play('wc.draw', { volume: 0.25 })
  }

  /** 框选落点结算：矩形内全部在航船入选（替换式） */
  selectShipsInRect(x0: number, y0: number, x1: number, y1: number): number {
    const s = this.owner.simState.state
    const left = Math.min(x0, x1), right = Math.max(x0, x1)
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1)
    const picked: number[] = []
    for (const ship of s.ships) {
      if (ship.state === 'frozen') continue
      const pos = shipPos(s, ship)
      if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) picked.push(ship.id)
    }
    this.selectedShips = picked
    return picked.length
  }

  clearShipSelection(): void {
    this.selectedShips = []
  }

  /** 对框选船下达耀斑决策（照跑/就近靠站/原地待命；窗口外拒绝） */
  orderSelectedShips(order: ShipOrder): number {
    if (!this.owner.hazards.orderWindowOpen()) {
      this.owner.simState.hint('仅在耀斑预警期可下令（需事件预警卡）')
      return 0
    }
    let ok = 0
    for (const id of [...this.selectedShips]) {
      if (this.owner.hazards.setShipOrder(id, order)) ok++
    }
    if (ok > 0) audioSys.play('wc.ok', { volume: 0.4 })
    return ok
  }
}
