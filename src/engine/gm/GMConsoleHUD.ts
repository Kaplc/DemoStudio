/**
 * GMConsoleHUD — GM 控制台面板基类（引擎级通用 UI）
 *
 * 继承 HUD（isUIActor 天然成立）。面板有两种构建方式：
 *  1. 资产驱动（推荐）：子类设置 `panelAssetPath` 指向项目 GM 面板 widget 资产
 *     （通用节点，zOrder 写相对层级 0~3），基类 loadPanelFromAsset() 加载资产树
 *     挂到本根下（根 HUD 引用通用节点），统一加 GM_ZORDER_BASE 保证最顶层，并按
 *     组件 name 绑定输出区（GM_OutputText）与输入框（GM_InputText）。
 *  2. 程序化构建（兜底）：panelAssetPath 为空或资产缺失时，在 buildUI() 中拼装
 *     控件树（子类可覆写 buildUI 构建项目自己的风格面板）。
 *
 * 生命周期（开建闭毁）：GMModule.openConsole → 经 consoleFactory 创建
 * （默认 new GMConsoleHUD）→ world.SpawnActor → 进 UI 场景；closeConsole →
 * destroy() → UIManager 延迟销毁（无残留）。
 *
 * 键盘路由：GMModule.handleGlobalKeyDown 在控制台打开时把按键转交
 * handleInputKey() → 输入框 handleKey（Enter 提交执行、文本输入）；输出经 appendOutput。
 */
import { HUD } from '../ui/HUD'
import { GenericActor } from '../entity/GenericActor'
import type { Actor } from '../entity/Actor'
import { UITransformComponent, type AnchorPreset } from '../ui/UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { UIImageComponent } from '../ui/UIImageComponent'
import { UITextComponent } from '../ui/UITextComponent'
import { UITextInputComponent } from '../ui/UITextInputComponent'
import { UIButtonComponent } from '../ui/UIButtonComponent'
import { UIScrollListComponent } from '../ui/UIScrollListComponent'
import { GMRegistry } from './GMRegistry'
import { formatGMUsage } from './GMCommand'
import { logger } from '../Logger'
import type { GMModule } from './GMModule'

/** 输出区保留的最大行数（滚动窗口，超出丢最旧） */
export const MAX_OUTPUT_LINES = 12

/**
 * GM 面板 zOrder 基数（全局 renderOrder 起始值）。
 * 远高于 UIManager.FLOAT_LAYER_BIAS(100)：任何浮动面板（地图/结算/暂停等
 * 基值 100 + 内部层级）都盖不过 GM 面板 —— GM 控制台始终最顶层。
 */
export const GM_ZORDER_BASE = 1000
/** GM 面板内文本层相对基数偏移（高于面板图片 rel 0~2） */
export const GM_TEXT_LAYER = 3

export class GMConsoleHUD extends HUD {
  /** 所属 GM 模块（执行命令/关闭面板） */
  protected readonly _gm: GMModule

  /**
   * 面板 widget 资产路径（通用节点，推荐资产驱动）。
   * null = 用程序化 buildUI() 构建（引擎默认样式）；设置后基类从资产加载控件树
   * （资产 zOrder 写相对层级 0~3，加载后统一加 GM_ZORDER_BASE）。
   * 用 getter 而非实例字段：基类构造函数内读取时多态生效（子类字段在 super() 返回后才初始化）。
   */
  protected get panelAssetPath(): string | null {
    return null
  }

  /** 就绪提示消息（buildUI / loadPanelFromAsset 共用，子类可覆写 getter） */
  protected get readyMessage(): string {
    return 'GM 控制台已就绪（输入 help 查看全部命令）'
  }

  /** 输入框组件（聚焦/取值） */
  protected _input: UITextInputComponent | null = null
  /** 输出区文本组件（滚动窗口） */
  protected _outputText: UITextComponent | null = null
  /** 输出行缓冲 */
  protected _outputLines: string[] = []
  /** 命令按钮滚动列表（对象池，超框 item 不渲染） */
  protected _cmdList: UIScrollListComponent | null = null

