/**
 * DamageNumberFx — 伤害数字特效工具（fish 项目示例）
 *
 * 用法：
 *   DamageNumberFx.show(world, x, y, value, { color: '#ffd700', type: 'critical' })
 *
 * 流程：
 *  1. spawnUIActor('asset/blueprints/ui/damage_number.widget.json') 生成数字卡片
 *  2. 填充数值文本（DamageText 子节点）+ 颜色（普通白 / 暴击黄 / 治疗绿）
 *  3. TweenSystem 上浮（y +120px）+ 淡出，完成后销毁
 *
 * 单位边界（UI 一元化，doc-dev/ui-unit-unification）：本 API 入参保持旧米制语境
 * （x/y/floatHeight 为 3D 世界米），进入 px UI 世界前按 200px/m 一次换算
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
  /** 上浮高度（旧米制语境，默认 0.6m = 120px；内部换算后写 UI 世界） */
  floatHeight?: number
  /** 动画时长（秒，默认 0.9） */
  duration?: number
}

const DAMAGE_WIDGET = 'asset/blueprints/ui/damage_number.widget.json'

/** 旧米制 → 设计 px 换算（一元化前资产惯例 200px/m） */
const PX_PER_METER = 200

const TYPE_COLOR = {
  normal: '#ffffff',
  critical: '#ffd700',
  heal: '#4caf50',
} as const

export class DamageNumberFx {
  /**
   * 在 UI 空间 (x, y) 显示一个伤害数字。
   * @param world World（需 running）
   * @param x y  旧米制语境坐标（相对 HUD 根画布中心，1m = 200 设计 px）
   * @param value 数字
   */
  static show(world: World, x: number, y: number, value: number, options: DamageNumberOptions = {}): void {
    // UI 一元化：json/运行时几何均为设计 px，米制入参在此一次性换算（200px/m）
    const xPx = x * PX_PER_METER
    const yPx = y * PX_PER_METER
    const type = options.type ?? 'normal'
    const actor = world.ui.spawnUIActor(DAMAGE_WIDGET)
    if (!actor) {
      logger.error(`[DamageNumberFx] 卡片生成失败: ${DAMAGE_WIDGET}`)
      return
    }
    // 1. 位置：锚点 center + anchorOffset（相对 HUD 中心，px）
    const tsf = actor.getComponent(UITransformComponent)
    if (tsf) tsf.anchorOffset = [xPx, yPx]

    // 2. 文本 + 颜色（critical 放大字号）——widget 管线文本在 DamageText 子节点
    const textActor = actor.getChildren().find((c) => c.root.name === 'DamageText') ?? actor
    const textComp = textActor.getComponent(UITextComponent)
    if (textComp) {
      textComp.text = String(Math.round(value))
      textComp.color = options.color ?? TYPE_COLOR[type]
      if (type === 'critical') textComp.fontSize = 56
    }

    // 3. 上浮 + 淡出 + 销毁
    const floatHeight = (options.floatHeight ?? 0.6) * PX_PER_METER
    const duration = options.duration ?? 0.9
    if (tsf) {
      TweenSystem.instance.to(tsf, { anchorOffset: [xPx, yPx + floatHeight] }, { duration, easing: 'quadOut' })
    }
    TweenSystem.instance.fadeOut(actor, {
      duration,
      delay: duration * 0.4,
      onComplete: () => world.ui.destroyUIActor(actor),
    })
  }
}
