/**
 * GemShopScript — 宝石商店行为脚本
 *
 * 通过 UIScriptComponent 挂载到 gem_shop.widget.json 的根节点：
 *  1. 显示当前宝石余额
 *  2. 提供两个购买选项：
 *     - 购买金币：用宝石购买金币（1000金币 = 5宝石）
 *     - 购买药水：用宝石购买药水（1000药水 = 5宝石）
 *  3. 购买按钮点击后扣减宝石并增加对应资源
 *  4. 关闭按钮：关闭商店面板
 *
 * 由 FishBaseGameMode.openGemShop 打开时生成。
 */
import {
  BehaviourScript,
  UIButtonComponent,
  UITextComponent,
  logger,
  GameInstance,
} from '@/engine'
import TipsScript from './Tips.script'
import type { FishBaseGameMode } from './FishBaseGameMode'
import type { FishGameInstance } from '../FishGameInstance'

export default class GemShopScript extends BehaviourScript {
  /** GameMode 引用 */
  private mode: FishBaseGameMode | null = null
  /** GameInstance 引用 */
  private inst: FishGameInstance | null = null

  // UI 组件引用
  private gemBalanceText: UITextComponent | null = null
  private buyCoinsButton: UIButtonComponent | null = null
  private buyElixirButton: UIButtonComponent | null = null

  // 购买配置
  private readonly BUY_COINS_GEM_COST = 5
  private readonly BUY_COINS_AMOUNT = 1000
  private readonly BUY_ELIXIR_GEM_COST = 5
  private readonly BUY_ELIXIR_AMOUNT = 1000

  override onStart(): void {
    this.mode = this.gameMode as FishBaseGameMode | null
    this.inst = GameInstance.current as FishGameInstance | null

    if (!this.mode || !this.inst) {
      logger.warn('[GemShopScript] 未找到 GameMode 或 GameInstance，跳过绑定')
      return
    }

    // ─── 1. 关闭按钮 ───
    const closeBtnActor = this.findInChildren('Btn_close')
    if (closeBtnActor) {
      const closeBtn = closeBtnActor.getComponent(UIButtonComponent)
      if (closeBtn) {
        closeBtn.onClick = () => this.closePanel()
        logger.info('[GemShopScript] 关闭按钮已绑定')
      }
    }

    // ─── 2. 宝石余额显示 ───
    this.gemBalanceText = this.findInChildren('GemBalanceText')?.getComponent(UITextComponent) ?? null

    // ─── 3. 购买金币按钮 ───
    const buyCoinsBtnActor = this.findInChildren('Btn_buyCoins')
    if (buyCoinsBtnActor) {
      this.buyCoinsButton = buyCoinsBtnActor.getComponent(UIButtonComponent)
      if (this.buyCoinsButton) {
        this.buyCoinsButton.onClick = () => this.buyCoins()
        logger.info('[GemShopScript] 购买金币按钮已绑定')
      }
    }

    // ─── 4. 购买药水按钮 ───
    const buyElixirBtnActor = this.findInChildren('Btn_buyElixir')
    if (buyElixirBtnActor) {
      this.buyElixirButton = buyElixirBtnActor.getComponent(UIButtonComponent)
      if (this.buyElixirButton) {
        this.buyElixirButton.onClick = () => this.buyElixir()
        logger.info('[GemShopScript] 购买药水按钮已绑定')
      }
    }

    // ─── 5. 初始刷新显示 ───
    this.refreshDisplay()
  }

  /** 每帧刷新宝石余额 */
  override onUpdate(_dt: number): void {
    this.refreshGemBalance()
  }

  /** 刷新宝石余额显示 */
  private refreshGemBalance(): void {
    if (!this.inst || !this.gemBalanceText) return

    const gems = this.inst.resources.get('gems')
    this.gemBalanceText.text = `💎 ${gems} 宝石`
  }

  /** 刷新整个面板显示 */
  private refreshDisplay(): void {
    this.refreshGemBalance()
    this.refreshButtonStates()
  }

  /** 刷新按钮状态 */
  private refreshButtonStates(): void {
    if (!this.inst) return

    const gems = this.inst.resources.get('gems')

    // 购买金币按钮
    if (this.buyCoinsButton) {
      this.buyCoinsButton.state = gems >= this.BUY_COINS_GEM_COST ? 'normal' : 'disabled'
    }

    // 购买药水按钮
    if (this.buyElixirButton) {
      this.buyElixirButton.state = gems >= this.BUY_ELIXIR_GEM_COST ? 'normal' : 'disabled'
    }
  }

