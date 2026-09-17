/**
 * TipsScript — 通用提示面板行为脚本
 *
 * 通过 UIScriptComponent 挂载到 tips.widget.json 的根节点：
 *  1. 显示提示图标、标题、消息内容
 *  2. 提供确定按钮关闭面板
 *  3. 支持不同类型提示（info、warning、error、success）
 *  4. 自动关闭功能（可选）
 *
 * 由其他脚本调用 showTips() 方法显示提示。
 */
import {
  BehaviourScript,
  UIButtonComponent,
  UITextComponent,
  UIScriptComponent,
  logger,
} from '@/engine'

/** 提示类型 */
export type TipsType = 'info' | 'warning' | 'error' | 'success'

/** 提示配置 */
interface TipsConfig {
  /** 提示类型 */
  type: TipsType
  /** 标题 */
  title: string
  /** 消息内容 */
  message: string
  /** 自动关闭时间（毫秒），0表示不自动关闭 */
  autoCloseMs?: number
}

/** 提示类型对应的图标和颜色 */
const TIPS_CONFIG: Record<TipsType, { icon: string; titleColor: string }> = {
  info: { icon: 'ℹ️', titleColor: '#90caf9' },
  warning: { icon: '⚠️', titleColor: '#ffd54f' },
  error: { icon: '❌', titleColor: '#f44336' },
  success: { icon: '✅', titleColor: '#4caf50' },
}

export default class TipsScript extends BehaviourScript {
  /** UI组件引用 */
  private iconText: UITextComponent | null = null
  private titleText: UITextComponent | null = null
  private messageText: UITextComponent | null = null
  private closeButton: UIButtonComponent | null = null

  /** 自动关闭定时器 */
  private autoCloseTimer: number | null = null

  /** 当前提示配置 */
  private currentConfig: TipsConfig | null = null

  /** 关闭回调 */
  private onClose: (() => void) | null = null

  override onStart(): void {
    // 获取UI组件引用
    this.iconText = this.findInChildren('IconText')?.getComponent(UITextComponent) ?? null
    this.titleText = this.findInChildren('TitleText')?.getComponent(UITextComponent) ?? null
    this.messageText = this.findInChildren('MessageText')?.getComponent(UITextComponent) ?? null
    
    // 关闭按钮
    const closeBtnActor = this.findInChildren('Btn_close')
    if (closeBtnActor) {
      this.closeButton = closeBtnActor.getComponent(UIButtonComponent)
      if (this.closeButton) {
        this.closeButton.onClick = () => this.close()
        logger.info('[TipsScript] 关闭按钮已绑定')
      }
    }
  }

  /**
   * 显示提示
   * @param config 提示配置
   * @param onClose 关闭回调
   */
  showTips(config: TipsConfig, onClose?: () => void): void {
    logger.info(`[TipsScript] showTips被调用: ${config.type} - ${config.title}`)
    this.currentConfig = config
    this.onClose = onClose ?? null

    const tipsConfig = TIPS_CONFIG[config.type]
    logger.info(`[TipsScript] 提示配置: icon=${tipsConfig.icon}, titleColor=${tipsConfig.titleColor}`)

    // 设置图标
    if (this.iconText) {
      this.iconText.text = tipsConfig.icon
      logger.info(`[TipsScript] 设置图标: ${tipsConfig.icon}`)
    } else {
      logger.warn('[TipsScript] iconText为空，无法设置图标')
    }

    // 设置标题
    if (this.titleText) {
      this.titleText.text = config.title
      this.titleText.color = tipsConfig.titleColor
      logger.info(`[TipsScript] 设置标题: ${config.title}`)
    } else {
      logger.warn('[TipsScript] titleText为空，无法设置标题')
    }

    // 设置消息
    if (this.messageText) {
      this.messageText.text = config.message
      logger.info(`[TipsScript] 设置消息: ${config.message}`)
    } else {
      logger.warn('[TipsScript] messageText为空，无法设置消息')
    }

    // 设置自动关闭
    if (config.autoCloseMs && config.autoCloseMs > 0) {
      this.setAutoClose(config.autoCloseMs)
      logger.info(`[TipsScript] 设置自动关闭: ${config.autoCloseMs}ms`)
    }

    logger.info(`[TipsScript] 显示提示完成: ${config.type} - ${config.title}`)
  }

