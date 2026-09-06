/**
 * UnitMarkers — 地图单位计数器与战斗弹窗管理（plan §D2）
 *
 * 每个有师的省：一个隐形锚点 Actor（省中心，命名 HOI4_PROV_<pid>）+ 一个
 * screen 模式锚定 widget（unit_counter，NATO 式计数块）；
 * 每场战斗：battle_popup（双方组织度条）锚定在交战省。
 * sync() 在每次小时 tick / 命令后调用：增量创建销毁，diff 文本避免逐帧重绘。
 */
import { Actor, GenericActor, UITextComponent, UIProgressBarComponent, GameInstance, logger } from '@/engine'
import type { AnchoredWidgetHandle } from '@/engine'
import type { Hoi4GameMode } from '../base/Hoi4GameMode'

const UNIT_COUNTER_WIDGET = 'asset/blueprints/ui/unit_counter.widget.json'
const BATTLE_POPUP_WIDGET = 'asset/blueprints/ui/battle_popup.widget.json'

interface UnitMarker {
  anchor: Actor
  handle: AnchoredWidgetHandle | null
  lastText: string
}

interface BattleMarker {
  handle: AnchoredWidgetHandle | null
  anchorName: string
  lastAtk: number
  lastDef: number
  lastProgress: number
}

export class UnitMarkers {
  private mode: Hoi4GameMode
  private markers = new Map<number, UnitMarker>()
  private battles = new Map<number, BattleMarker>()

  constructor(mode: Hoi4GameMode) {
    this.mode = mode
  }

  destroyAll(): void {
    for (const m of this.markers.values()) m.handle?.release()
    for (const b of this.battles.values()) b.handle?.release()
    this.markers.clear()
    this.battles.clear()
  }

  /** 同步单位计数器与战斗弹窗（小时 tick 与命令后调用） */
  sync(): void {
    const world = this.mode.world
    if (!world) return
    const state = this.mode.coreState
    if (!state) return
    const ui = world.ui

    // ── 单位计数器 ──
    const byProvince = new Map<number, { count: number; mine: boolean }>()
    for (const d of Object.values(state.divisions)) {
      const e = byProvince.get(d.province) ?? { count: 0, mine: false }
      e.count++
      if (d.owner === state.playerTag) e.mine = true
      byProvince.set(d.province, e)
    }
    for (const [pid, info] of byProvince) {
      let m = this.markers.get(pid)
      if (!m) {
        const pos = this.mode.map.provinceWorldPos(pid)
        if (!pos) continue
        const anchor = new GenericActor(`HOI4_PROV_${pid}`)
        anchor.root.position.set(pos.x, 0.5, pos.z)
        world.actorMgr.SpawnActor(anchor)
        m = { anchor, handle: null, lastText: '' }
        this.markers.set(pid, m)
      }
      if (!m.handle) {
        m.handle = ui.spawnAnchoredWidget(UNIT_COUNTER_WIDGET, m.anchor, {
          mode: 'screen',
          constantScreenSize: true,
          targetActorId: m.anchor.root.name,
        })
        if (!m.handle) logger.warn(`[UnitMarkers] unit_counter 生成失败 prov=${pid}`)
      }
      const text = String(info.count)
      if (m.handle && text !== m.lastText) {
        m.lastText = text
        const label = findText(m.handle.actor, 'CountText')
        if (label) label.text = text
      }
    }
    // 清理空省
    for (const [pid, m] of [...this.markers]) {
      if (!byProvince.has(pid)) {
        m.handle?.release()
        world.actorMgr.DestroyActor(m.anchor)
        this.markers.delete(pid)
      }
    }

    // ── 战斗弹窗 ──
    for (const battle of Object.values(state.battles)) {
      let b = this.battles.get(battle.id)
      const involvesPlayer = state.playerTag !== null && (battle.attacker === state.playerTag || battle.defender === state.playerTag)
      if (!involvesPlayer) continue
      if (!b) {
        const anchor = this.markers.get(battle.province)?.anchor
        let anchorName = anchor?.root.name ?? ''
        if (!anchor) {
          const pos = this.mode.map.provinceWorldPos(battle.province)
          if (!pos) continue
          const a = new GenericActor(`HOI4_BATTLE_${battle.province}`)
          a.root.position.set(pos.x, 0.5, pos.z)
          world.actorMgr.SpawnActor(a)
          anchorName = a.root.name
          this.mode.tempAnchors.push(a)
        }
        b = { handle: null, anchorName, lastAtk: -1, lastDef: -1, lastProgress: -1 }
        this.battles.set(battle.id, b)
      }
      if (!b.handle) {
        b.handle = ui.spawnAnchoredWidget(BATTLE_POPUP_WIDGET, world.findActorByName(b.anchorName), {
          mode: 'screen',
          constantScreenSize: true,
          targetActorId: b.anchorName,
        })
      }
      if (b.handle) {
        // 攻方进度条 + 双方师数文本
        const atk = battle.attackers.length
        const def = battle.defenders.length
        if (atk !== b.lastAtk || def !== b.lastDef || battle.progress !== b.lastProgress) {
          b.lastAtk = atk
          b.lastDef = def
          b.lastProgress = battle.progress
          const atkT = findText(b.handle.actor, 'AtkText')
          const defT = findText(b.handle.actor, 'DefText')
          if (atkT) atkT.text = `${battle.attacker} ${atk}`
          if (defT) defT.text = `${def} ${battle.defender}`
          const bar = findComponent(b.handle.actor, UIProgressBarComponent)
          if (bar) bar.value = battle.progress
        }
      }
    }
    for (const [id, b] of [...this.battles]) {
      if (!state.battles[id]) {
        b.handle?.release()
        this.battles.delete(id)
      }
    }
  }

  /** GameMode 摄像机跟随选中省（可扩展，MVP 不做） */
  focusProvince(_pid: number): void {
    void GameInstance.current
  }
}

function findText(root: Actor | null, name: string): UITextComponent | null {
  if (!root) return null
  const walk = (a: Actor): UITextComponent | null => {
    if (a.root.name === name) return a.getComponent(UITextComponent)
    for (const c of a.getChildren()) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}

function findActorChild(root: Actor | null, name: string): Actor | null {
  if (!root) return null
  const walk = (a: Actor): Actor | null => {
    for (const c of a.getChildren()) {
      if (c.root.name === name) return c
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function findComponent<T extends import('@/engine').ActorComponent>(root: Actor | null, cls: new (...args: any[]) => T): T | null {
  if (!root) return null
  const walk = (a: Actor): T | null => {
    const own = a.getComponents(cls)
    if (own.length > 0) return own[0]
    for (const c of a.getChildren()) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}
