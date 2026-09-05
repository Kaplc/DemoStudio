/**
 * UITextInputComponent — 文本输入控件 Component（引擎级，GM 控制台等复用）
 *
 * 引擎此前无文本输入框组件（UIText 家族只有 UITextComponent 静态文本），
 * 本组件补上可编辑单行文本输入能力：
 *   - 键盘字符输入 / Backspace 退格 / Enter 提交 / Escape 失焦
 *   - 光标（'|' 后缀渲染）+ 失焦闪烁省略
 *   - 焦点管理：focus()/blur()；聚焦时宿主（GM 控制台）应暂停游戏输入转发
 *
 * 渲染：内部持有 UITextComponent 显示「文本 + 光标」，背景由宿主面板的
 * UIImageComponent 提供（与 UIText 同风格：尺寸权威在 uitransform）。
 *
 * 键盘路由：组件不直接监听全局键盘（引擎键盘事件走 InputSys → Controller 管线），
 * 由使用方（GMConsoleHUD/GMModule）在控制台打开时把按键转交 handleKey(key)。
 *
 * 用法：
 *   const input = new UITextInputComponent(actor, { placeholder: '输入命令...' })
 *   actor.addComponent(input)
 *   input.focus()
 *   input.handleKey('a') / input.handleKey('Backspace') / input.handleKey('Enter')
 */
import { UITextComponent } from './UITextComponent'
import { logger } from '../Logger'
import type { EditableProperty } from '../entity/ActorComponent'
import type { Actor } from '../entity/Actor'
import * as THREE from 'three'
import { Text as TroikaText, getSelectionRects, getCaretAtPoint } from 'troika-three-text'

export interface UITextInputComponentOptions {
  /** 占位提示（value 为空且未聚焦时显示，灰色） */
  placeholder?: string
  /** 初始文本 */
  value?: string
  /** 字体大小（px，默认 22） */
  fontSize?: number
  /** 文本颜色（默认羊皮纸色 #f5e6c8） */
  color?: string
  /** 占位符颜色（默认灰色） */
  placeholderColor?: string
  /** canvas 像素宽（默认 1024，作为 fontSize 映射基准） */
  width?: number
  /** canvas 像素高（默认 96） */
  height?: number
  /** UI 层级（越大越靠前，默认 0；透传 UITextComponent） */
  zOrder?: number
  /** 提交回调（Enter 触发，参数为当前文本） */
  onSubmit?: (value: string) => void
  /** 文本变化回调（输入字符/退格/清空/程序赋值时触发，用于实时过滤等） */
  onTextChanged?: (value: string) => void
}

export class UITextInputComponent extends UITextComponent {
  /** 当前输入文本 */
  private _value = ''
  /** 占位提示 */
  private _placeholder: string
  /** 占位符颜色 */
  private readonly _placeholderColor: string
  /** 正常文本颜色 */
  private readonly _textColor: string
  /** 是否聚焦（聚焦显示光标） */
  private _focused = false
  /** 选择起点（0 = 文本最前），无选择时等于 _cursorPos */
  private _selectionStart = 0
  /** 光标位置 / 选择终点（0 = 文本最前） */
  private _cursorPos = 0
  /** 选择方向：'forward' 光标在前，'backward' 光标在后 */
  private _selectionDirection: 'forward' | 'backward' = 'forward'
  /** 选中区高亮背景 mesh（PlaneGeometry + MeshBasicMaterial，透明） */
  private _selectionMesh: THREE.Mesh | null = null
  /** 提交回调 */
  private _onSubmit: ((value: string) => void) | null
  /** 文本变化回调 */
  private _onTextChanged: ((value: string) => void) | null