  /**
   * 设置自动关闭
   * @param ms 毫秒数
   */
  private setAutoClose(ms: number): void {
    this.clearAutoClose()
    this.autoCloseTimer = window.setTimeout(() => {
      this.close()
    }, ms)
  }

  /** 清除自动关闭定时器 */
  private clearAutoClose(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer)
      this.autoCloseTimer = null
    }
  }

  /** 关闭面板 */
  private close(): void {
    this.clearAutoClose()
    this.onClose?.()
    this.actor.destroy()
    logger.info('[TipsScript] 关闭提示面板')
  }

  override onDestroy(): void {
    this.clearAutoClose()
    super.onDestroy()
  }

  // ════════════════════════════════════════════
  //  静态便捷方法（其他脚本调用）
  // ════════════════════════════════════════════

  /**
   * 显示信息提示
   * @param world World实例
   * @param title 标题
   * @param message 消息
   * @param autoCloseMs 自动关闭时间
   */
  static showInfo(
    world: import('@/engine').World,
    title: string,
    message: string,
    autoCloseMs = 0
  ): void {
    TipsScript.show(world, {
      type: 'info',
      title,
      message,
      autoCloseMs,
    })
  }

  /**
   * 显示警告提示
   * @param world World实例
   * @param title 标题
   * @param message 消息
   * @param autoCloseMs 自动关闭时间
   */
  static showWarning(
    world: import('@/engine').World,
    title: string,
    message: string,
    autoCloseMs = 0
  ): void {
    TipsScript.show(world, {
      type: 'warning',
      title,
      message,
      autoCloseMs,
    })
  }

  /**
   * 显示错误提示
   * @param world World实例
   * @param title 标题
   * @param message 消息
   * @param autoCloseMs 自动关闭时间
   */
  static showError(
    world: import('@/engine').World,
    title: string,
    message: string,
    autoCloseMs = 0
  ): void {
    TipsScript.show(world, {
      type: 'error',
      title,
      message,
      autoCloseMs,
    })
  }

  /**
   * 显示成功提示
   * @param world World实例
   * @param title 标题
   * @param message 消息
   * @param autoCloseMs 自动关闭时间
   */
  static showSuccess(
    world: import('@/engine').World,
    title: string,
    message: string,
    autoCloseMs = 2000
  ): void {
    TipsScript.show(world, {
      type: 'success',
      title,
      message,
      autoCloseMs,
    })
  }

  /**
   * 显示提示面板
   * @param world World实例
   * @param config 提示配置
   * @param onClose 关闭回调
   */
  static show(
    world: import('@/engine').World,
    config: TipsConfig,
    onClose?: () => void
  ): void {
    logger.info(`[TipsScript] 准备显示提示: ${config.type} - ${config.title}`)
    logger.info(`[TipsScript] 消息内容: ${config.message}`)
    
    const panel = world.ui.spawnUIActor('asset/blueprints/ui/tips.widget.json')
    if (!panel) {
      logger.error('[TipsScript] 提示面板生成失败')
      return
    }
    
    logger.info(`[TipsScript] 提示面板已生成: ${panel.root.name}`)

    const script = panel.getComponent(UIScriptComponent) as TipsScript | null
    if (script) {
      logger.info('[TipsScript] 找到TipsScript组件，调用showTips')
      script.showTips(config, onClose)
    } else {
      logger.error('[TipsScript] 未找到TipsScript组件')
      panel.destroy()
    }
  }
}