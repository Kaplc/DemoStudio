/**
 * Game — 游戏入口类
 * Viewport 通过此类管理游戏的生命周期
 * 职责：创建并包装 GameInstance、管理 Tick/Camera 同步的注册/注销、输入路由
 *
 * 用法：
 *   const game = new Game(sceneMgr)
 *   game.createInstance(projectName, shared, container) // 创建游戏实例
 *   game.launch()   // 启动
 *   game.shutdown() // 停止
 *   game.update(dt) // 每帧（自动注册到 sceneMgr.onUpdate）
 *
 * Game 视口渲染器（SceneRendererComponent）由 World.ensureGameRenderer 创建并挂载，
 * DOM 由组件内部从 GameInstance.current.renderContainer 获取。
 */
import * as THREE from 'three'
import { logger, PhySys } from '..'
import type { SceneRendererComponent } from './SceneRendererComponent'
import type { SceneRenderHost } from '../rendering/SceneRenderHost'
import { GameInstance } from './GameInstance'
import type { GameInstanceCallbacks } from './GameInstance'
import { AIModule } from '../ai/AIModule'
import { GameFactoryRegistry } from '../tools/GameFactoryRegistry'
import { ObjectRegistry } from '../tools/ObjectRegistry'
import { ThreeObject } from '../rendering/ThreeObject'
import { ThreeObjectFactory } from './ThreeObjectFactory'
import type { World } from './World'
import type { OObject } from '../entity/OObject'

/**
 * 游戏运行级单例接口：有运行状态的全局单例（如 PhySys / AIModule）。
 * 由 Game.launch 注册、Game.shutdown 统一回收 —— 生命周期绑定 Game。
 */
export interface GameSingleton {
  /** 单例名（日志用） */
  readonly name: string
  /** 游戏停止时回收运行状态（清相机/注册表/上下文等） */
  reset(): void
}

export class Game {
  private _instance: GameInstance | null = null

  private sceneMgr: SceneRenderHost | null = null
  private removeTick: (() => void) | null = null
  /** 防止 shutdown 被重复调用（effect cleanup 和切换工程可能同时触发） */
  private _shutdown = true

  /** 实例状态回调（createInstance 创建实例时自动注入） */
  private _callbacks: GameInstanceCallbacks = {}

  /** 运行级单例注册表（launch 时收集，shutdown 时统一回收） */
  private _singletons: GameSingleton[] = []

  /** THREE 对象工厂（统一创建 + 追踪，shutdown 时 disposeAll 回收） */
  private readonly _factory = new ThreeObjectFactory()

  /** 启动时对象基线快照（shutdown 时对比，诊断本局创建但未回收的 OObject） */
  private _objBaseline: ReadonlySet<OObject> | null = null

  /** 当前项目名（createInstance 记录；游戏日志 header 用） */
  private _projectName = ''

  // ════════════════════════════════════════
  //  THREE 对象工厂（禁止裸 new THREE.xxx —— 统一经此创建并追踪）
  // ════════════════════════════════════════

  /** 创建 Mesh（追踪释放） */
  createMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.Mesh> {
    return this._factory.createMesh(geometry, material)
  }

  /** 创建 Group（追踪释放） */
  createGroup(): ThreeObject<THREE.Group> {
    return this._factory.createGroup()
  }

  /** 创建 Line / LineSegments（追踪释放） */
  createLine(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): ThreeObject<THREE.LineSegments> {
    return this._factory.createLine(geometry, material)
  }

  /** 创建 Sprite（追踪释放） */
  createSprite(material: THREE.SpriteMaterial): ThreeObject<THREE.Sprite> {
    return this._factory.createSprite(material)
  }

  /** 创建 Points（追踪释放） */
  createPoints(geometry: THREE.BufferGeometry, material: THREE.PointsMaterial): ThreeObject<THREE.Points> {
    return this._factory.createPoints(geometry, material)
  }

  /**
   * 手动创建任意 Object3D（追踪释放）。
   * 仅在工厂方法未覆盖的类型时使用；工厂方法应优先。
   */
  trackObject<T extends THREE.Object3D>(object: T): ThreeObject<T> {
    return this._factory.trackObject(object)
  }

  /** 当前追踪的 THREE 对象数（调试用） */
  get threeObjectCount(): number {
    return this._factory.count
  }

  constructor(sceneMgr?: SceneRenderHost | null) {
    this.sceneMgr = sceneMgr ?? null
    this._shutdown = false  // 初始状态允许 shutdown
  }

  get instance(): GameInstance | null { return this._instance }

  /** 注册实例状态回调（启动游戏前调用；createInstance 时自动注入） */
  setCallbacks(cbs: GameInstanceCallbacks) {
    this._callbacks = cbs
  }

