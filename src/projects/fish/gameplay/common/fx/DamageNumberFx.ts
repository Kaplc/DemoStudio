/**
 * DamageNumberFx — 伤害数字特效工具（fish 项目示例）
 *
 * 用法：
 *   DamageNumberFx.show(world, x, y, value, { color: '#ffd700', type: 'critical' })        // 旧 UI 坐标 API（米制语境）
 *   DamageNumberFx.showAtWorld(world, worldPos, value, { type: 'critical' })               // 世界锚定 API（World-Space UI）
 *
 * 流程：
 *  1. spawnUIActor('asset/blueprints/ui/damage_number.widget.json') 生成数字卡片
 *  2. 填充数值文本（DamageText 子节点）+ 颜色（普通白 / 暴击黄 / 治疗绿）
 *  3. TweenSystem 上浮（y +120px）+ 淡出，完成后销毁
 *
 * showAtWorld（doc-dev/ui-world-space P1）：内部经 UICamera.projectToUi 投影到
 * UI 设计 px，逐帧锚定跟随（UIWorldAnchor mode=screen + clamping=clamp）；
 * 池化 + 同屏上限（MAX_ACTIVE，超出排队）：高频连击不爆 canvas 纹理预算，
 * 排队号码在有空位时补放（聚合交给调用方按需实现，引擎侧保底限流）。
 *
 * 单位边界（UI 一元化，doc-dev/ui-unit-unification）：show() 入参保持旧米制语境
 * （x/y/floatHeight 为 3D 世界米），进入 px UI 世界前按 200px/m 一次换算；
 * showAtWorld 入参为世界米制坐标，投影换算由引擎工具承担。
 *
 * 前置：游戏运行中（world.running），HUD 已创建（动态生成自动获得浮动层 zOrder 偏移）。
 */
import * as THREE from 'three'
import {
  TweenSystem, UITextComponent, UITransformComponent, logger,
  UIWorldAnchorComponent, UICamera, GameInstance,
} from '@/engine'
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

/** showAtWorld 同屏上限（D6 设计准则：伤害数字同屏 5-6 个，快速连击聚合） */
const MAX_ACTIVE = 6

const TYPE_COLOR = {
  normal: '#ffffff',
  critical: '#ffd700',
  heal: '#4caf50',
} as const

/** 排队中待放的号码（worldPos 快照 + 数值 + 选项），有空位时按序补放 */
interface QueuedNumber {
  worldPos: THREE.Vector3
  value: number
  options: DamageNumberOptions
}

/** 全局活跃实例计数 + 排队队列（跨场景由 destroyAll 清 UI 后计数自然回落，队列手动清） */
let activeCount = 0
const queue: QueuedNumber[] = []

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

  /**
   * 在世界坐标处显示一个伤害数字（World-Space UI 屏幕跟随，P1 用例入口）。
   *
   * 内部：生成 damage_number widget + UIWorldAnchorComponent(mode=screen,
   * clamping=clamp) → 每帧投影 target 位置（临时隐形 target Actor 承载世界坐标）
   * → 上浮动画沿局部 offset 演出 → 淡出销毁。
   *
   * 池化/限流：同屏活跃数超 MAX_ACTIVE 时入队，等待空位按序补放（TC-W1.6）。
   * @param world    World（需 running）
   * @param worldPos 世界坐标（米制 3D 世界；上浮沿 localOffset.y 演出）
   * @param value    数字
   */
  static showAtWorld(world: World, worldPos: THREE.Vector3, value: number, options: DamageNumberOptions = {}): void {
    if (activeCount >= MAX_ACTIVE) {
      queue.push({ worldPos: worldPos.clone(), value, options })
      logger.info(`[DamageNumberFx] 同屏已满(${activeCount}/${MAX_ACTIVE})，号码 ${Math.round(value)} 入队（深度 ${queue.length}）`)
      if (queue.length > MAX_ACTIVE * 2) {
        const dropped = queue.shift() // 队列兜底：积压过深丢弃最旧
        logger.warn(`[DamageNumberFx] 队列积压过深(${queue.length})，丢弃最旧号码 ${dropped ? Math.round(dropped.value) : '?'}`)
      }
      return
    }
    this.spawnAtWorld(world, worldPos, value, options)
  }

  /** 实际生成（活跃计数 +1；动画完成 -1 并尝试补放队首） */
  private static spawnAtWorld(world: World, worldPos: THREE.Vector3, value: number, options: DamageNumberOptions): void {
    const type = options.type ?? 'normal'
    const actor = world.ui.spawnUIActor(DAMAGE_WIDGET)
    if (!actor) {
      logger.error(`[DamageNumberFx] 卡片生成失败: ${DAMAGE_WIDGET}`)
      return
    }
    activeCount++

    // 出屏钳制（伤害数字出屏时钳在安全区边缘仍可见）
    const anchor = new UIWorldAnchorComponent(actor, { mode: 'screen', clamping: 'clamp' })
    actor.addComponent(anchor)

    // 初始位置：世界坐标 → UI px（一次性投影；伤害数字生命周期 <1s 且锚点固定，
    // 用"静态投影 + 上浮"演出即可，无需长期 target 跟随）
    const ui = UICamera.projectToUi(GameInstance.current?.getActiveCamera() ?? null, worldPos)
    const tsf = actor.getComponent(UITransformComponent)
    if (ui && tsf) tsf.anchorOffset = [ui[0], ui[1]]

    // 文本 + 颜色
    const textActor = actor.getChildren().find((c) => c.root.name === 'DamageText') ?? actor
    const textComp = textActor.getComponent(UITextComponent)
    if (textComp) {
      textComp.text = String(Math.round(value))
      textComp.color = options.color ?? TYPE_COLOR[type]
      if (type === 'critical') textComp.fontSize = 56
    }

    // 上浮（anchorOffset.y +120px）+ 淡出 + 销毁 + 计数回落
    const duration = options.duration ?? 0.9
    if (tsf && ui) {
      TweenSystem.instance.to(tsf, { anchorOffset: [ui[0], ui[1] + (options.floatHeight ?? 0.6) * PX_PER_METER] }, { duration, easing: 'quadOut' })
    }
    TweenSystem.instance.fadeOut(actor, {
      duration,
      delay: duration * 0.4,
      onComplete: () => {
        world.ui.destroyUIActor(actor)
        activeCount--
        // 有空位 → 补放队首（池化补位）
        const next = queue.shift()
        if (next) {
          logger.info(`[DamageNumberFx] 池空位补放号码 ${Math.round(next.value)}（剩余队列 ${queue.length}）`)
          this.spawnAtWorld(world, next.worldPos, next.value, next.options)
        }
      },
    })
  }

  /** 清空排队队列（场景切换时调用防跨场景补放；引擎 destroyAll 后计数自然回落） */
  static clearQueue(): void {
    queue.length = 0
  }

  /**
   * 重置池状态（队列清空 + 活跃计数归零）。
   * 测试隔离用；场景切换走 destroyAll 后正常演出会自然回落，仅极端中断时兜底。
   */
  static resetPool(): void {
    queue.length = 0
    activeCount = 0
  }
}
