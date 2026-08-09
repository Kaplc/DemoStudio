/**
 * InputComponent — 输入处理组件
 * 仿 UE InputComponent，支持按键绑定到动作（Action）
 * 挂载到 PlayerController（BObject，非场景对象）上
 */
import { BObjectComponent } from '../entity/BObjectComponent'
import { logger } from '..'
import type { BObject } from '../entity/BObject'

export type InputEventType = 'pressed' | 'released'

interface Binding {
  action?: string
  key: string
  eventType: InputEventType
  callback: () => void
}

/** 滚轮事件回调（delta >0 向下滚，<0 向上滚） */
export type ScrollCallback = (delta: number) => void

/** 鼠标按钮事件回调（button: 0=左键, 2=右键） */
export type MouseButtonCallback = (button: number, eventType: InputEventType) => void

/** 指针移动事件回调（client 坐标） */
export type PointerMoveCallback = (screenX: number, screenY: number) => void

export class InputComponent extends BObjectComponent<BObject> {
  private bindings: Binding[] = []
  /** 滚轮事件订阅者（外部组件可绑定监听，如摄像机云台缩放） */
  private scrollListeners: ScrollCallback[] = []
  /** 鼠标按钮事件订阅者（如摄像机云台右键平移） */
  private mouseButtonListeners: MouseButtonCallback[] = []
  /** 指针移动事件订阅者（如摄像机云台右键拖拽平移） */
  private pointerMoveListeners: PointerMoveCallback[] = []

  constructor(owner: BObject, name = 'InputComponent') {
    super(owner)
    this.name = name
  }

  BindAction(action: string, key: string, eventType: InputEventType, callback: () => void): void {
    this.bindings.push({ key, eventType, callback, action })
  }

  /**
   * 订阅滚轮事件（输入系统 handleScroll → ProcessScroll 触发）。
   * 返回取消订阅函数。
   */
  BindScroll(callback: ScrollCallback): () => void {
    this.scrollListeners.push(callback)
    return () => {
      this.scrollListeners = this.scrollListeners.filter((cb) => cb !== callback)
    }
  }

  /**
   * 订阅鼠标按钮事件（输入系统 handlePointerDown/Up → ProcessMouseButton 触发，携带 button 与 pressed/released）。
   * 返回取消订阅函数。
   */
  BindMouseButton(callback: MouseButtonCallback): () => void {
    this.mouseButtonListeners.push(callback)
    return () => {
      this.mouseButtonListeners = this.mouseButtonListeners.filter((cb) => cb !== callback)
    }
  }

  /**
   * 订阅指针移动事件（输入系统 handlePointerMove → ProcessPointerMove 触发，携带 client 坐标）。
   * 返回取消订阅函数。
   */
  BindPointerMove(callback: PointerMoveCallback): () => void {
    this.pointerMoveListeners.push(callback)
    return () => {
      this.pointerMoveListeners = this.pointerMoveListeners.filter((cb) => cb !== callback)
    }
  }

  /** 触发滚轮事件（由 InputSys.handleScroll 调用） */
  ProcessScroll(delta: number): void {
    if (!this.bEnabled) return
    for (const cb of this.scrollListeners) {
      cb(delta)
    }
  }

  /** 触发鼠标按钮事件（由 InputSys.handlePointerDown/Up 调用） */
  ProcessMouseButton(button: number, eventType: InputEventType): void {
    if (!this.bEnabled) return
    for (const cb of this.mouseButtonListeners) {
      cb(button, eventType)
    }
  }

  /** 触发指针移动事件（由 InputSys.handlePointerMove 调用） */
  ProcessPointerMove(screenX: number, screenY: number): void {
    if (!this.bEnabled) return
    for (const cb of this.pointerMoveListeners) {
      cb(screenX, screenY)
    }
  }

  UnbindKey(key: string): void {
    this.bindings = this.bindings.filter((b) => b.key !== key)
  }

  ProcessInput(key: string, eventType: InputEventType): boolean {
    if (!this.bEnabled) {
      logger.info(`InputComponent.ProcessInput: DISABLED (bEnabled=false) key=${key}`)
      return false
    }
    let handled = false
    for (const binding of this.bindings) {
      if (binding.key === key && binding.eventType === eventType) {
        logger.info(`InputComponent.ProcessInput: MATCH key=${key} callback=${binding.action || '?'}`)
        binding.callback()
        handled = true
      }
    }
    if (!handled) {
      logger.info(`InputComponent.ProcessInput: NO MATCH key=${key} bindings=[${this.bindings.map(b => `${b.key}:${b.eventType}`).join(', ')}]`)
    }
    return handled
  }

  ClearBindings(): void {
    this.bindings = []
    this.scrollListeners = []
    this.mouseButtonListeners = []
    this.pointerMoveListeners = []
  }

  override EndPlay(): void {
    this.ClearBindings()
    super.EndPlay()
  }
}
