/**
 * PlayerController — 处理玩家输入并控制 Pawn
 * 模仿 UE PlayerController（BObject，非场景对象）
 * 输入路由：Viewport → PlayerController.ProcessInput() → InputComponent → 回调
 * HUD 职责（对齐 UE）：持有 HUD 引用（MyHUD 对位）并发起创建/替换（ClientSetHUD）；
 * 由 GameMode.SpawnPlayer 在 controller 诞生时签发 HUDClass（对齐 UE InitializeHUDForPlayer）
 */
import * as THREE from 'three'
import { BObject } from '../entity/BObject'
import { InputComponent } from './InputComponent'
import type { Pawn } from '../entity/Pawn'
import type { HUD } from '../ui/HUD'
import type { World } from '../gameflow/World'
import type { InputEventType } from './InputComponent'

export abstract class PlayerController extends BObject {
  public pawn: Pawn | null = null
  public inputComponent: InputComponent

  /** 所属世界（由 GameMode.SpawnPlayer 注入；PC 非场景对象，自行持有。ClientSetHUD/EndPlay 经此触达 UIManager） */
  public world: World | null = null

  /** 当前 HUD（对位 UE APlayerController.MyHUD，仅引用；生成体仍是 UIManager.createHUD） */
  public hud: HUD | null = null

  constructor(name = 'PlayerController') {
    super(name)
    this.inputComponent = new InputComponent(this, 'PlayerInput')
    this.addComponent(this.inputComponent)
  }

  Possess(pawn: Pawn) {
    if (this.pawn) this.Unpossess()
    this.pawn = pawn
    pawn.PossessedBy(this)
    this.OnPossess(pawn)
  }

  Unpossess() {
    if (this.pawn) {
      this.pawn.Unpossessed()
      this.OnUnpossess(this.pawn)
      this.pawn = null
    }
  }

  protected OnPossess(_pawn: Pawn): void {}

  protected OnUnpossess(_pawn: Pawn): void {
    this.inputComponent.ClearBindings()
  }

  // ═══════════════════════════════════
  //  HUD（对齐 UE APlayerController.ClientSetHUD）
  // ═══════════════════════════════════

  /**
   * 签发 HUD（同构 UE ClientSetHUD_Implementation 三分支）：
   * 1. 已持有 HUD 且蓝图路径相同 → 复用不动（对齐 UE MyHUD->GetClass() == NewHUDClass）
   * 2. 已持有 HUD → 销毁重建（类不同）或仅清除（传入空路径，对齐 UE 传空类=清除）
   * 3. 有路径且无 HUD → 经 UIManager.createHUD 创建（对齐 UE SpawnActor Owner=PC）
   * HUDClass 未声明时调用为静默无操作（GameMode.SpawnPlayer 无条件调用本方法）。
   */
  ClientSetHUD(hudClass?: string): void {
    if (!this.world) return
    // 分支 1：类相同 → 复用
    if (this.hud && hudClass && this.hud.blueprintPath === hudClass) return
    // 分支 2：已有 HUD → 销毁（统一走 UIManager.destroyHUD：幂等 + 清 _hud 槽位）
    if (this.hud) {
      this.world.ui.destroyHUD()
      this.hud = null
    }
    // 分支 3：有类 → 创建并登记
    if (hudClass) {
      this.hud = this.world.ui.createHUD(hudClass)
    }
  }

  /** HUD 随 PC 销毁（对齐 UE APlayerController::Destroyed → MyHUD->Destroy()） */
  override EndPlay(): void {
    if (this.world) {
      this.world.ui.destroyHUD()
    }
    this.hud = null
    super.EndPlay()
  }

  ProcessInput(key: string, eventType: InputEventType): boolean {
    if (!this.pawn) return false
    return this.inputComponent.ProcessInput(key, eventType)
  }

  // ─── 鼠标输入（世界坐标）默认空实现，子类按需 override ───
  /** 鼠标移动到世界坐标 world（每帧鼠标移动时调用） */
  OnPointerMove(_world: THREE.Vector3): void {}
  /** 鼠标按下（世界坐标） */
  OnPointerDown(_world: THREE.Vector3): void {}
  /** 鼠标抬起（世界坐标） */
  OnPointerUp(_world: THREE.Vector3): void {}
  /** 滚轮滚动（delta >0 向下滚，<0 向上滚） */
  OnScroll(_delta: number): void {}

  // ═══════════════════════════════════
  //  屏幕坐标输入（由 InputSys.handlePointerDown/Move 转发）
  // ═══════════════════════════════════

  /**
   * 初始化物理系统（阶段切换时由 GameInstance 调用）。
   * 由 GameInstance 在切换阶段时直接调用 phySys.setup()。
   */
  initRaycaster(camera: THREE.Camera, uiEl: HTMLElement): void {}

  /** 鼠标按下（屏幕坐标），子类可 override 做额外处理 */
  OnPointerDownScreen(_screenX: number, _screenY: number): void {}
  /** 鼠标移动（屏幕坐标），子类可 override 做额外处理 */
  OnPointerMoveScreen(_screenX: number, _screenY: number): void {}
}
