/**
 * LootFlyFx — 战利品飞行特效工具（攻打战斗：金币/圣水飞向顶部战利品栏）
 *
 * 用法：
 *   LootFlyFx.show(world, { x, y, z }, 'coins', { onArrive: () => hud.refreshLoot() })
 *
 * 流程：
 *  1. 世界坐标 → UI 坐标投影（相机 project → NDC → UI 画布坐标，16:9 标准映射）
 *  2. spawnUIActor('asset/blueprints/ui/loot_fly.widget.json') 生成圆形小圆点
 *  3. 设置颜色（金币金 #fbc02d / 圣水紫 #8e24aa）+ 起点 anchorOffset
 *  4. TweenSystem 弧线飞行 0.6s（抛物线：x 线性 + y 上抛）到达顶部栏
 *  5. 到达后销毁 + 回调 onArrive（调用方刷新顶部数字）
 *
 * 频控：全局同时最多 MAX_ACTIVE_FLY 个飞行物；超出直接丢弃动画，
 * 但立即执行 onArrive（数字照常增加，只是不播动画）。
 *
 * 前置：游戏运行中（world.running），HUD 已创建（动态生成自动获得浮动层 zOrder 偏移）。
 */
import * as THREE from 'three'
import { TweenSystem, UITransformComponent, UIImageComponent, CanvasUIComponent, logger, GameInstance, UICamera } from '@/engine'
import type { World, Actor } from '@/engine'

/** 飞行物 widget 路径（圆形小圆点在 Fly 子节点，颜色运行时设置） */
const FLY_WIDGET = 'asset/blueprints/ui/loot_fly.widget.json'

/** 飞行时长（秒） */
const FLY_DURATION = 0.6
/** 弧线最高点（UI px，相对起终点直线；旧米制 1.0m × 200px/m） */
const FLY_ARC = 200
/** 全局同时在飞数量上限（超出丢弃动画） */
const MAX_ACTIVE_FLY = 8
/** 顶部战利品栏中心 UI 坐标（LootBar top-center 锚点 + 底条半高；px 世界 200px/m 惯例 ×200） */
const TOP_BAR_UI: [number, number] = [0, 480]

/** 战利品类型：金币 / 圣水 */
export type LootKind = 'coins' | 'elixir'

/** 战利品颜色（与金矿/水库类型表 color 一致：金矿 0xfbc02d / 水库 0x8e24aa） */
const KIND_COLOR: Record<LootKind, string> = {
  coins: '#fbc02d',
  elixir: '#8e24aa',
}

/** 当前在飞数量（频控） */
let activeFlyCount = 0

export interface LootFlyOptions {
  /** 终点 UI 坐标（默认顶部战利品栏 LootBar 中心 [0, 2.4]） */
  toUi?: [number, number]
  /** 到达回调（数字跳变时机；频控丢弃时立即调用） */
  onArrive?: () => void
}

export class LootFlyFx {
  /**
   * 从世界坐标（建筑位置）发射一个战利品飞行物到顶部栏。
   * @param world World（需 running，HUD 已创建）
   * @param fromWorld 起点世界坐标（建筑中心/头顶）
   * @param kind 金币 / 圣水（决定颜色）
   */
  static show(world: World, fromWorld: { x: number; y: number; z: number }, kind: LootKind, options: LootFlyOptions = {}): void {
    // ─── 频控：同时在飞已满 → 丢弃动画（数字照常增加，立即回调） ───
    if (activeFlyCount >= MAX_ACTIVE_FLY) {
      logger.info(`[LootFlyFx] 频控丢弃 ${kind} 飞行（在飞 ${activeFlyCount}/${MAX_ACTIVE_FLY}），数字已直接增加`)
      options.onArrive?.()
      return
    }
    // ─── 起点：世界坐标 → UI 坐标（NDC → 画布坐标） ───
    const fromUi = worldToUi(fromWorld)
    if (!fromUi) {
      logger.warn('[LootFlyFx] 世界坐标投影失败（相机不可用/点在相机背面），跳过飞行')
      options.onArrive?.()
      return
    }
    // ─── 生成飞行物并设置起点/颜色 ───
    // 关键：挂到真实画布宿主（HUD 子树第一个非 markerOnly 画布，如 BattleHUD）而非 HUD 本身
    // —— HUD 是纯容器无画布尺寸，锚点 applyAnchor 找不到容器会跳过，position 钉在 (0,0)。
    const host = findCanvasHost(world)
    const actor = world.ui.spawnUIActor(FLY_WIDGET, host ?? undefined)
    if (!actor) {
      logger.error(`[LootFlyFx] 飞行物生成失败: ${FLY_WIDGET}`)
      options.onArrive?.()
      return
    }
    const tsf = actor.getComponent(UITransformComponent)
    if (!tsf) {
      logger.error('[LootFlyFx] 飞行物缺 UITransformComponent，销毁')
      world.ui.destroyUIActor(actor)
      options.onArrive?.()
      return
    }
    // 颜色：UIImageComponent.color（widget 管线圆点在 Fly 子节点，默认金，圣水改紫）
    const flyImageActor = actor.getChildren().find((c) => c.root.name === 'Fly') ?? actor
    const image = flyImageActor.getComponent(UIImageComponent)
    if (image) image.color = KIND_COLOR[kind]

    const [sx, sy] = fromUi
    const [ex, ey] = options.toUi ?? TOP_BAR_UI
    tsf.anchorOffset = [sx, sy]
    activeFlyCount++
    logger.info(`[LootFlyFx] ${kind} 飞行: (${sx.toFixed(2)},${sy.toFixed(2)}) → (${ex.toFixed(2)},${ey.toFixed(2)})（在飞 ${activeFlyCount}/${MAX_ACTIVE_FLY}）`)

    // ─── 弧线飞行：x 线性插值 + y 抛物线（sin 上抛），到达后销毁 + 回调 ───
    const progress = { p: 0 }
    TweenSystem.instance.to(progress, { p: 1 }, {
      duration: FLY_DURATION,
      easing: 'quadOut',
      onUpdate: (v) => {
        const t = Number(v.p)
        const x = sx + (ex - sx) * t
        const y = sy + (ey - sy) * t + Math.sin(Math.PI * t) * FLY_ARC
        tsf.anchorOffset = [x, y]
      },
      onComplete: () => {
        activeFlyCount--
        world.ui.destroyUIActor(actor)
        options.onArrive?.()
        logger.info(`[LootFlyFx] ${kind} 到达顶部栏（在飞 ${activeFlyCount}/${MAX_ACTIVE_FLY}）`)
      },
    })
  }
}

/** 世界坐标 → UI 画布坐标（收编到 UICamera.projectToUi：背面剔除 + NDC → 设计 px 映射） */
function worldToUi(pos: { x: number; y: number; z: number }): [number, number] | null {
  const cam = GameInstance.current?.getActiveCamera() ?? null
  return UICamera.projectToUi(cam, new THREE.Vector3(pos.x, pos.y, pos.z))
}

/**
 * 找真实画布宿主：HUD 子树中第一个挂非 markerOnly CanvasUIComponent 的 Actor
 * （如 battle_hud.widget.json 根 BattleHUD）。飞行物挂其下，锚点 applyAnchor
 * 才能从父容器取到画布尺寸（9.6×5.4），anchorOffset 才会驱动 position。
 */
function findCanvasHost(world: World): Actor | null {
  for (const a of world.ui.getAllUIActors()) {
    for (const comp of a.getComponents(CanvasUIComponent)) {
      if (!comp.isMarkerOnly) return a
    }
  }
  return null
}
