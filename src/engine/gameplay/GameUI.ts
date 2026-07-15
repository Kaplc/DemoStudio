/**
 * GameUI — 游戏 UI 覆盖层
 * 支持 React 组件渲染以及传统 DOM 元素两种方式
 */
import { createRoot, type Root } from 'react-dom/client'
import type { Root as ReactRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

// ─── 保留旧 DOM API 类型导出（向后兼容） ───
export interface CreateTextOptions {
  text?: string
  x?: number
  y?: number
  fontSize?: number
  color?: string
  fontFamily?: string
  className?: string
  extraCss?: string
}

export interface CreateOverlayOptions {
  alpha?: number
  className?: string
  extraCss?: string
  animation?: string
  animDuration?: number
}

export interface GameUIElement {
  readonly el: HTMLElement
  setText(text: string): void
  setPosition(x: number, y: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export interface GameUIOverlay extends GameUIElement {
  readonly el: HTMLDivElement
  createText(options?: CreateTextOptions): GameUIElement
}

export class GameUI {
  /** DOM 覆盖层容器 */
  readonly el: HTMLDivElement

  /** UI 逻辑尺寸 */
  width: number
  height: number

  private elements: GameUIElement[] = []
  private reactRoot: ReactRoot | null = null
  private static _animInjected = false

  constructor(width = 480, height = 360) {
    this.width = width
    this.height = height

    this.el = document.createElement('div')
    this.el.className = 'gameui-root'
    this.el.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 100;
    `

    if (!GameUI._animInjected) {
      GameUI._animInjected = true
      const style = document.createElement('style')
      style.textContent = `
        @keyframes gui-fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes gui-scaleIn { from{opacity:0;transform:scale(0.7)} to{opacity:1;transform:scale(1)} }
        @keyframes gui-slideUp  { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes gui-pulse {
          0%,100% { opacity:1; transform:scale(1) }
          50%     { opacity:0.8; transform:scale(1.04) }
        }
        @keyframes gui-fadeInBg { from{opacity:0} to{opacity:1} }
      `
      document.head.appendChild(style)
    }
  }

  // ════════════════════════════════════════════
  //  React 渲染
  // ════════════════════════════════════════════

  /** 渲染 React 组件到游戏覆盖层（每帧调用 React 会自动 diff，开销极低） */
  renderReact(element: ReactElement | null) {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.el)
    }
    this.reactRoot.render(element)
  }

  // ════════════════════════════════════════════
  //  旧 DOM API（向后兼容）
  // ════════════════════════════════════════════

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  createOverlay(options: CreateOverlayOptions = {}): GameUIOverlay {
    const self = this
    const {
      alpha = 0.55,
      className = '',
      extraCss = '',
      animation = 'fadeIn',
      animDuration = 400,
    } = options

    const div = document.createElement('div')
    div.className = `gui-overlay ${className}`
    div.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,${alpha});
      animation: gui-${animation} ${animDuration}ms ease-out forwards;
      pointer-events: auto;
      ${extraCss}
    `
    this.el.appendChild(div)

    const element: GameUIOverlay = {
      el: div,
      setText() {},
      setPosition() {},
      setVisible(v: boolean) { div.style.display = v ? '' : 'none' },
      createText(opts: CreateTextOptions = {}): GameUIElement {
        const child = document.createElement('span')
        child.textContent = opts.text ?? ''
        child.style.cssText = `
          font-size: ${opts.fontSize ?? 28}px;
          color: ${opts.color ?? '#ffffff'};
          font-family: ${opts.fontFamily ?? 'monospace'};
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
          ${opts.className ? `class: ${opts.className};` : ''}
          ${opts.extraCss ?? ''}
        `
        div.appendChild(child)
        const el: GameUIElement = {
          el: child,
          setText(t: string) { child.textContent = t },
          setPosition() {},
          setVisible(v: boolean) { child.style.display = v ? '' : 'none' },
          dispose() { child.remove() },
        }
        self.elements.push(el)
        return el
      },
      dispose() {
        div.remove()
      },
    }

    this.elements.push(element)
    return element
  }

  createText(options: CreateTextOptions = {}): GameUIElement {
    const {
      text = '',
      x = 0,
      y = 0,
      fontSize = 28,
      color = '#ffffff',
      fontFamily = 'monospace',
      className = '',
      extraCss = '',
    } = options

    const span = document.createElement('span')
    span.textContent = text
    if (className) span.className = className
    span.style.cssText = `
      position: absolute;
      left: calc(50% + ${x}px);
      top: calc(50% - ${y}px);
      transform: translate(-50%, -50%);
      font-size: ${fontSize}px;
      color: ${color};
      font-family: ${fontFamily};
      white-space: nowrap;
      user-select: none;
      pointer-events: none;
      text-shadow: 0 2px 8px rgba(0,0,0,0.6);
      ${extraCss}
    `
    this.el.appendChild(span)

    const element: GameUIElement = {
      el: span,
      setText(t: string) { span.textContent = t },
      setPosition(px: number, py: number) {
        span.style.left = `calc(50% + ${px}px)`
        span.style.top = `calc(50% - ${py}px)`
      },
      setVisible(v: boolean) {
        span.style.display = v ? '' : 'none'
      },
      dispose() { span.remove() },
    }

    this.elements.push(element)
    return element
  }

  /**
   * 清空覆盖层内容（停止游戏时调用）。
   * 注意：这里 **不卸载** React root，只渲染空内容。
   * 原因：在同一个 DOM 容器上 unmount() 后立即 createRoot() 再 render()，
   * React 18 会因容器残留的内部标记而无法提交新 root 的渲染，
   * 导致重启后 HUD（如积分面板）消失。保留持久 root，下次 start() 直接复用即可。
   */
  clearElements() {
    // 清理旧 DOM 元素（遗留 API）
    for (const el of this.elements) {
      el.dispose()
    }
    this.elements = []

    // 保留 React root，仅渲染空内容以清空可见 UI
    if (this.reactRoot) {
      this.reactRoot.render(null)
    } else {
      this.el.innerHTML = ''
    }
  }

  /** 销毁（彻底卸载 React root，仅在销毁整个 GameUI 时调用） */
  dispose() {
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = null
    }
    for (const el of this.elements) {
      el.dispose()
    }
    this.elements = []
    this.el.remove()
  }
}
