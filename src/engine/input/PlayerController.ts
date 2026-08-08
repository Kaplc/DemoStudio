/**
 * PlayerController — 处理玩家输入并控制 Pawn
 * 模仿 UE PlayerController（BaseObject，非场景对象）
 * 输入路由：Viewport → PlayerController.ProcessInput() → InputComponent → 回调
 */
import * as THREE from 'three'
import { BaseObject } from '../entity/BaseObject'
import { InputComponent } from './InputComponent'
import type { Pawn } from '../entity/Pawn'
import type { InputEventType } from './InputComponent'

export abstract class PlayerController extends BaseObject {
  public pawn: Pawn | null = null
  public inputComponent: InputComponent

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
