/**
 * World — 核心世界管理
 * 模仿 UE World，管理 Actor 注册、生命周期、Tick 循环
 */
import * as THREE from 'three'
import { Actor } from './Actor'
import { GameMode } from './GameMode'
import type { Pawn } from './Pawn'
import type { PlayerController } from './PlayerController'

export class World {
  public readonly scene: THREE.Scene
  public gameMode: GameMode | null = null

  private allActors = new Set<Actor>()
  private pendingSpawn: Actor[] = []
  private pendingDestroy: Actor[] = []
  private animationId: number | null = null
  private lastTime = 0
  private _running = false
  private _tickCallbacks: Array<(dt: number) => void> = []

  constructor(scene: THREE.Scene, gameMode?: GameMode) {
    this.scene = scene
    if (gameMode) {
      this.SetGameMode(gameMode)
    }
  }

  // ═══════════════════════════════════
  //  GameMode
  // ═══════════════════════════════════

  SetGameMode(gm: GameMode) {
    // GameMode 是 Actor，手动设置 world 引用但不加入 allActors（由 World 显式管理其生命周期）
    gm.world = this
    this.gameMode = gm
    gm.InitGame()
    gm.StartPlay()
    if (this._running) {
      gm.BeginPlay()
      if (gm.gameState) gm.gameState.BeginPlay()
    }
  }

  get gameState() {
    return this.gameMode?.gameState ?? null
  }

  // ═══════════════════════════════════
  //  Actor 管理
  // ═══════════════════════════════════

  SpawnActor<T extends Actor>(actor: T): T {
    actor.world = this
    this.pendingSpawn.push(actor)
    return actor
  }

  private commitSpawn() {
    for (const actor of this.pendingSpawn) {
      this.allActors.add(actor)
      this.scene.add(actor.root)
      if (this._running) {
        actor.BeginPlay()
      }
    }
    this.pendingSpawn = []
  }

  DestroyActor(actor: Actor) {
    if (actor.bPendingDestroy && !this.allActors.has(actor)) return
    actor.bPendingDestroy = true
    this.pendingDestroy.push(actor)
  }

  private commitDestroy() {
    for (const actor of this.pendingDestroy) {
      if (this.allActors.has(actor)) {
        actor.EndPlay()
        this.scene.remove(actor.root)
        this.allActors.delete(actor)
      }
    }
    this.pendingDestroy = []
  }

  FindActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const actor of this.allActors) {
      if (actor instanceof type) return actor
    }
    for (const actor of this.pendingSpawn) {
      if (actor instanceof type) return actor
    }
    return null
  }

  FindActors<T extends Actor>(type: new (...args: any[]) => T): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      if (actor instanceof type) result.push(actor)
    }
    return result
  }

  GetAllActors(): Actor[] {
    return [...this.allActors]
  }

  SpawnPlayer(
    controller: PlayerController,
    pawn: Pawn,
  ) {
    this.SpawnActor(pawn)
    controller.Possess(pawn)
    return { controller, pawn }
  }

  // ═══════════════════════════════════
  //  Tick 循环
  // ═══════════════════════════════════

  get running() { return this._running }

  Start() {
    if (this._running) return
    this._running = true
    this.lastTime = performance.now()

    // 为所有已生成的 Actor 调用 BeginPlay
    for (const actor of this.allActors) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }

    const animate = (time: number) => {
      if (!this._running) return
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.tick(dt)

      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  Stop() {
    this._running = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  private tick(dt: number) {
    // 1. 处理待生成/销毁
    this.commitSpawn()
    this.commitDestroy()

    // 2. Tick 所有 Actor
    for (const actor of this.allActors) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }

    // 3. Tick GameMode + GameState
    this.gameMode?.Tick(dt)
    this.gameMode?.gameState?.Tick(dt)

    // 4. 更新摄像机
    this.gameMode?.cameraManager.UpdateCamera()

    // 5. 外部回调
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /** 标记运行但不启动自己的 rAF（由外部驱动 render/update 时使用） */
  BeginPlay() {
    this._running = true
    for (const actor of this.allActors) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }
    // 非 allActors 的 Actor（GameMode/GameState）
    if (this.gameMode && !this.gameMode.bHasBegunPlay) this.gameMode.BeginPlay()
    if (this.gameMode?.gameState && !this.gameMode.gameState.bHasBegunPlay) this.gameMode.gameState.BeginPlay()
  }

  /** 暂停运行（外部驱动模式） */
  Pause() {
    this._running = false
  }

  /** 销毁所有 Actor（立即执行，不等待 tick） */
  DestroyAllActors() {
    for (const actor of [...this.allActors]) {
      actor.EndPlay()
      this.scene.remove(actor.root)
    }
    this.allActors.clear()
    this.pendingSpawn = []
    this.pendingDestroy = []
  }

  /** 手动触发一次 Tick（由外部渲染循环驱动） */
  manualTick(dt: number) {
    if (!this._running) return
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this.allActors) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }
    // GameMode 的 Tick（包含其 Component 的 Tick）
    this.gameMode?.Tick(dt)
    // GameState 的 Tick
    this.gameMode?.gameState?.Tick(dt)
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /** 注册外部 Tick 回调 */
  onTick(cb: (dt: number) => void): () => void {
    this._tickCallbacks.push(cb)
    return () => {
      this._tickCallbacks = this._tickCallbacks.filter((c) => c !== cb)
    }
  }

  // ═══════════════════════════════════
  //  清理
  // ═══════════════════════════════════

  Destroy() {
    this.Stop()
    // 清理 GameMode/GameState
    this.gameMode?.gameState?.EndPlay()
    this.gameMode?.EndPlay()
    // 从后往前销毁所有 Actor
    const all = [...this.allActors]
    for (let i = all.length - 1; i >= 0; i--) {
      all[i].EndPlay()
      this.scene.remove(all[i].root)
    }
    this.allActors.clear()
    this.pendingSpawn = []
    this.pendingDestroy = []
    this._tickCallbacks = []
    this.gameMode = null
  }
}