  /** 购买金币 */
  private buyCoins(): void {
    if (!this.inst) {
      logger.warn('[GemShopScript] buyCoins: inst为空')
      return
    }

    const gems = this.inst.resources.get('gems')
    logger.info(`[GemShopScript] 尝试购买金币: 当前宝石=${gems}, 需要=${this.BUY_COINS_GEM_COST}`)
    
    if (gems < this.BUY_COINS_GEM_COST) {
      // 显示宝石不足提示
      logger.info(`[GemShopScript] 宝石不足，显示错误提示`)
      TipsScript.showError(
        this.world!,
        '宝石不足',
        `购买金币需要 ${this.BUY_COINS_GEM_COST} 宝石，当前只有 ${gems} 宝石`
      )
      logger.warn(`[GemShopScript] 已显示宝石不足提示: 需要${this.BUY_COINS_GEM_COST}💎, 当前${gems}💎`)
      return
    }

    // 扣减宝石
    logger.info(`[GemShopScript] 扣减宝石: -${this.BUY_COINS_GEM_COST}`)
    if (this.inst.resources.spend('gems', this.BUY_COINS_GEM_COST)) {
      // 增加金币
      this.inst.resources.add('coins', this.BUY_COINS_AMOUNT)
      logger.info(`[GemShopScript] 增加金币: +${this.BUY_COINS_AMOUNT}`)
      
      // 显示成功提示
      logger.info(`[GemShopScript] 购买成功，显示成功提示`)
      TipsScript.showSuccess(
        this.world!,
        '购买成功',
        `成功购买 ${this.BUY_COINS_AMOUNT} 金币！`
      )
      
      logger.info(`[GemShopScript] 购买金币成功: -${this.BUY_COINS_GEM_COST}💎 +${this.BUY_COINS_AMOUNT}🪙`)
      this.refreshDisplay()
    } else {
      logger.error('[GemShopScript] 扣减宝石失败')
    }
  }

  /** 购买药水 */
  private buyElixir(): void {
    if (!this.inst) {
      logger.warn('[GemShopScript] buyElixir: inst为空')
      return
    }

    const gems = this.inst.resources.get('gems')
    logger.info(`[GemShopScript] 尝试购买药水: 当前宝石=${gems}, 需要=${this.BUY_ELIXIR_GEM_COST}`)
    
    if (gems < this.BUY_ELIXIR_GEM_COST) {
      // 显示宝石不足提示
      logger.info(`[GemShopScript] 宝石不足，显示错误提示`)
      TipsScript.showError(
        this.world!,
        '宝石不足',
        `购买药水需要 ${this.BUY_ELIXIR_GEM_COST} 宝石，当前只有 ${gems} 宝石`
      )
      logger.warn(`[GemShopScript] 已显示宝石不足提示: 需要${this.BUY_ELIXIR_GEM_COST}💎, 当前${gems}💎`)
      return
    }

    // 扣减宝石
    logger.info(`[GemShopScript] 扣减宝石: -${this.BUY_ELIXIR_GEM_COST}`)
    if (this.inst.resources.spend('gems', this.BUY_ELIXIR_GEM_COST)) {
      // 增加药水
      this.inst.resources.add('elixir', this.BUY_ELIXIR_AMOUNT)
      logger.info(`[GemShopScript] 增加药水: +${this.BUY_ELIXIR_AMOUNT}`)
      
      // 显示成功提示
      logger.info(`[GemShopScript] 购买成功，显示成功提示`)
      TipsScript.showSuccess(
        this.world!,
        '购买成功',
        `成功购买 ${this.BUY_ELIXIR_AMOUNT} 药水！`
      )
      
      logger.info(`[GemShopScript] 购买药水成功: -${this.BUY_ELIXIR_GEM_COST}💎 +${this.BUY_ELIXIR_AMOUNT}🧪`)
      this.refreshDisplay()
    } else {
      logger.error('[GemShopScript] 扣减宝石失败')
    }
  }

  /** 关闭面板 */
  private closePanel(): void {
    if (this.mode) {
      this.mode.closeGemShop()
    }
  }
}