/**
 * PlaceGridActor — 放置示意网格 Actor（fish 项目专用）
 *
 * 封装引擎的纯划线工具（World.createGridLines → ThreeObjectFactory.createGridLines）：
 *  - BeginPlay 时经 World 工厂统一创建线条（追踪释放）并挂 LineComponent 托管
 *  - 默认隐藏，setVisible 控制显隐（进入/退出放置模式）
 *  - EndPlay 由 LineComponent 自动释放 geometry/material
 *
 * 格子规则（游戏侧计算，引擎不感知）：建筑中心在整数坐标（格子中心），
 * 网格线画在格子边界 = 中心坐标 ±0.5（半整数）。
 *
 * 使用：
 *   const grid = new PlaceGridActor('PlaceGrid', { min, max, step, color, opacity, y })
 *   spawnActor(grid)
 *   grid.setVisible(true)
 */
import * as THREE from 'three'
import { GenericActor, LineComponent, logger } from '@/engine'
import type { ThreeObject } from '@/engine'

export interface PlaceGridActorOptions {
  /** 网格范围最小值（含） */
  min: number
  /** 网格范围最大值（含） */
  max: number
  /** 线间距 */
  step: number
  /** 线条颜色 */
  color: number
  /** 是否半透明（默认 false） */
  transparent?: boolean
  /** 透明度（transparent 时生效） */
  opacity?: number
  /** 网格所在高度（默认 y=0） */
  y?: number
  /** 初始可见（默认 false：需要时 setVisible 显示） */
  visible?: boolean
}

export class PlaceGridActor extends GenericActor {
  /** 网格配置（BeginPlay 时使用） */
  readonly options: PlaceGridActorOptions
  /** 网格线条（ThreeObject 包装；LineComponent 托管，EndPlay 自动释放） */
  private lines: ThreeObject<THREE.LineSegments> | null = null

  constructor(name: string, options: PlaceGridActorOptions) {
    super(name)
    this.options = options
  }

  override BeginPlay(): void {
    super.BeginPlay()
    const w = this.world
    if (!w) return
    // 经 World 工厂统一生成（追踪释放），挂 LineComponent 随本 Actor 生命周期释放。
    // 注意：直接接住 ThreeObject 外壳，避免再 .object 解包导致工厂追踪链断裂。
    this.lines = w.createGridLines(
      this.options.min,
      this.options.max,
      this.options.step,
      this.options.color,
      this.options.transparent,
      this.options.opacity,
    )
    this.lines.object.position.y = this.options.y ?? 0
    this.lines.object.visible = this.options.visible ?? false
    this.addComponent(LineComponent, this.lines, 'GridLines')
    logger.info(`[PlaceGridActor] "${this.name}" 已创建（范围 [${this.options.min}, ${this.options.max}]，步长 ${this.options.step}）`)
  }

  /** 切换网格显隐（放置模式进入/退出） */
  setVisible(visible: boolean): void {
    if (this.lines) this.lines.object.visible = visible
  }

  override EndPlay(): void {
    // 线条由 LineComponent.EndPlay 自动释放 geometry/material
    this.lines = null
    super.EndPlay()
  }
}