  constructor(owner: Actor, options: UITextInputComponentOptions = {}) {
    const fontSize = options.fontSize ?? 22
    const color = options.color ?? '#f5e6c8'
    super(owner, {
      text: '',
      fontSize,
      color,
      align: 'left',
      // 输入框单行文本必须左对齐：textAlign 对单行无效，单行整体按 anchorX 放置
      // （anchorX=center 时短文本从元素中心开始输入）
      anchorX: 'left',
      width: options.width ?? 1024,
      height: options.height ?? 96,
      bold: true,
      ...(options.zOrder !== undefined ? { zOrder: options.zOrder } : {}),
    })
    this.name = 'UITextInputComponent'
    this._value = options.value ?? ''
    this._placeholder = options.placeholder ?? ''
    this._placeholderColor = options.placeholderColor ?? '#8a7a5a'
    this._textColor = color
    this._onSubmit = options.onSubmit ?? null
    this._onTextChanged = options.onTextChanged ?? null
    this.refreshText()
    // 延迟一帧确保 UITextComponent.initTroika() 已完成（troika mesh 构造后 sync 才有效）
    setTimeout(() => this.initSelectionMesh(), 0)
    logger.info('[UITextInputComponent] 创建文本输入控件')
  }

  /** 当前输入值 */
  get value(): string {
    return this._value
  }

  set value(v: string) {
    this._value = v
    // 程序赋值时重置光标到最后（用户可在输入框内直接编辑）
    this._selectionStart = v.length
    this._cursorPos = v.length
    this.refreshText()
    this._onTextChanged?.(this._value)
  }

  /** 占位提示（value 为空且未聚焦时显示） */
  get placeholder(): string {
    return this._placeholder
  }

  set placeholder(v: string) {
    this._placeholder = v
    this.refreshText()
  }

  /** 是否聚焦 */
  get focused(): boolean {
    return this._focused
  }

  /** 提交回调（Enter 触发） */
  get onSubmit(): ((value: string) => void) | null {
    return this._onSubmit
  }

  set onSubmit(fn: ((value: string) => void) | null) {
    this._onSubmit = fn
  }

  /** 文本变化回调（输入字符/退格/清空/程序赋值时触发） */
  get onTextChanged(): ((value: string) => void) | null {
    return this._onTextChanged
  }

  set onTextChanged(fn: ((value: string) => void) | null) {
    this._onTextChanged = fn
  }

  /** 聚焦：显示光标，进入输入态（光标到末尾，无选择） */
  focus(): void {
    if (this._focused) return
    this._focused = true
    this._selectionStart = this._value.length
    this._cursorPos = this._value.length
    this.refreshText()
    logger.info('[UITextInputComponent] 聚焦输入框')
  }

  /** 失焦：隐藏光标（value 为空时显示占位符，清除选择区） */
  blur(): void {
    if (!this._focused) return
    this._focused = false
    this._selectionStart = 0
    this._cursorPos = 0
    this.refreshText()
    logger.info('[UITextInputComponent] 输入框失焦')
  }

  /** 清空输入（清除选择区） */
  clear(): void {
    this._value = ''
    this._selectionStart = 0
    this._cursorPos = 0
    this.refreshText()
    this._onTextChanged?.(this._value)
  }

  /**
   * 粘贴文本（GMConsoleHUD paste 事件兜底调用；绕过 Ctrl+V 劫持）。
   * 等价于逐字符 handleKey('a')... 但效率更高。
   */
  handlePasteText(text: string): void {
    if (!text) return
    const clean = text.replace(/[\r\n]/g, '')
    const [from, to] = this._getSelectionBounds()
    this._value = this._value.slice(0, from) + clean + this._value.slice(to)
    this._cursorPos = from + clean.length
    this._selectionStart = this._cursorPos
    this.refreshText()
    this._onTextChanged?.(this._value)
  }

