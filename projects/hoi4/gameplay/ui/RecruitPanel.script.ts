/**
 * RecruitPanelScript — 征兵与部署面板（模板训练队列 + 部署模式）
 */
import { BehaviourScript, UILayoutComponent, UIImageComponent, logger, UIProgressBarComponent, UITextComponent, Actor } from '@/engine'
import { Hoi4PanelScript, hoi4Mode, findButton, findText, TextBinder } from './uiCommon'

const ROW_WIDGET = 'asset/blueprints/ui/queue_row.widget.json'

export default class RecruitPanelScript extends Hoi4PanelScript {
  private binder = new TextBinder()
  private tplButtons: Array<{ id: string; label: UITextComponent | null; sub: UITextComponent | null; img: UIImageComponent | null }> = []
  private queueRows: Array<{ actor: Actor; bar: UIProgressBarComponent | null; info: UITextComponent | null }> = []
  private onTick = (): void => this.refresh()
  private built = false

  override onStart(): void {
    const mode = hoi4Mode()
    if (!mode) {
      logger.warn('[RecruitPanelScript] GameMode 未就绪')
      return
    }
    this.bindClose()
    mode.hourTickListeners.add(this.onTick)
    const deployBtn = findButton(this.actor, 'Btn_deploy')
    if (deployBtn) {
      deployBtn.onClick = () => {
        const m = hoi4Mode()
        if (!m?.coreState?.playerTag) return
        m.cmdSetDeployArmed(!m.deployArmed)
        this.refresh()
      }
    }
  }

  private refresh(): void {
    const mode = hoi4Mode()
    if (!mode?.coreState) return
    const state = mode.coreState
    const tables = mode.getTables()
    const c = state.playerTag ? state.countries[state.playerTag] : null
    if (!c) return
    this.binder.set(findText(this.actor, 'MpText'), `人力 ${(c.manpower / 1000).toFixed(0)}k · 训练中 ${c.trainingQueue.length} · 待部署 ${c.deployPool.length}`)

    // 模板按钮（含自定义模板；解锁的才可点）
    const box = this.findInChildren('TplBox')
    if (box && !this.built) {
      this.built = true
      const allIds = [...Object.keys(tables.templates), ...Object.keys(c.customTemplates)]
      for (const id of allIds) {
        const def = tables.templates[id] ?? c.customTemplates[id]
        const btn = this.world?.ui.spawnUIActor('asset/blueprints/ui/equip_card.widget.json', box)
        if (!btn) continue
        const label = findText(btn, 'Label_equip')
        if (label) label.text = def?.name ?? id
        const sub = findText(btn, 'SubLabel')
        this.tplButtons.push({ id, label, sub, img: null })
        const b = findButton(btn, 'Btn_add')
        if (b) b.onClick = () => hoi4Mode()?.cmdQueueTraining(id)
      }
    }
    for (const t of this.tplButtons) {
      const unlocked = templateOk(state, tables, state.playerTag!, t.id)
      if (t.sub) t.sub.text = unlocked ? '点击训练一个师' : '装备/营未解锁'
    }

    // 训练队列
    if (this.queueRows.length !== c.trainingQueue.length) {
      for (const r of this.queueRows) this.world?.ui.destroyUIActor(r.actor)
      this.queueRows = []
      const list = this.findInChildren('QueueList')
      if (list) {
        for (const item of c.trainingQueue) {
          const row = this.world?.ui.spawnUIActor(ROW_WIDGET, list)
          if (!row) continue
          this.queueRows.push({ actor: row, bar: findBarOf(row), info: findText(row, 'InfoText') })
          const nameT = findText(row, 'NameText')
          const def = tables.templates[item.template] ?? c.customTemplates[item.template]
          if (nameT) nameT.text = def?.name ?? item.template
          const actLabel = findText(row, 'Label_act')
          if (actLabel) actLabel.text = ''
        }
        list.getComponent(UILayoutComponent)?.layout()
      }
    }
    c.trainingQueue.forEach((item, i) => {
      const r = this.queueRows[i]
      if (!r) return
      const def = tables.templates[item.template] ?? c.customTemplates[item.template]
      const total = tables.combat.trainingDays
      if (r.bar) r.bar.value = (1 - item.daysLeft / total) * 100
      if (r.info) r.info.text = `剩余 ${Math.ceil(item.daysLeft)} 天`
      void def
    })

    // 部署区
    this.binder.set(findText(this.actor, 'DeployText'), mode.deployArmed ? '部署模式中：关闭面板后点击地图己方省' : `待部署师：${c.deployPool.length}（部署默认落在选中省）`)
    const deployLabel = findText(this.actor, 'Label_deploy')
    if (deployLabel) deployLabel.text = mode.deployArmed ? '取消部署模式' : '进入部署模式'
  }

  override onDestroy(): void {
    hoi4Mode()?.hourTickListeners.delete(this.onTick)
    for (const r of this.queueRows) this.world?.ui.destroyUIActor(r.actor)
    this.queueRows = []
  }
}

function templateOk(state: import('../../gameplay/core/types').Hoi4State, tables: import('../../gameplay/core/tables').Hoi4Tables, tag: string, templateId: string): boolean {
  const c = state.countries[tag]
  if (!c) return false
  const tpl = tables.templates[templateId] ?? c.customTemplates[templateId]
  if (!tpl) return false
  for (const bid of Object.keys(tpl.battalions)) {
    const b = tables.battalions[bid]
    if (!b) continue
    for (const eq of Object.keys(b.equipment)) {
      if (eq === 'infantry_equipment') continue
      if (!c.unlockedEquipments.includes(eq)) return false
    }
  }
  return true
}

function findBarOf(root: Actor): UIProgressBarComponent | null {
  const walk = (a: Actor): UIProgressBarComponent | null => {
    const own = a.getComponents(UIProgressBarComponent)
    if (own.length > 0) return own[0]
    for (const ch of a.getChildren()) {
      const hit = walk(ch)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}
