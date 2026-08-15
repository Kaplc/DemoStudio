/**
 * GMModule — GM 命令执行模块（挂载到 GameInstance 基类的实例级模块）
 *
 * 职责：
 *  - execute(line)：解析「命令名 参数...」→ 校验 → 类型转换 → 调 handler（同步）
 *  - enabled 开关（默认 true）：gm.enable / gm.disable 内置命令切换；
 *    gmOnly 命令在开关关闭时被拒
 *  - 游戏内控制台面板（GMConsoleHUD）：G+M 打开 / Esc 关闭（开建闭毁）
 *  - 全局键盘钩子（InputSys 层转发）：面板打开时输入框聚焦 → 键盘不穿透游戏
 *
 * 命令来源：GMRegistry（静态注册表），项目 register.ts 用 import.meta.glob
 * 自动注册 `*.gm.ts` 文件。execute 按调用名 name 查找命令。
 *
 * 用法（命令 handler 内）：
 *   const inst = ctx.gameInstance as FishGameInstance
 *   inst.resources.add('coins', amount)
 *   ctx.output(`金币 +${amount}`)
 */
import { GMRegistry } from './GMRegistry'
import { convertGMArg, formatGMUsage, type GMCommandArg, type GMCommandContext } from './GMCommand'
import { GMConsoleHUD } from './GMConsoleHUD'
import { logger } from '../Logger'
// 值导入（运行时访问 GameInstance.current 静态属性）；循环依赖经 ESM live binding 安全
// （GMModule 仅在方法体运行时访问，模块顶层不求值）
import { GameInstance } from '../gameflow/GameInstance'
import type { World } from '../gameflow/World'

/** 执行结果（面板回显 / AI 桥接回传统一结构） */
export interface GMExecuteResult {
  ok: boolean
  message: string
}

/** 控制台面板工厂：项目可注入自定义 GMConsoleHUD 子类（项目风格面板） */
export type GMConsoleFactory = (gm: GMModule) => GMConsoleHUD

export class GMModule {
  /** 所属游戏实例（实际为项目子类实例，命令经此访问项目能力） */
  private readonly _instance: GameInstance

  /** 控制台面板工厂（默认引擎 GMConsoleHUD；项目 register.ts 注入自定义子类） */
  private static _consoleFactory: GMConsoleFactory | null = null

  /** 注入自定义控制台面板工厂（项目 register.ts 调用；null 恢复引擎默认面板） */
  static setConsoleFactory(factory: GMConsoleFactory | null): void {
    GMModule._consoleFactory = factory
    logger.info(`[GM] 控制台面板工厂已${factory ? '注入' : '重置为默认'}`)
  }

  /** 当前控制台面板工厂（未注入返回 null，openConsole 用引擎默认 GMConsoleHUD） */
  static get consoleFactory(): GMConsoleFactory | null {
    return GMModule._consoleFactory
  }

  /** GM 开关（默认开；gm.disable 关闭后 gmOnly 命令被拒） */
  private _enabled = true

  /** 控制台面板（null = 未打开；开建闭毁） */
  private _console: GMConsoleHUD | null = null

  /** 组合键状态：G 是否按住（G+M 打开控制台） */
  private static _gKeyDown = false

  constructor(instance: GameInstance) {
    this._instance = instance
    logger.info('[GM] GMModule 已创建（enabled=true，G+M 打开控制台）')
  }

  // ═══════════════════════════════════════
  //  GM 开关
  // ═══════════════════════════════════════

  /** GM 模式是否开启 */
  get enabled(): boolean {
    return this._enabled
  }

  set enabled(v: boolean) {
    if (this._enabled === v) return
    this._enabled = v
    logger.info(`[GM] GM 模式${v ? '开启' : '关闭'}`)
  }

  // ═══════════════════════════════════════
  //  所属 World（duck-typed：项目子类持有 world 字段，如 FishGameInstance.world）
  // ═══════════════════════════════════════

  get world(): World | null {
    return (this._instance as unknown as { world?: World }).world ?? null
  }

  // ═══════════════════════════════════════
  //  命令执行
  // ═══════════════════════════════════════