  /**
   * 根据点击的世界坐标 X 设置光标/选择位置。
   * 使用 troika getCaretAtPoint 精确定位（支持变宽字体），并映射回原始 value 索引
   * （渲染文本在 _cursorPos 处插入了 '|' 光标符，其后字符索引 +1）。
   * @param clickWorldX  命中点的世界坐标 X（来自 ClickableComponent.onMouseDown hit.point.x）
   * @param textWorldX   未使用（保留接口兼容）
   * @param charWidth    未使用（保留接口兼容）
   */
  setCursorFromClick(clickWorldX: number, textWorldX: number, charWidth: number): void {
    const troika = (this as unknown as { mesh: TroikaText }).mesh
    if (!troika?.textRenderInfo) return
    // 世界坐标 → owner.root 本地坐标 → troika 本地坐标
    const worldPt = new THREE.Vector3(clickWorldX, 0, 0)
    const rootLocal = this.owner.root.worldToLocal(worldPt)
    const localX = rootLocal.x - troika.position.x
    // troika getCaretAtPoint 返回最近 caret 索引（渲染文本含 '|' 光标符）
    const caret = getCaretAtPoint(troika.textRenderInfo, localX, 0)
    if (!caret) return
    let renderedIdx = caret.charIndex
    // getCaretAtPoint 返回字符左边缘的 caret；点击落在字符右半侧时应取下一个位置
    const caretX = troika.textRenderInfo.caretPositions[renderedIdx * 4]
    if (localX > caretX + 1e-6) renderedIdx++
    // 渲染文本索引 → 原始 value 索引（跳过 '|' 光标符）
    const c = this._cursorPos
    const valueIdx = renderedIdx > c ? renderedIdx - 1 : renderedIdx
    this._cursorPos = Math.max(0, Math.min(this._value.length, valueIdx))
    this._selectionStart = this._cursorPos
    this.refreshText()
  }

  /**
   * 键盘输入处理（由使用方从 InputSys 转交）。
   * @param key InputSys 传来的键名（如 'a'、'Backspace'、'Enter'、'Escape'）
   * @returns true = 按键被消费（宿主不应再转发给游戏）
   */
  handleKey(key: string): boolean {
    // 提交：Enter → onSubmit（不清空，由宿主决定）
    if (key === 'Enter') {
      logger.info(`[UITextInputComponent] 提交输入: "${this._value}"`)
      this._onSubmit?.(this._value)
      return true
    }
    // 失焦：Escape 由宿主处理关闭面板，这里仅标记不消费
    if (key === 'Escape') {
      return false
    }
    // 退格：删除选中区域；有选择时先删选择（跨光标位置互换 _selectionStart/_cursorPos 的方向键历史），无选择时删光标前 1 字符
    if (key === 'Backspace') {
      if (this._selectionStart !== this._cursorPos) {
        this._deleteSelection()
      } else if (this._cursorPos > 0) {
        const pos = this._cursorPos
        this._value = this._value.slice(0, pos - 1) + this._value.slice(pos)
        this._cursorPos = pos - 1
        this._selectionStart = this._cursorPos
      }
      this.refreshText()
      this._onTextChanged?.(this._value)
      return true
    }
    // 删除：Delete 删光标后 1 字符（有选择时先删选择）
    if (key === 'Delete') {
      if (this._selectionStart !== this._cursorPos) {
        this._deleteSelection()
      } else if (this._cursorPos < this._value.length) {
        const pos = this._cursorPos
        this._value = this._value.slice(0, pos) + this._value.slice(pos + 1)
      }
      this.refreshText()
      this._onTextChanged?.(this._value)
      return true
    }
    // 左方向键（带或不带 Shift 修饰）
    // Shift 框选模型：锚点（_selectionStart）固定，光标（_cursorPos）随按键移动 ——
    // 光标远离锚点则扩张选择，靠近锚点则收缩，与标准文本框行为一致
    if (key === 'ArrowLeft' || key === 'Shift+ArrowLeft') {
      const pos = this._cursorPos > 0 ? this._cursorPos - 1 : 0
      if (key === 'Shift+ArrowLeft') {
        this._cursorPos = pos
        this._selectionDirection = this._selectionStart > pos ? 'backward' : 'forward'
      } else {
        this._selectionStart = pos
        this._cursorPos = pos
      }
      this.refreshText()
      return true
    }
    // 右方向键（带或不带 Shift 修饰，同上锄点固定/光标移动模型）
    if (key === 'ArrowRight' || key === 'Shift+ArrowRight') {
      const pos = this._cursorPos < this._value.length ? this._cursorPos + 1 : this._value.length
      if (key === 'Shift+ArrowRight') {
        this._cursorPos = pos
        this._selectionDirection = this._selectionStart < pos ? 'forward' : 'backward'
      } else {
        this._selectionStart = pos
        this._cursorPos = pos
      }
      this.refreshText()
      return true
    }
    // 可打印字符：插入（替换选中区域）+ 光标移到插入后
    if (key.length === 1) {
      this._insertAtCursor(key)
      this.refreshText()
      this._onTextChanged?.(this._value)
      return true
    }
    // Ctrl+A 全选
    if (key === 'Ctrl+a') {
      this._selectionStart = 0
      this._cursorPos = this._value.length
      this.refreshText()
      return true
    }
    // Ctrl+C 复制（复制选中文本到剪贴板）
    if (key === 'Ctrl+c') {
      this._copySelection()
      return true
    }
    // Ctrl+X 剪切（复制 + 删除选中）
    if (key === 'Ctrl+x') {
      this._copySelection()
      if (this._selectionStart !== this._cursorPos) {
        this._deleteSelection()
        this.refreshText()
        this._onTextChanged?.(this._value)
      }
      return true
    }
    // Ctrl+V 粘贴（从剪贴板读文本，替换选中区域）
    if (key === 'Ctrl+v') {
      this._pasteFromClipboard()
      return true
    }
    // Home：跳到行首
    if (key === 'Home') {
      this._selectionStart = 0
      this._cursorPos = 0
      this.refreshText()
      return true
    }
    // End：跳到行尾
    if (key === 'End') {
      this._selectionStart = this._value.length
      this._cursorPos = this._value.length
      this.refreshText()
      return true
    }
    // Ctrl+Home：选中到行首
    if (key === 'Ctrl+Home') {
      this._selectionStart = 0
      this._cursorPos = 0
      this.refreshText()
      return true
    }
    // Ctrl+End：选中到行尾
    if (key === 'Ctrl+End') {
      this._selectionStart = this._value.length
      this._cursorPos = this._value.length
      this.refreshText()
      return true
    }
    // 其他功能键不消费（宿主可忽略）
    return false
  }

