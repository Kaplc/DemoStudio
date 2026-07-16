/**
 * PlayerController — 处理玩家输入并控制 Pawn
 * 模仿 UE PlayerController（Actor）
 * 输入路由：Viewport → PlayerController.ProcessInput() → InputComponent → 回调
 */
import * as THREE from 'three'
import { Actor } from './Actor'
import { InputComponent } from './InputComponent'
import type { Pawn } from './Pawn'
import type { InputEventType } from './InputComponent'

export abstract class PlayerController extends Actor {
  public pawn: Pawn | null = null
  public inputComponent: InputComponent

  constructor() {
    super('PlayerController')
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

  // ─── 鼠标输入（2D 正交场景）默认空实现，子类按需 override ───
  /** 鼠标移动到世界坐标 world（每帧鼠标移动时调用） */
  OnPointerMove(_world: THREE.Vector3): void {}
  /** 鼠标按下（世界坐标） */
  OnPointerDown(_world: THREE.Vector3): void {}
  /** 鼠标抬起（世界坐标） */
  OnPointerUp(_world: THREE.Vector3): void {}
  /** 滚轮滚动（delta >0 向下滚，<0 向上滚） */
  OnScroll(_delta: number): void {}
}