  /**
   * 执行一行 GM 命令（控制台 Enter / AI 桥接统一入口）。
   * 流程：拆词 → 查命令 → gmOnly 校验 → 参数转换校验 → handler(ctx, ...args) → 捕获异常。
   * @param line 命令行（如 'addCoins 100'；空行返回提示）
   * @param out  输出通道（默认控制台回显；AI 桥接传回调收 message）
   * @returns 执行结果 { ok, message }
   */
  execute(line: string, out?: (text: string) => void): GMExecuteResult {
    const trimmed = line.trim()
    if (!trimmed) {
      return { ok: false, message: '空命令（输入 help 查看全部命令）' }
    }
    const [name, ...rawArgs] = trimmed.split(/\s+/)

    const def = GMRegistry.findByName(name)
    if (!def) {
      const msg = `未知命令: ${name}（输入 help 查看全部命令）`
      logger.warn(`[GM] ${msg}`)
      out?.(msg)
      return { ok: false, message: msg }
    }

    // GM 开关校验（仅 gmOnly 命令）
    if (def.gmOnly === true && !this._enabled) {
      const msg = `GM 模式未开启: ${name}（输入 gm.enable 开启）`
      logger.warn(`[GM] ${msg}`)
      out?.(msg)
      return { ok: false, message: msg }
    }

    // 参数转换与校验
    const params = def.params ?? []
    const args: GMCommandArg[] = []
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      const raw = rawArgs[i]
      if (raw === undefined || raw === '') {
        // 缺参：有默认值 → 用默认；required 缺省 true → 报错
        if (p.required !== false && p.default === undefined) {
          const msg = `参数不足: ${formatGMUsage(def)}（${p.name}: ${p.desc ?? p.type}）`
          logger.warn(`[GM] ${msg}`)
          out?.(msg)
          return { ok: false, message: msg }
        }
        if (p.default !== undefined) {
          args.push(p.default)
          continue
        }
        // required=false 且无默认值 → 跳过（后续参数取默认）
        break
      }
      const converted = convertGMArg(raw, p.type)
      if (converted === null) {
        const msg = `参数类型错误: ${p.name} 应为 ${p.type}（收到 "${raw}"）；用法 ${formatGMUsage(def)}`
        logger.warn(`[GM] ${msg}`)
        out?.(msg)
        return { ok: false, message: msg }
      }
      args.push(converted)
    }