  /**
   * 创建游戏实例（每次启动新建，确保代码变更生效）。
   * 由工厂按项目名创建，自动注入回调；已有实例先销毁。
   * @returns 创建的实例；项目未注册工厂/创建失败时返回 null
   */
  createInstance(projectName: string, shared: THREE.Scene, container: HTMLElement | null): GameInstance | null {
    // 已有实例（上次运行残留）先销毁
    if (this._instance) {
      this.shutdown()
      this._instance = null
    }
    this._projectName = projectName
    if (!GameFactoryRegistry.has(projectName)) {
      logger.warn(`[Game] 工程 "${projectName}" 未注册游戏实例工厂，跳过创建`)
      return null
    }
    const inst = GameFactoryRegistry.create(projectName, shared, container)
    if (!inst) {
      logger.error(`[Game] 游戏实例创建失败: ${projectName}`)
      return null
    }
    inst.setCallbacks(this._callbacks)
    this._instance = inst
    // 单例：当前活跃实例（SceneRendererComponent 等组件自行从 GameInstance.current 获取 DOM）
    GameInstance.setCurrent(inst)
    this._shutdown = false  // 新实例需要新的 shutdown 生命周期
    logger.info(`[Game] 游戏实例已创建: ${inst.constructor.name} (${projectName})`)
    return inst
  }

  /**
   * 当前 Game 视口渲染器组件（创建/挂载由 World.ensureGameRenderer 负责，
   * DOM 由组件内部从 GameInstance.current.renderContainer 获取；无容器时为 null）
   */
  private ensureGameMgr(): SceneRendererComponent | null {
    const world = this._instance ? (this._instance as unknown as { world?: World }).world : null
    if (!world) return null
    return world.ensureGameRenderer()
  }

  /** 关联 Scene 视口渲染宿主（可在构造后设置） */
  setRenderers(sceneMgr: SceneRenderHost) {
    this.sceneMgr = sceneMgr
  }

  /** 启动游戏 */
  launch(): boolean {
    logger.info('[Game] 启动游戏...')

    // 游戏日志：每次启动创建独立 game_*.log 文件（滚动删除），记录本局全部日志
    logger.beginGameLog(this._projectName)

    // 对象基线快照：记录本局运行前已存活的对象（shutdown 时对比诊断未回收对象）
    this._objBaseline = new Set(ObjectRegistry.snapshot())

    const inst = this._instance
    if (!inst) {
      logger.error('[Game] 无游戏实例，请先调用 createInstance()')
      return false
    }

    // Game 视口渲染器：DOM 保存在 instance.renderContainer，启动时取出创建
    const gameMgr = this.ensureGameMgr()

    // 启动游戏实例（UI 渲染统一走 UI 摄像机 + CanvasTexture 体系，无 DOM UI 层）
    logger.info(`[Game] 启动游戏实例: ${inst.constructor.name}`)
    const ok = inst.start()
    if (!ok) {
      logger.error(`[Game] 游戏实例 start() 返回 false，启动失败: ${inst.constructor.name}`)
      return false
    }

    // 启用 Game 渲染
    if (gameMgr) {
      gameMgr.setControlsEnabled(true)
      // UI 独立场景接入叠加渲染（widget 与 3D 场景分离，场景由 UIManager 持有）
      const world = (inst as unknown as { world?: World }).world
      if (world?.ui?.scene) {
        gameMgr.attachUIScene(world.ui.scene)
        // 双摄像机：PhySys 注入 UI 独立相机，UI 层点击用平行射线（优先于 3D）
        PhySys.setupUI(gameMgr.uiCamera)
      }
      gameMgr.start()
      logger.info('[SceneRendererComponent] 渲染循环已启动')
    }

    // Tick + Gizmos 绘制挂到 Scene View 的 rAF 上
    if (this.sceneMgr) {
      this.removeTick = this.sceneMgr.onUpdate((dt) => {
        inst.tick(dt)
        inst.drawGizmos()
      })
      logger.info('[Game] GameInstance.tick/drawGizmos 已挂到 Scene 视口 rAF')
    }

    // Game 摄像机：注册委托，渲染器每帧从游戏实例获取当前主摄像机直接渲染
    if (gameMgr) {
      gameMgr.setCameraProvider(() => inst.getActiveCamera())
      logger.info('[Game] 相机委托已注册（渲染器从游戏实例获取主摄像机）')
    }

    logger.info('[Game] 游戏已启动')

    // 运行级单例注册表：启动时收集（shutdown 时统一回收）
    this._singletons = [PhySys, AIModule.instance]

    // AI 事件模块：附加运行上下文（world 来自游戏实例的 duck-typed 字段）
    const world = (inst as unknown as { world?: World }).world
    if (world) {
      AIModule.instance.attachContext(world, inst)
    } else {
      logger.warn('[Game] 游戏实例无 world 字段，AI 事件模块上下文未附加')
    }
    return true
  }