  constructor(gm: GMModule) {
    super('GMConsoleHUD')
    this._gm = gm

    // ═══ 根组件：全屏变换 + 画布（zOrder 高，盖过项目 HUD） ═══
    // 根节点无父画布容器：省略 anchor（默认 null，非锚点模式用 position 定位）
    this.addComponent(new UITransformComponent(this, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      worldWidth: 9.6,
      worldHeight: 5.4,
      anchorOffset: [0, 0],
    }))
    this.addComponent(new CanvasUIComponent(this, {
      width: 1920,
      height: 1080,
      name: 'Canvas',
      zOrder: GM_ZORDER_BASE,
      active: true,
      // 拦截点击：全屏画布命中即消费，点击不穿透到后面的地图面板/游戏世界（仿 UE block）
      hitTest: 'block',
    }))

    // 控件树：优先资产驱动（项目自定义面板），缺失回退程序化 buildUI
    if (this.panelAssetPath) {
      if (!this.loadPanelFromAsset()) {
        logger.warn(`[GMConsoleHUD] 面板资产加载失败，回退程序化构建: ${this.panelAssetPath}`)
        this.buildUI()
      }
    } else {
      this.buildUI()
    }
  }

  /** 所属 GM 模块（子类访问：执行命令等） */
  protected get gm(): GMModule {
    return this._gm
  }

  /**
   * 拼装面板控件树（子类覆写入口）。
   * 默认实现：全屏遮罩 + 居中深色木纹面板 + 标题/命令列表/输出区/输入框/提示。
   * 子类覆写时用 protected 工具 makeActor/makeText 与 gm/input/output 访问器，
   * 保持 zOrder 基数（GM_ZORDER_BASE）与点击拦截（根画布已 block）。
   */
  protected buildUI(): void {
    // ═══ 控件子树（attachTo 挂载，随根节点进出 UI 场景） ═══
    // 遮罩：全屏半透明暖黑
    const dim = this.makeActor('GM_Dim', { anchor: 'center', w: 9.6, h: 5.4, zOrder: 0 })
    const dimImg = new UIImageComponent(dim, {
      color: 'rgba(12,6,2,0.55)',
      opacity: 0.55,
      width: 1920,
      height: 1080,
    })
    dimImg.zOrder = GM_ZORDER_BASE
    dim.addComponent(dimImg)
    dim.attachTo(this)

    // 面板外框（黄铜色，大一圈露边）
    const panelFrame = this.makeActor('GM_PanelFrame', { anchor: 'center', offset: [0, 0.1], w: 7.6, h: 4.2, zOrder: 1 })
    const frameImg = new UIImageComponent(panelFrame, {
      color: '#8a6a3a',
      radius: 18,
      width: 1520,
      height: 840,
    })
    frameImg.zOrder = GM_ZORDER_BASE + 1
    panelFrame.addComponent(frameImg)
    panelFrame.attachTo(this)

    // 面板内层（深木）
    const panel = this.makeActor('GM_Panel', { anchor: 'center', offset: [0, 0.1], w: 7.4, h: 4.0, zOrder: 1 })
    const panelImg = new UIImageComponent(panel, {
      color: '#2c1d10',
      radius: 12,
      width: 1480,
      height: 800,
    })
    panelImg.zOrder = GM_ZORDER_BASE + 1
    panel.addComponent(panelImg)
    panel.attachTo(this)

    // 标题
    const title = this.makeActor('GM_Title', { anchor: 'center', offset: [0, 1.9], w: 4, h: 0.45, zOrder: 2 })
    title.addComponent(this.makeText(title, '⚙ GM 控制台', 30, '#f0a500', 600, 70, 'GM_TitleText'))
    title.attachTo(this)

    // 命令列表（左上，help 全量）
    const help = this.makeActor('GM_Help', { anchor: 'center', offset: [-2.6, 0.4], w: 2.9, h: 2.4, zOrder: 2 })
    const helpText = this.makeText(help, this.buildHelpText(), 15, '#f5e6c8', 560, 460, 'GM_HelpText')
    help.addComponent(helpText)
    help.attachTo(this)

    // 输出区（右上，滚动窗口）
    const output = this.makeActor('GM_Output', { anchor: 'center', offset: [1.6, 0.4], w: 4.4, h: 2.4, zOrder: 2 })
    this._outputText = this.makeText(output, '', 15, '#a5d6a7', 860, 460, 'GM_OutputText')
    output.addComponent(this._outputText)
    output.attachTo(this)

    // 输入框（中下：背景 + UITextInputComponent）
    const inputBox = this.makeActor('GM_InputBox', { anchor: 'center', offset: [0, -1.0], w: 6.8, h: 0.5, zOrder: 2 })
    const inputBoxImg = new UIImageComponent(inputBox, {
      color: '#1a1108',
      radius: 8,
      width: 1360,
      height: 96,
    })
    inputBoxImg.zOrder = GM_ZORDER_BASE + 2
    inputBox.addComponent(inputBoxImg)
    this._input = new UITextInputComponent(inputBox, {
      placeholder: '输入 GM 命令（help 查看全部）...',
      fontSize: 22,
      color: '#f5e6c8',
      width: 1360,
      height: 96,
      zOrder: GM_ZORDER_BASE + GM_TEXT_LAYER,
      onSubmit: (line) => {
        // Enter 提交：执行命令 → 回显 → 清空输入
        this.submitInput()
      },
    })
    inputBox.addComponent(this._input)
    inputBox.attachTo(this)

    // 操作提示
    const hint = this.makeActor('GM_Hint', { anchor: 'center', offset: [0, -1.8], w: 6, h: 0.3, zOrder: 2 })
    hint.addComponent(this.makeText(hint, 'Enter 执行 · Esc 关闭 · G+M 开关面板', 14, '#8a7a5a', 900, 44, 'GM_HintText'))
    hint.attachTo(this)

    // 初始输出 + 聚焦输入框
    this.appendOutput(this.readyMessage)
    logger.info('[GMConsoleHUD] 控制台 UI 已拼装（输入框/输出区/命令列表）')
  }

  /**
   * 从 widget 资产加载面板控件树（资产驱动，子类设 panelAssetPath 后自动调用）。
   *
   * 流程：spawnUIActor(panelAssetPath) 生成通用节点树 → attachTo 本根（根 HUD 引用
   * 通用节点）→ 递归整树 zOrder 统一 + GM_ZORDER_BASE（资产只写相对层级 0~3；
   * 运行中 spawnUIActor 已 +FLOAT_LAYER_BIAS(100)，再加基数后 1100+ 仍保证最顶层，
   * 层内相对顺序不变）→ 按组件 name 绑定输出区（GM_OutputText）与输入框
   * （GM_InputText，并挂 Enter 提交回调）→ 输出就绪消息。
   *
   * @returns 成功 true；资产缺失/解析失败/缺少关键组件 → false（调用方回退 buildUI）
   */
  protected loadPanelFromAsset(): boolean {
    const world = this._gm.world
    if (!world) return false
    const actor = world.ui.spawnUIActor(this.panelAssetPath!)
    if (!actor) return false
    actor.attachTo(this)

    // 递归整树：zOrder 统一加基数（资产相对层级 0~3 → 1000+，保证最顶层）
    const lift = (a: Actor): void => {
      for (const comp of a.getComponents(CanvasUIComponent)) {
        comp.zOrder += GM_ZORDER_BASE
      }
      for (const child of a.getChildren()) lift(child)
    }
    lift(actor)

    // 按组件 name 绑定输出区与输入框（组件 name 由资产组件定义应用，见 UIManager.spawnUIActor）
    const bind = (a: Actor): void => {
      for (const comp of a.getComponents(UITextInputComponent)) {
        if (comp.name === 'GM_InputText' && !this._input) {
          this._input = comp
          comp.onSubmit = () => this.submitInput()
        }
      }
      for (const comp of a.getComponents(UITextComponent)) {
        if (comp.name === 'GM_OutputText' && !this._outputText) {
          this._outputText = comp
        }
      }
      for (const child of a.getChildren()) bind(child)
    }
    bind(actor)

    if (!this._outputText || !this._input) {
      logger.warn(`[GMConsoleHUD] 资产 ${this.panelAssetPath} 缺少 GM_OutputText/GM_InputText 组件，回退程序化构建`)
      return false
    }

    // 命令按钮：GM_CmdList 容器下为每个注册命令生成按钮（点击 → 快捷填入输入框）
    const cmdList = this.findActorByName(actor, 'GM_CmdList')
    if (cmdList) this.buildCommandButtons(cmdList)
    else logger.warn(`[GMConsoleHUD] 资产 ${this.panelAssetPath} 未找到 GM_CmdList 容器，跳过命令按钮`)

    // 发送按钮：GM_SendBtn 点击 → 提交输入框内容
    const sendBtn = this.findActorByName(actor, 'GM_SendBtn')
    const sendComp = sendBtn?.getComponent(UIButtonComponent)
    if (sendComp) sendComp.onClick = () => this.submitInput()
    else logger.warn(`[GMConsoleHUD] 资产 ${this.panelAssetPath} 未找到 GM_SendBtn 按钮，跳过发送按钮`)

    this.appendOutput(this.readyMessage)
    logger.info(`[GMConsoleHUD] 控制台 UI 已从资产加载: ${this.panelAssetPath}`)
    return true
  }

  /**
   * 按 name 递归查找资产树中的 Actor（用于定位命令容器/发送按钮等动态绑定点）。
   * ⚠️ 比较 `root.root.name`（Group 名）：spawnUIActor 只设置 actor.root.name，
   * Actor.name（BObject）始终是类名（如 'Actor'），不能用来定位资产节点。
   */
  private findActorByName(root: Actor, name: string): Actor | null {
    if (root.root.name === name) return root
    for (const child of root.getChildren()) {
      const r = this.findActorByName(child, name)
      if (r) return r
    }
    return null
  }

  /**
   * 提交输入框内容：执行命令 → 回显 → 清空 → 重新聚焦（Enter 与发送按钮共用）。
   */
  protected submitInput(): void {
    if (!this._input) return
    const line = this._input.value
    if (!line.trim()) return
    const result = this._gm.execute(line)
    this.appendOutput(`> ${line}`)
    if (result.message) this.appendOutput(result.message)
    this._input.clear()
    this._input.focus()
  }

  /**
   * 配置 GM_CmdList 命令按钮滚动列表（对象池，超框 item 不渲染）。
   * 资产树 GM_CmdList 挂 UIScrollListComponent（itemWidget=gm_cmd_item 蓝图，
   * visibleCount=5 可视 5 项 + 1 缓冲）；此处只驱动数据与行为：
   *  - zOrderLift = GM_ZORDER_BASE：item 经 spawnUIActor 已 +FLOAT_LAYER_BIAS(100)，
   *    再补 +1000 与资产树（1100+）同基数，避免被面板背景盖住
   *  - totalCount = 注册命令数（池只建 visibleCount+1 个 item，超出的命令滚动可见）
   *  - onItemSpawned：填命令名文本 + 绑定点击（命令名填入输入框）
   */
  protected buildCommandButtons(container: Actor): void {
    const cmds = [...GMRegistry.getAll()]
    const list = container.getComponent(UIScrollListComponent)
    if (!list) {
      logger.warn(`[GMConsoleHUD] 资产 ${this.panelAssetPath} 的 GM_CmdList 未挂 UIScrollListComponent，跳过命令按钮`)
      return
    }
    list.zOrderLift = GM_ZORDER_BASE
    list.totalCount = cmds.length
    list.onItemSpawned = (item, index) => {
      const def = cmds[index]?.[1]
      if (!def) return
      // 命令名文本
      const label = item.getComponent(UITextComponent)
      if (label) label.text = def.name
      // 点击 → 快捷输入：命令名填入输入框并聚焦（用户补参数后 Enter/发送执行）
      const button = item.getComponent(UIButtonComponent)
      if (button) {
        button.onClick = () => {
          if (this._input) {
            this._input.value = def.name
            this._input.focus()
          }
        }
      }
    }
    this._cmdList = list
    // onItemSpawned 赋值晚于 totalCount setter（后者已触发一次 _layout），
    // 需再 refresh 一次让初始可见 item 立即填充文本/绑定点击
    list.refresh()
    logger.info(`[GMConsoleHUD] 命令按钮滚动列表已配置: ${cmds.length} 个（GM_CmdList，可视 ${list.visibleCount} 项）`)
  }

  /**
   * 滚轮处理（GMModule.handleGlobalScroll 转发，面板打开时消费不穿透游戏）。
   * delta 约定与 InputSys 一致（正=拉远/向下滚）；命令列表：向下滚看后面的命令（offset 增加），
   * 向上滚看前面的（offset 减少）。越界由 UIScrollListComponent 内部钳制（offset 恒 ≥0 且 ≤ 末尾）。
   * @returns true = 已消费（滚轮不转发给游戏）
   */
  handleScroll(delta: number): boolean {
    if (!this._cmdList) return false
    this._cmdList.scrollBy(delta > 0 ? 1 : -1)
    return true
  }

  /** 创建通用 UI 控件 Actor（UITransform + markerOnly CanvasUI） */
  protected makeActor(
    name: string,
    tsf: { anchor: AnchorPreset; offset?: [number, number]; w: number; h: number; zOrder: number },
  ): GenericActor {
    const actor = new GenericActor(name)
    actor.addComponent(new UITransformComponent(actor, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      anchor: tsf.anchor,
      anchorOffset: tsf.offset ?? [0, 0],
      worldWidth: tsf.w,
      worldHeight: tsf.h,
    }))
    actor.addComponent(new CanvasUIComponent(actor, {
      markerOnly: true,
      name: 'UIMarker',
      zOrder: GM_ZORDER_BASE + tsf.zOrder,
    }))
    return actor
  }

  /** 创建文本组件 */
  protected makeText(
    owner: GenericActor,
    text: string,
    fontSize: number,
    color: string,
    width: number,
    height: number,
    name: string,
  ): UITextComponent {
    const comp = new UITextComponent(owner, {
      text,
      fontSize,
      color,
      bold: false,
      align: 'left',
      width,
      height,
      zOrder: GM_ZORDER_BASE + GM_TEXT_LAYER,
    })
    comp.name = name
    return comp
  }

  /** 拼装命令列表文本（全部命令 name + 参数用法 + 描述） */
  protected buildHelpText(): string {
    const lines: string[] = ['命令列表:']
    for (const [, def] of GMRegistry.getAll()) {
      lines.push(`${formatGMUsage(def)}`)
      lines.push(`  ${def.description}`)
    }
    return lines.join('\n')
  }

  /** 追加输出行（滚动窗口，超限丢最旧） */
  appendOutput(text: string): void {
    if (!this._outputText) return
    this._outputLines.push(text)
    if (this._outputLines.length > MAX_OUTPUT_LINES) {
      this._outputLines = this._outputLines.slice(-MAX_OUTPUT_LINES)
    }
    this._outputText.text = this._outputLines.join('\n')
  }

  /** 输出行快照（调试断言用：Playwright 经项目调试桥读取） */
  getOutputLines(): string[] {
    return [...this._outputLines]
  }

  /**
   * 渲染层级快照（调试断言用）：根 + 子控件的全部 CanvasUIComponent name/zOrder。
   * 验证「GM 面板始终最顶层」：所有 zOrder 应 ≥ GM_ZORDER_BASE。
   */
  getLayerSummary(): Array<{ name: string; zOrder: number }> {
    const out: Array<{ name: string; zOrder: number }> = []
    const collect = (actor: Actor) => {
      for (const c of actor.getComponents(CanvasUIComponent)) {
        out.push({ name: actor.name, zOrder: c.zOrder })
      }
      for (const child of actor.getChildren()) collect(child)
    }
    collect(this)
    return out
  }

  /** 清空输出区（clear 内置命令调用） */
  clearOutput(): void {
    this._outputLines = []
    if (this._outputText) this._outputText.text = ''
  }

  /**
   * 输入框键盘转交（GMModule.handleGlobalKeyDown 调用）。
   * 返回 true = 按键被消费（Enter 已提交时输入框重新聚焦保持输入态）。
   */
  handleInputKey(key: string): boolean {
    if (!this._input) return true // 子类未建输入框（纯展示面板）：按键仍消费不穿透
    if (!this._input.focused) this._input.focus()
    this._input.handleKey(key)
    return true
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 面板就绪：聚焦输入框（隐藏输入穿透）
    this._input?.focus()
    logger.info('[GMConsoleHUD] BeginPlay：输入框已聚焦')
  }

  override EndPlay(): void {
    // 先通知 GMModule 清引用（场景切换连带销毁时避免悬空），再递归销毁控件树
    this._gm.notifyConsoleDestroyed()
    logger.info('[GMConsoleHUD] EndPlay：控制台 UI 已销毁')
    super.EndPlay()
  }
}
