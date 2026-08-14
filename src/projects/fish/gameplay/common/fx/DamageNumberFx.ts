/**
 * DamageNumberFx — 伤害数字特效工具（fish 项目示例）
 *
 * 用法：
 *   DamageNumberFx.show(world, x, y, value, { color: '#ffd700', type: 'critical' })
 *
 * 流程：
 *  1. spawnUIActor('asset/blueprints/ui/damage_number.blueprint.json') 生成数字卡片
 *  2. 填充数值文本（DamageText 子节点）+ 颜色（普通白 / 暴击黄 / 治疗绿）
 *  3. TweenSystem 上浮（y +0.6）+ 淡出，完成后销毁
 *
 * 前置：游戏运行中（world.running），HUD 已创建（动态生成自动获得浮动层 zOrder 偏移）。
 */
import { TweenSystem, UITextComponent, UITransformComponent, logger } from '@/engine'
import type { World } from '@/engine'

export interface DamageNumberOptions {
  /** 数字颜色（默认按 type） */
  color?: string
  /** 类型：normal 普通白 / critical 暴击黄大号 / heal 治疗绿 */
  type?: 'normal' | 'critical' | 'heal'
  /** 上浮高度（世界单位，默认 0.6） */
  floatHeight?: number
  /** 动画时长（秒，默认 0.9） */
  duration?: number
}

const DAMAGE_WIDGET = 'asset/blueprints/ui/damage_number.blueprint.json'

const TYPE_COLOR = {
  normal: '#ffffff',
  critical: '#ffd700',
  heal: '#4caf50',
} as const

export class DamageNumberFx {
  /**
   * 在 UI 空间 (x, y) 显示一个伤害数字。
   * @param world World（需 running）
   * @param x y  UI 世界坐标（相对 HUD 根画布）
   * @param value 数字
   */
  static show(world: World, x: number, y: number, value: number, options: DamageNumberOptions = {}): void {
    const type = options.type ?? 'normal'
    const actor = world.ui.spawnUIActor(DAMAGE_WIDGET)
    if (!actor) {
      logger.error(`[DamageNumberFx] 卡片生成失败: ${DAMAGE_WIDGET}`)
      return
    }
    // 1. 位置：锚点 center + anchorOffset（相对 HUD 中心）
    const tsf = actor.getComponent(UITransformComponent)
    if (tsf) tsf.anchorOffset = [x, y]

    // 2. 文本 + 颜色（critical 放大字号）
    const textComp = actor.getComponent(UITextComponent)
    if (textComp) {
      textComp.text = String(Math.round(value))
      textComp.color = options.color ?? TYPE_COLOR[type]
      if (type === 'critical') textComp.fontSize = 56
    }

    // 3. 上浮 + 淡出 + 销毁
    const floatHeight = options.floatHeight ?? 0.6
    const duration = options.duration ?? 0.9
    if (tsf) {
      TweenSystem.instance.to(tsf, { anchorOffset: [x, y + floatHeight] }, { duration, easing: 'quadOut' })
    }
    TweenSystem.instance.fadeOut(actor, {
      duration,
      delay: duration * 0.4,
      onComplete: () => world.ui.destroyUIActor(actor),
    })
  }
}