  /** 删除选中区域（selectionStart ≠ cursorPos），清除选择区后光标位于删除起点 */
  private _deleteSelection(): void {
    const [from, to] = this._getSelectionBounds()
    this._value = this._value.slice(0, from) + this._value.slice(to)
    this._cursorPos = from
    this._selectionStart = from
  }

  /** 在光标位置插入文本（替换选中区域） */
  private _insertAtCursor(char: string): void {
    const [from, to] = this._getSelectionBounds()
    this._value = this._value.slice(0, from) + char + this._value.slice(to)
    this._cursorPos = from + char.length
    this._selectionStart = this._cursorPos
  }

  /** 取选中区间 [min, max]（始终 left ≤ right） */
  private _getSelectionBounds(): [number, number] {
    return this._selectionStart < this._cursorPos
      ? [this._selectionStart, this._cursorPos]
      : [this._cursorPos, this._selectionStart]
  }

  /** 复制选中文本到剪贴板（无选中时复制空） */
  private async _copySelection(): Promise<void> {
    const [from, to] = this._getSelectionBounds()
    const text = this._value.slice(from, to)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  /** 从剪贴板粘贴文本（替换选中区域） */
  private async _pasteFromClipboard(): Promise<void> {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      // 剪贴板不可用时静默失败
      return
    }
    if (!text) return
    // 替换选中区域（粘贴纯文本，剔除换行符）
    text = text.replace(/[\r\n]/g, '')
    const [from, to] = this._getSelectionBounds()
    this._value = this._value.slice(0, from) + text + this._value.slice(to)
    this._cursorPos = from + text.length
    this._selectionStart = this._cursorPos
    this.refreshText()
    this._onTextChanged?.(this._value)
  }