  /** 停止游戏 */
  shutdown() {
    if (this._shutdown) return
    this._shutdown = true
    logger.info('[Game] 停止游戏...')

    // 注销回调
    this.removeTick?.()
    this.removeTick = null
    logger.info('[Game] Tick 回调已注销')

    // 完全销毁游戏实例（stop + world.Destroy + 组件注销）
    this._instance?.destroy()
    // 终态化输入子系统（InputSys 纳入 BObject 体系，随实例销毁回收）
    this._instance?.teardown()
    // 显式终态标记（幂等）：world.Destroy 内 reclaimForWorld 依赖 world 字段隐式回收
    // GameInstance，此处保证注册表一致性（未来子类无 world 字段也不会泄漏）
    this._instance?.markDestroyed()
    // 单例：清除当前活跃实例
    GameInstance.setCurrent(null)
    logger.info('[Game] 游戏实例已销毁，单例已清除')

    // 禁用 Game 渲染、解除相机委托、重置视角
    const gameMgr = this.ensureGameMgr()
    if (gameMgr) {
      gameMgr.setCameraProvider(null)
      gameMgr.setControlsEnabled(false)
      gameMgr.attachUIScene(null)
      PhySys.setupUI(null)
      gameMgr.stop()
      gameMgr.clearFrame()
      gameMgr.resetView()
    }

    // 统一回收运行级单例（PhySys 清相机/clickable 注册表，AIModule 清运行上下文）
    for (const s of this._singletons) {
      s.reset()
      logger.info(`[Game] 单例已回收: ${s.name}`)
    }
    this._singletons = []

    // 统一释放本 Game 创建的全部 THREE 对象（GPU 资源：geometry/material/texture）
    const total = this._factory.count
    if (total > 0) {
      const orphans = this._factory.disposeAll()
      // 兜底诊断：正常路径由组件 EndPlay 释放（disposed=true）；
      // 未释放的 = 组件销毁链路异常（有 owner）或基础设施（owner=null，预期由本处回收）
      if (orphans.length > 0) {
        for (const o of orphans) {
          logger.warn(
            `[Game] 兜底释放未回收的 THREE 对象: ${o.object.type}` +
              `（${o.owner ? `Actor=${o.owner.name}` : '基础设施/无归属'}）`
          )
        }
      }
      logger.info(
        `[Game] 已释放 ${total} 个 THREE 对象` +
          `${orphans.length > 0 ? `（其中 ${orphans.length} 个为兜底回收）` : ''}`
      )
    }

    // 结束游戏日志：本局日志已写入 game_*.log（文件保留，滚动清理）
    logger.endGameLog()

    // 对象泄漏诊断：对比启动基线，输出本局创建但未回收的 OObject
    if (this._objBaseline) {
      const leaked = ObjectRegistry.diffSince(this._objBaseline)
      this._objBaseline = null
      if (leaked.length > 0) {
        // 按类名分组统计
        const byClass = new Map<string, number>()
        for (const o of leaked) {
          const cls = (o.constructor as { name?: string })?.name ?? 'Unknown'
          byClass.set(cls, (byClass.get(cls) ?? 0) + 1)
        }
        const summary = [...byClass.entries()].map(([c, n]) => `${c}×${n}`).join(', ')
        logger.warn(`[Game] 对象泄漏诊断：${leaked.length} 个 OObject 未回收（${summary}）`)
        // 详情（最多列前 10 个，含名字/uid/world 归属）
        for (const o of leaked.slice(0, 10)) {
          const anyObj = o as { name?: string; uid?: number; world?: { name?: string } | null }
          const info = [
            `类=${(o.constructor as { name?: string })?.name ?? '?'}`,
            anyObj.name ? `name=${anyObj.name}` : '',
            anyObj.uid !== undefined ? `uid=${anyObj.uid}` : '',
            anyObj.world ? `world=${anyObj.world.name ?? '?'}` : '无world',
          ]
            .filter(Boolean)
            .join(', ')
          logger.warn(`[Game]   └ ${info}`)
        }
      } else {
        logger.info('[Game] 对象泄漏诊断：无未回收对象')
      }
    }
  }

  /** 每帧更新（如未通过 onUpdate 自动驱动时手动调用） */
  update(dt: number) {
    this._instance?.tick(dt)
  }

  /** 销毁游戏实例 */
  destroy() {
    this.shutdown()
  }
}
