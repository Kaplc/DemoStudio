/**
 * ArenaGameInstance — 竞技场游戏实例
 *
 * 驱动契约与 Demo2D 同构（manualTick 外部驱动 + syncCamera 委托）。
 * 附加 window.__arena 调试桥（对齐 fish 的 __fishBattle）：
 * e2e/AI 用它做确定性断言与状态注入（stepTicks 固定步推进，规避实时等待）。
 */
import * as THREE from 'three'
import { GameInstance, logger, AssetRegistry } from '@/engine'
import type { PlayerController } from '@/engine'
import { ArenaGameMode } from './ArenaGameMode'
import { ArenaPlayerController } from './ArenaPlayerController'
import type { ArenaPlayerPawn } from './ArenaPlayerPawn'

export class ArenaGameInstance extends GameInstance {
  private _gameMode!: ArenaGameMode
  override get gameMode(): ArenaGameMode {
    return this._gameMode
  }
  override createGameMode(): ArenaGameMode {
    return (this._gameMode = new ArenaGameMode())
  }

  private _controller: ArenaPlayerController | null = null

  override get controller(): ArenaPlayerController | null {
    return this._controller
  }

  /**
   * 玩家 Pawn（GM 命令/调试桥用）。
   * 权威引用在 GameMode.OnPawnSpawned（SpawnPawn 队列提交时）装配——
   * 不读 ctrl.pawn：onControllerReady 时点队列尚未提交，恒为 null。
   */
  get pawn(): ArenaPlayerPawn | null {
    return this._gameMode?.player ?? null
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as ArenaPlayerController
  }

  override onStart(_ctrl: PlayerController): boolean {
    // 加载房间场景（静态几何/碰撞体/触发器/出生点；gravity 也随场景应用）。
    // 必须在 world.BeginPlay 之前 spawn（挂 pending 队列），BeginPlay 统一提交
    // 时物理已激活（Game.launch 先 begin 再 start），碰撞体正常注册 body。
    const scene = AssetRegistry.getScene('ArenaRoom1')
    if (!scene) {
      logger.error('[Arena] 场景 ArenaRoom1 未注册（registerAssets 未执行？）')
      return false
    }
    this.world.loadSceneAsActors(scene)
    this.world.BeginPlay()
    this._installDebugBridge()
    logger.info('[Arena] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return this.gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[Arena] 停止游戏...')
    delete (window as unknown as { __arena?: unknown }).__arena
    this.world.DestroyAllActors()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }

  /** e2e/AI 调试桥：确定性断言 + 状态注入（stepTicks 固定步推进） */
  private _installDebugBridge(): void {
    const gm = () => this.gameMode
    ;(window as unknown as { __arena: unknown }).__arena = {
      /** 全量状态快照（e2e 断言主入口） */
      state: () => {
        const mode = gm()
        return {
          running: this.world.running,
          phase: mode.gameState.phase,
          playerHp: mode.player?.health.hp ?? 0,
          playerMaxHp: mode.player?.health.maxHp ?? 0,
          playerPos: mode.player
            ? [mode.player.root.position.x, mode.player.root.position.y, mode.player.root.position.z]
            : null,
          slimesAlive: mode.aliveSlimes.length,
          slimesTotal: mode.kills + mode.aliveSlimes.length,
          kills: mode.kills,
          roomCleared: mode.roomCleared,
          doorOpened: mode.doorOpened,
          doorY: this.world.findActorByName('Door')?.root.position.y ?? null,
          timeScale: this.world.timeScale,
          slimePos: mode.aliveSlimes.map((s) => {
            const p = s.root.position
            return { name: s.name, x: p.x, z: p.z }
          }),
        }
      },
      /** 固定步推进 n 帧（dt=1/60，combat/FSM/物理确定性走帧；逐帧解除 hitstop，
       *  避免同步批处理内真实时间冻结卡死逻辑——hitstop 面向的是实时 rAF 消费） */
      stepTicks: (n: number) => {
        for (let i = 0; i < n; i++) {
          this.world.clearHitstop()
          this.world.manualTick(1 / 60)
        }
        return true
      },
      /** 玩家瞬移（e2e 定位到敌人/触发器旁；dynamic body 是位置权威，必须同步写） */
      teleport: (x: number, z: number) => {
        const p = gm().player
        if (!p) return false
        const body = p.collider.body
        if (body) {
          body.wakeUp()
          body.position.x = x
          body.position.z = z
          body.velocity.x = 0
          body.velocity.z = 0
        }
        p.setPosition(x, p.root.position.y, z)
        return true
      },
      /** 玩家发起攻击（等价按 J） */
      attack: () => gm().player?.combat.attack() ?? false,
      /** 玩家攻击阶段快照（连招窗口断言） */
      combat: () => {
        const c = gm().player?.combat
        return c ? { phase: c.phase, stage: c.stage } : null
      },
      /** 全灭史莱姆（GM 通道等价实现） */
      killAll: () => {
        for (const s of gm().aliveSlimes) s.health.damage(9999, null)
        return true
      },
      /** 治疗玩家 */
      heal: (n: number) => gm().player?.health.heal(n) ?? 0,
      /** 玩家受击（来源位置取第一只存活史莱姆） */
      hurtPlayer: (n: number) => {
        const p = gm().player
        if (!p) return false
        const src = gm().aliveSlimes[0] ?? null
        p.health.damage(n, src)
        return true
      },
      /** 门体状态 */
      door: () => {
        const d = this.world.findActorByName('Door')
        return d ? { y: d.root.position.y } : null
      },
    }
    logger.info('[Arena] __arena 调试桥已安装')
  }
}