  /**
   * 刷新显示文本（值 + 光标 / 占位符 / 选中区高亮）。
   *
   * 选中区用透明 mesh 叠加渲染（troika getSelectionRects 精确包围盒），
   * 不依赖多色文本 API。选中区在 refreshText 时同步更新。
   */
  private refreshText(): void {
    if (this._focused) {
      // 光标 '|' 插入到 _cursorPos 位置（非末尾），使左右方向键时光标视觉跟随
      this.text = this._value.slice(0, this._cursorPos) + '|' + this._value.slice(this._cursorPos)
      this.color = this._textColor
      this.updateSelectionMesh()
    } else if (this._value) {
      this.text = this._value
      this.color = this._textColor
      this.hideSelectionMesh()
    } else {
      this.text = this._placeholder
      this.color = this._placeholderColor
      this.hideSelectionMesh()
    }
  }

  /**
   * Inspector 属性展示：只放输入框自身语义字段。zOrder/fontSize/color 是输入框自己的
   * 有效样式（可编辑面与此一致）；父类 UIText 的静态文本专属行（text/fontFamily/bold/
   * italic/align/lineHeight/letterSpacing/render*）是 UIText 的属性——输入框渲染由
   * value/placeholder 驱动，与可编辑层的 blocked 过滤同一取舍，不显示。
   */
  override getProperties(): Record<string, unknown> {
    return {
      zOrder: this.zOrder,
      fontSize: this.fontSize,
      color: this.color,
      Value: this._value,
      Focused: this._focused,
    }
  }

  /**
   * Inspector 可编辑属性：只暴露输入框语义字段（placeholder/value/fontSize/color/zOrder）。
   *
   * 继承 UITextComponent 会带入静态文本专属属性（text/align/bold/italic/lineHeight/
   * letterSpacing）与基类 hitTest——输入框渲染由 value/placeholder 驱动，这些字段
   * 对输入框无意义且引擎注册器不消费，必须过滤（否则保存资产时会被持久化污染，
   * assetLint 报未知属性）。
   */
  override getEditableProperties(): EditableProperty[] {
    const blocked = new Set(['text', 'align', 'bold', 'italic', 'lineHeight', 'letterSpacing', 'hitTest'])
    const base = super.getEditableProperties().filter((p) => !blocked.has(p.key))
    return [
      ...base, // fontSize/color/zOrder
      {
        key: 'placeholder', type: 'string',
        get: () => this._placeholder,
        set: (v) => { this.placeholder = v as string },
      },
      {
        key: 'value', type: 'string',
        get: () => this._value,
        set: (v) => { this.value = v as string },
      },
    ]
  }