    // handler 执行（捕获异常，不影响其他命令）
    const ctx: GMCommandContext = {
      gameInstance: this._instance,
      output: (text) => {
        out?.(text)
        this._console?.appendOutput(text)
      },
      logger,
    }
    try {
      logger.info(`[GM] 执行命令: ${name} ${rawArgs.join(' ')}`)
      def.handler(ctx, ...args)
      return { ok: true, message: `已执行: ${name}` }
    } catch (err) {
      const msg = `命令执行异常: ${name}（${(err as Error)?.message ?? String(err)}）`
      logger.error(`[GM] ${msg}`)
      out?.(msg)
      return { ok: false, message: msg }
    }
  }

  // ═══════════════════════════════════════
  //  控制台面板（G+M 开 / Esc 关，开建闭毁）
  // ═══════════════════════════════════════

  /** 控制台是否打开 */
  get consoleOpen(): boolean {
    return this._console !== null
  }

  /** 打开控制台面板（幂等） */
  openConsole(): void {
    if (this._console) return
    const world = this.world
    if (!world) {
      logger.warn('[GM] 打开控制台失败：游戏未运行（无 world）')
      return
    }
    // 项目可注入自定义面板（GMConsoleHUD 子类，见 GMModule.setConsoleFactory）；
    // 未注入时用引擎默认 GMConsoleHUD。
    const factory = GMModule.consoleFactory
    const console = factory ? factory(this) : new GMConsoleHUD(this)
    world.SpawnActor(console)
    // 挂到当前 HUD 下：UI 大纲层级归位（HUD → GMConsoleHUD），
    // 并随场景切换与 HUD 一同回收（无 HUD 时保持独立顶层，如纯菜单阶段）
    const hud = world.ui.hud
    if (hud) {
      console.attachTo(hud)
      logger.info('[GM] 控制台已挂到当前 HUD 下')
    }
    this._console = console
    logger.info(`[GM] 控制台面板已打开（${console.constructor.name}，G+M/Esc 关闭，Enter 执行）`)
  }

  /** 关闭控制台面板（销毁 UI，无残留） */
  closeConsole(): void {
    if (!this._console) return
    // 若控制台已被外部销毁（如场景切换连带 HUD 回收），仅清引用
    if (this._console.bPendingDestroy) {
      this._console = null
      return
    }
    this._console.destroy()
    this._console = null
    logger.info('[GM] 控制台面板已关闭')
  }

  /** 切换控制台开关 */
  toggleConsole(): void {
    if (this._console) this.closeConsole()
    else this.openConsole()
  }

  /** 清空控制台输出区（clear 内置命令调用） */
  clearConsoleOutput(): void {
    this._console?.clearOutput()
  }

  /**
   * 控制台被外部销毁的回调（GMConsoleHUD.EndPlay 调用，如场景切换连带 HUD 回收）。
   * 仅清引用，不重复销毁。
   */
  notifyConsoleDestroyed(): void {
    if (this._console) {
      logger.info('[GM] 控制台面板已被外部销毁（如场景切换），引用已清空')
      this._console = null
    }
  }

  /** 控制台输出行快照（调试断言用；面板未打开时为空数组） */
  getConsoleOutputLines(): string[] {
    return this._console?.getOutputLines() ?? []
  }

  /** 控制台渲染层级快照（调试断言用；面板未打开时为空数组） */
  getConsoleLayers(): Array<{ name: string; zOrder: number }> {
    return this._console?.getLayerSummary() ?? []
  }

  // ═══════════════════════════════════════
  //  全局键盘钩子（由 InputSys 转发；仅游戏运行中生效）
  // ═══════════════════════════════════════

  /**
   * 键盘按下钩子（InputSys.handleKeyDown 入口调用）。
   * 优先级：
   *  1. 控制台打开 → 输入框聚焦，全部按键转交输入框（Enter 执行 / 文本输入），
   *     返回 true 消费（游戏不收到输入）；Esc → 关闭控制台并消费
   *  2. 控制台未打开 → 检测 G+M 组合键（G 按住时按 M 打开），单键不消费
   * @returns true = 按键已被 GM 消费（InputSys 不应再转发给游戏）
   */
  static handleGlobalKeyDown(key: string): boolean {
    const inst = GameInstance.current
    if (!inst || !(inst as unknown as { gm?: GMModule }).gm) return false
    const gm = (inst as unknown as { gm: GMModule }).gm

    // ─── 1. 控制台已打开：输入态，键盘不穿透游戏 ───
    if (gm._console) {
      if (key === 'Escape') {
        gm.closeConsole()
        return true
      }
      // 组合键修饰键不进入输入框（Shift 单按等）
      if (key === 'Shift' || key === 'Control' || key === 'Alt') return true
      return gm._console.handleInputKey(key)
    }

    // ─── 2. G+M 组合键打开控制台 ───
    if (key === 'g' || key === 'G') {
      GMModule._gKeyDown = true
      return false // 不消费，游戏单键 G 功能不受影响
    }
    if ((key === 'm' || key === 'M') && GMModule._gKeyDown) {
      GMModule._gKeyDown = false
      gm.openConsole()
      return true // 消费 M 键（组合触发）
    }
    return false
  }

  /** 键盘释放钩子（跟踪 G 键释放，防止组合键状态残留） */
  static handleGlobalKeyUp(key: string): void {
    if (key === 'g' || key === 'G') {
      GMModule._gKeyDown = false
    }
  }

  /**
   * 全局滚轮钩子（InputSys.handleScroll 入口调用）。
   * 控制台打开时滚轮转交面板（命令按钮列表滚动），返回 true 消费（游戏不收到滚轮）；
   * 控制台关闭 → false（滚轮照常转发给游戏控制器）。
   */
  static handleGlobalScroll(delta: number): boolean {
    const inst = GameInstance.current
    if (!inst || !(inst as unknown as { gm?: GMModule }).gm) return false
    const gm = (inst as unknown as { gm: GMModule }).gm
    if (!gm._console) return false
    return gm._console.handleScroll(delta)
  }

  /** 生命周期清理：关闭控制台 + 重置开关（GameInstance.teardown 调用） */
  dispose(): void {
    this.closeConsole()
    GMModule._gKeyDown = false
    logger.info('[GM] GMModule 已清理（控制台关闭、开关复位）')
  }
}
