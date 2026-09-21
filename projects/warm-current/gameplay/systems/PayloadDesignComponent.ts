/**
 * PayloadDesignComponent — 荷载设计工坊组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode 荷载设计方法原样迁入）：
 *  - 合成编辑区状态：payloadEdTab（部位页签）/ payloadEdChassis（主体）/ payloadEdAttachments（附件）；
 *  - 编辑操作：选主体/勾附件（fits 契合收敛）/切页签，保存/删除/载入设计模板（随档走）；
 *  - syncDynamicPayloadModules：模板 → 合成模块注册表投影（setDynamicShipModules）；
 *  - 面板投影：buildPayloadDesignVM（designOpen 期间随部位页签出）。
 *  兼容：GameMode 保留同名薄转发门面，UI 脚本与 e2e 调用点不变。
 */
import { BObjectComponent, logger } from '@/engine'
import {
  nextPayloadUid, payloadDesignDefsOf, payloadDesignModuleDef, setDynamicShipModules,
  shipModuleDefOf, shipModuleEntries, SLOT_ROLE_KEY, SLOT_TYPE_NAMES,
} from '../core/helpers'
import type { SimPayloadDesign } from '../core/helpers'
import type { HudModuleRow, HudPayloadDesign, HudPayloadRow } from './ViewModelComponent'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class PayloadDesignComponent extends BObjectComponent<WarmCurrentGameMode> {
  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'PayloadDesignComponent'
  }

  // ─── 荷载设计工坊（2026-09-13：火箭三部位改版——荷载单独设计，主体+附件合成一件自定义荷载） ───
  // 2026-09-20 起并入火箭设计工坊左侧导航页（荷载/引擎设计页签），面板级开合字段已移除；
  // 合成编辑区状态（payloadEdTab/payloadEdChassis/payloadEdAttachments）保留在本类，VM 随 designOpen 出。

  /** 设计工坊当前部位页签（payload/fuel/engine；三部位统一设计流，2026-09-14 泛化） */
  payloadEdTab: 'payload' | 'fuel' | 'engine' = 'payload'

  /** 荷载编辑区当前选中主体（chassis 模块 id；默认固体货仓） */
  payloadEdChassis = 'cargo_hold'

  /** 荷载编辑区当前勾选附件（attachment 模块 id 清单；单设计同件至多一件） */
  payloadEdAttachments: string[] = []

  /** 改装件是否契合部位（2026-09-14 用户口径：附件要契合当前选择的主体——
   *  表行 fits 声明可搭部位清单，缺省 = 通用件；合成宽放行、编辑区严收敛，同一谓词） */
  private fitsAttachment(moduleId: string, slotType: 'payload' | 'fuel' | 'engine'): boolean {
    const fits = shipModuleDefOf(moduleId)?.fits
    return !Array.isArray(fits) || fits.length === 0 || fits.includes(slotType)
  }

  /** 切换设计工坊部位页签（payload/fuel/engine；主体跨页保持，附件按 fits 契合收敛） */
  selectPayloadTab(tab: 'payload' | 'fuel' | 'engine'): void {
    if (tab !== 'payload' && tab !== 'fuel' && tab !== 'engine') return
    this.payloadEdTab = tab
    // 改装件契合主体：切页自动剔除不适配已勾件（保证「勾选清单 = 可保存清单」）
    this.payloadEdAttachments = this.payloadEdAttachments.filter((id) => this.fitsAttachment(id, tab))
  }

  /** 荷载编辑区选主体（单选；非法 id 忽略；角色键 = SLOT_ROLE_KEY 单一数据源） */
  selectPayloadChassis(moduleId: string): void {
    const roleKey = SLOT_ROLE_KEY[this.payloadEdTab] ?? 'payloadRole'
    if ((shipModuleDefOf(moduleId) as unknown as Record<string, unknown> | null)?.[roleKey] !== 'chassis') return
    this.payloadEdChassis = moduleId
  }

  /** 荷载编辑区勾/取消附件（多选；非法 id 忽略；不契合当前部位的新勾拒绝） */
  togglePayloadAttachment(moduleId: string): void {
    if (shipModuleDefOf(moduleId)?.payloadRole !== 'attachment') return
    const at = this.payloadEdAttachments.indexOf(moduleId)
    // 已勾件恒可取消（保证能移除）；新勾须契合当前部位（fits 缺省 = 通用件）
    if (at < 0 && !this.fitsAttachment(moduleId, this.payloadEdTab)) return
    if (at >= 0) this.payloadEdAttachments.splice(at, 1)
    else this.payloadEdAttachments.push(moduleId)
  }

  /** 保存当前编辑区为设计模板（部位 = 当前页签；uid 前缀随部位递增不复用，随档走） */
  savePayloadDesign(): boolean {
    const s = this.owner.simState.state
    const slotType = this.payloadEdTab
    const def = payloadDesignModuleDef({ uid: '', name: '', slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] })
    if (!def) {
      // 跨页签选件保持下主体与部位错配是常态（如荷载页选的货仓切到燃料页）：显式引导而非静默失败
      const partName = SLOT_TYPE_NAMES[slotType] ?? '荷载'
      this.owner.simState.hint(`请先选择${partName}主体再保存`)
      logger.warn(`[WarmCurrent] 设计保存失败：${slotType} 部位主体无效 chassis=${this.payloadEdChassis}`)
      return false
    }
    const uid = nextPayloadUid(s.payloadDesigns, slotType)
    const name = `自定义${SLOT_TYPE_NAMES[slotType] ?? '荷载'} ${s.payloadDesigns.filter((d) => (d.slotType ?? 'payload') === slotType).length + 1}`
    s.payloadDesigns.push({ uid, name, slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] })
    this.syncDynamicPayloadModules()
    this.owner.simState.hint(`已保存「${name}」（${def.cost} H3）`)
    logger.info(`[WarmCurrent] 设计保存：${uid} ${name} slotType=${slotType} chassis=${this.payloadEdChassis} attachments=${this.payloadEdAttachments.join(',')}`)
    return true
  }

  /**
   * 删除荷载设计模板（引用保护：舰队在船 / 船型模板 / 当前装配选择引用该 uid 时拒绝——
   * 合成件定义随模板删除，引用船会静默丢效果，宁可让玩家先解除引用）。
   */
  deletePayloadDesign(idx: number): boolean {
    const s = this.owner.simState.state
    if (idx < 0 || idx >= s.payloadDesigns.length) return false
    const uid = s.payloadDesigns[idx].uid
    const refs: string[] = []
    if (s.ships.some((sh) => sh.modules?.includes(uid))) refs.push('现役飞船')
    if (s.shipDesigns.some((d) => d.modules.includes(uid))) refs.push('船型模板')
    if (this.owner.ship.shipyardSelModules.includes(uid)) refs.push('当前装配')
    if (refs.length > 0) {
      this.owner.simState.hint(`「${s.payloadDesigns[idx].name}」正被${refs.join('、')}引用，先解除引用再删除`)
      return false
    }
    const [gone] = s.payloadDesigns.splice(idx, 1)
    this.syncDynamicPayloadModules()
    this.owner.simState.hint(`已删除「${gone.name}」`)
    logger.info(`[WarmCurrent] 荷载设计删除：${gone.uid} ${gone.name}`)
    return true
  }

  /** 载入设计模板 → 编辑区（按模板部位切页签；返回是否成功；script 据此刷新勾选态） */
  loadPayloadDesign(idx: number): boolean {
    const s = this.owner.simState.state
    const d = s.payloadDesigns[idx]
    if (!d) return false
    const slot = (d.slotType ?? 'payload') as 'payload' | 'fuel' | 'engine'
    const roleKey = SLOT_ROLE_KEY[slot] ?? 'payloadRole'
    if ((shipModuleDefOf(d.chassis) as unknown as Record<string, unknown> | null)?.[roleKey] !== 'chassis') return false
    this.payloadEdTab = slot
    this.payloadEdChassis = d.chassis
    this.payloadEdAttachments = d.attachments.filter((id) => shipModuleDefOf(id)?.payloadRole === 'attachment' && this.fitsAttachment(id, slot))
    this.owner.simState.hint(`已载入「${d.name}」`)
    logger.info(`[WarmCurrent] 设计载入：${d.uid} ${d.name} → 编辑区（${slot} 页）`)
    return true
  }

  /** 自定义荷载注册表同步（payloadDesigns → 合成模块投影；开关面板零成本幂等） */
  syncDynamicPayloadModules(): void {
    setDynamicShipModules(payloadDesignDefsOf(this.owner.simState.state.payloadDesigns ?? []))
  }

  /** 荷载设计工坊面板数据（designOpen 期间随部位页签出；三部位页签制，2026-09-20 并入导航页） */
  buildPayloadDesignVM(): HudPayloadDesign {
    const s = this.owner.simState.state
    const slotType = this.payloadEdTab
    const roleKey = SLOT_ROLE_KEY[slotType] ?? 'payloadRole'
    const partName = SLOT_TYPE_NAMES[slotType] ?? '荷载'
    const tabs = (['payload', 'fuel', 'engine'] as const).map((type) => ({ type, name: SLOT_TYPE_NAMES[type] ?? type }))
    const chassis: HudModuleRow[] = []
    const attachments: HudModuleRow[] = []
    // 已勾件恒入清单（保证不适配的已勾件在面板上可见可取消），新行按 fits 契合过滤
    for (const [id, m] of shipModuleEntries()) {
      const known = m.payloadRole === 'attachment' && (this.fitsAttachment(id, slotType) || this.payloadEdAttachments.includes(id))
      const row: HudModuleRow = {
        id,
        name: m.name,
        desc: m.desc,
        cost: m.cost,
        allowed: true,
        slotType: m.slotType ?? null,
        slotFull: false,
        slotLabel: null,
      }
      if ((m as unknown as Record<string, unknown>)[roleKey] === 'chassis') chassis.push(row)
      else if (known) attachments.push(row)
    }
    const draft: SimPayloadDesign = { uid: '', name: '', slotType, chassis: this.payloadEdChassis, attachments: [...this.payloadEdAttachments] }
    const synth = payloadDesignModuleDef(draft)
    // 预览效果行 = 主体/附件各自的表文案（表驱动，不在此复述数值）
    const effectParts: string[] = []
    const chassisDef = shipModuleDefOf(this.payloadEdChassis)
    if (chassisDef) effectParts.push(chassisDef.desc)
    for (const id of this.payloadEdAttachments) {
      const def = shipModuleDefOf(id)
      if (def) effectParts.push(def.desc)
    }
    const designs: HudPayloadRow[] = s.payloadDesigns.map((d, idx) => {
      const def = payloadDesignModuleDef({ ...d, slotType: d.slotType ?? 'payload' })
      return { idx, uid: d.uid, name: d.name, summary: def?.desc ?? d.chassis, cost: def?.cost ?? 0 }
    })
    return {
      tabs,
      chassis,
      attachments,
      selTab: slotType,
      selChassis: this.payloadEdChassis,
      selAttachments: [...this.payloadEdAttachments],
      synthName: `预览：自定义${partName} ${s.payloadDesigns.filter((d) => (d.slotType ?? 'payload') === slotType).length + 1}`,
      synthDesc: synth ? `${synth.desc}\n${effectParts.join(' · ')}` : '',
      synthCost: synth?.cost ?? 0,
      designs,
      canSave: !!synth,
    }
  }
}