  /**
   * 持久化属性：只输出输入框语义字段（placeholder/value/fontSize/color/zOrder/width/height）。
   *
   * 覆写 UITextComponent.getPersistentProps：不输出静态文本专属字段
   * （text/align/bold/italic/lineHeight/letterSpacing）与 fontSizeScale（注册器不消费），
   * 避免保存资产时污染输入框 properties。
   */
  override getPersistentProps(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const p of this.getEditableProperties()) {
      out[p.key] = p.get()
    }
    out.width = this.getSize()[0]
    out.height = this.getSize()[1]
    return out
  }

  override EndPlay(): void {
    this.disposeSelectionMesh()
    super.EndPlay()
  }

  /** 初始化选中区高亮 mesh（在 UITextComponent.initTroika 之后调用） */
  private initSelectionMesh(): void {
    if (this._selectionMesh) return
    const troika = (this as unknown as { mesh: TroikaText }).mesh
    if (!troika) return
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = this.zOrder + 0.0001
    mesh.visible = false
    mesh.name = 'SelectionHighlight'
    this.owner.root.add(mesh)
    this._selectionMesh = mesh
  }

  /**
   * 更新选中区高亮 mesh（troika 精确 caret 坐标，非估算）。
   *
   * 字形布局是异步的（troika sync）：refreshText 设新 text 后 textRenderInfo
   * 仍是旧布局，直接读会错位。因此统一在 sync 回调里应用矩形，且回调内重新
   * 读取当前选区（快速连按时避免过期闭包画旧选区）。
   */
  private updateSelectionMesh(): void {
    const mesh = this._selectionMesh
    if (!mesh) return
    const troika = (this as unknown as { mesh: TroikaText }).mesh
    if (!troika) return
    // 双保险：立即尝试一次（布局已就绪时零延迟生效，如选区变化但文本未变 ——
    // troika sync 幂等跳过重排，回调可能要等 rAF），再在 sync 回调里重试
    // （文本变化触发重排后 textRenderInfo 才更新，回调时机才是新布局）。
    // applySelectionRect 读的是回调执行瞬间的最新选区，快速连按不会画旧选区。
    this.applySelectionRect()
    troika.sync(() => this.applySelectionRect())
  }

  /**
   * 按最新字形布局应用选中区矩形（updateSelectionMesh 的 sync 回调）。
   *
   * 坐标系换算：getSelectionRects 返回 troika mesh 本地坐标（已含 anchorX/
   * anchorY 偏移），叠加 troika.position（anchorX='left' 时 x=-ww/2）得到
   * owner.root 本地坐标 —— selectionMesh 与 troika mesh 同挂在 owner.root 下。
   * 渲染文本 = value + 光标符（拼在末尾，不影响选中字符的 caret 索引）。
   */
  private applySelectionRect(): void {
    const mesh = this._selectionMesh
    if (!mesh) return
    const selStart = Math.min(this._selectionStart, this._cursorPos)
    const selEnd = Math.max(this._selectionStart, this._cursorPos)
    if (selStart === selEnd || !this._focused) {
      mesh.visible = false
      return
    }
    const troika = (this as unknown as { mesh: TroikaText }).mesh
    if (!troika) {
      mesh.visible = false
      return
    }
    // 渲染文本 = value[0..cursorPos] + '|' + value[cursorPos..end]，
    // 光标 '|' 占一个字符位，其后的 value 字符索引 +1。
    // 传给 getSelectionRects 的索引要对应渲染文本，非原始 value。
    const c = this._cursorPos
    const renderedStart = selStart + (selStart >= c ? 1 : 0)
    const renderedEnd = selEnd + (selEnd >= c ? 1 : 0)
    const rects = getSelectionRects(troika.textRenderInfo, renderedStart, renderedEnd)
    if (!rects || rects.length === 0) {
      // 布局未就绪（首次渲染）保持隐藏，下一次 sync 回调会补上
      mesh.visible = false
      return
    }
    // 水平：选区 rect 精确左右边缘（troika 本地坐标 + position → owner.root 本地）
    let left = Infinity, right = -Infinity
    for (const r of rects) {
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    }
    left += troika.position.x
    right += troika.position.x
    // 垂直：用 visibleBounds（字形实际渲染包围盒），而非 caret 高度（基于字体
    // 度量 ascender-descender，会漏掉超出度量的字形如 '1' 底部）。
    // 单行文本所有字形在同一基线，visibleBounds 的 Y 范围对任意选区子集一致。
    const vis = troika.textRenderInfo?.visibleBounds
    const top = (vis ? vis[3] : 0) + troika.position.y
    const bottom = (vis ? vis[1] : 0) + troika.position.y
    const w = right - left
    const h = top - bottom
    if (w <= 0 || h <= 0) {
      mesh.visible = false
      return
    }
    ;(mesh.geometry as THREE.PlaneGeometry).dispose()
    mesh.geometry = new THREE.PlaneGeometry(w, h)
    mesh.position.set((left + right) / 2, (top + bottom) / 2, 0.001)
    mesh.visible = true
  }

  /** 隐藏选中区 mesh */
  private hideSelectionMesh(): void {
    if (this._selectionMesh) this._selectionMesh.visible = false
  }

  /** 销毁选中区 mesh */
  private disposeSelectionMesh(): void {
    if (!this._selectionMesh) return
    this._selectionMesh.geometry?.dispose()
    ;(this._selectionMesh.material as THREE.Material).dispose()
    this.owner.root.remove(this._selectionMesh)
    this._selectionMesh = null
  }
}
