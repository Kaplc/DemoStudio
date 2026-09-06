/**
 * ArenaHud — 竞技场 HUD（代码构建，M1 垂直切片）
 *
 * 纯引擎 UI 组件装配（UITransform/CanvasUI/UIImage/UIText/UIProgressBar），
 * 不走 widget 资产编译链（M2 升级为 .widget.html 源格式）。
 * UI 坐标系：画布 1920×1080，原点画布中心、y 向上（UICamera 约定）。
 *
 * GameMode 每帧调用 syncFrom(mode) 同步血量/击杀/消息。
 */
import { HUD } from '@/engine'
import { GenericActor } from '@/engine'
import { UITransformComponent } from '@/engine'
import { CanvasUIComponent } from '@/engine'
import { UIImageComponent } from '@/engine'
import { UITextComponent } from '@/engine'
import { UIProgressBarComponent } from '@/engine'
import type { Actor } from '@/engine'

/** 创建带变换的 UI 子节点 */
function uiNode(parent: Actor, name: string, w: number, h: number, x: number, y: number): Actor {
  const node = new GenericActor(name)
  node.addComponent(UITransformComponent, {
    position: [x, y, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    worldWidth: w,
    worldHeight: h,
  })
  node.attachTo(parent)
  return node
}

export class ArenaHud extends HUD {
  private _hpBar: UIProgressBarComponent | null = null
  private _hpText: UITextComponent | null = null
  private _killText: UITextComponent | null = null
  private _msgText: UITextComponent | null = null
  private _comboText: UITextComponent | null = null

  constructor(name = 'ArenaHud') {
    super(name)

    // 根画布（不拦截点击：HUD 无交互控件，block 会挡住 3D 世界点击）
    this.addComponent(UITransformComponent, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth: 1920,
      worldHeight: 1080,
    })
    this.addComponent(CanvasUIComponent, {
      width: 1920,
      height: 1080,
      name: 'ArenaHudCanvas',
      zOrder: 10,
      active: true,
    })

    // ─── 左下：血条（fill 从左缘生长：middle-left 锚点，UIProgressBar 驱动宽度） ───
    const hpBg = uiNode(this, 'HpBarBg', 440, 34, -720, -480)
    hpBg.addComponent(UIImageComponent, { color: '#211a2e', radius: 8, opacity: 0.85, worldWidth: 440, worldHeight: 34 })
    const hpFill = new GenericActor('HpFill')
    hpFill.addComponent(UITransformComponent, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth: 420,
      worldHeight: 22,
      anchor: 'middle-left',
      anchorOffset: [10, 0],
    })
    hpFill.addComponent(UIImageComponent, { color: '#e0484f', radius: 5, worldWidth: 420, worldHeight: 22 })
    hpFill.attachTo(hpBg)
    this._hpBar = hpBg.addComponent(UIProgressBarComponent, { value: 1, min: 0, max: 1, fillActorName: 'HpFill' })
    const hpLabel = uiNode(this, 'HpLabel', 300, 30, -720, -430)
    this._hpText = hpLabel.addComponent(UITextComponent, {
      text: 'HP 100/100',
      fontSize: 22,
      color: '#f0eaff',
      align: 'left',
    })

    // ─── 顶部中央：房间消息 ───
    const msg = uiNode(this, 'RoomMsg', 900, 44, 0, 460)
    this._msgText = msg.addComponent(UITextComponent, {
      text: '清除所有史莱姆！',
      fontSize: 30,
      color: '#ffd76a',
      align: 'center',
    })

    // ─── 右上：击杀计数 ───
    const kills = uiNode(this, 'KillCounter', 400, 36, 700, 470)
    this._killText = kills.addComponent(UITextComponent, {
      text: '击杀 0 / 3',
      fontSize: 26,
      color: '#cfc4ea',
      align: 'right',
    })

    // ─── 左上：连段提示 ───
    const combo = uiNode(this, 'ComboHint', 400, 30, -720, 470)
    this._comboText = combo.addComponent(UITextComponent, {
      text: 'J / 左键 连击 · Shift 翻滚 · Space 跳',
      fontSize: 20,
      color: '#9a8fc0',
      align: 'left',
    })
  }

  /** 每帧同步（GameMode.Tick 调用） */
  sync(state: { hp: number; maxHp: number; kills: number; total: number; message: string; comboStage: number }): void {
    if (this._hpBar) this._hpBar.value = state.maxHp > 0 ? state.hp / state.maxHp : 0
    if (this._hpText) this._hpText.text = `HP ${Math.max(0, Math.ceil(state.hp))}/${state.maxHp}`
    if (this._killText) this._killText.text = `击杀 ${state.kills} / ${state.total}`
    if (this._msgText) this._msgText.text = state.message
    if (this._comboText) {
      this._comboText.text = state.comboStage > 0
        ? `连击 第${state.comboStage}段`
        : 'J / 左键 连击 · Shift 翻滚 · Space 跳'
      this._comboText.color = state.comboStage > 0 ? '#ffd76a' : '#9a8fc0'
    }
  }
}
