/**
 * FishGMConsoleHUD — ClashMaster 项目风格 GM 控制台面板
 *
 * 继承引擎 GMConsoleHUD 基类，通过资产驱动构建部落冲突主题面板：
 *  - `panelAssetPath` getter 指向项目 GM 面板 widget 资产（通用节点，zOrder 相对层级 0~3）
 *  - 基类 loadPanelFromAsset() 加载资产树挂到本根下，统一加 GM_ZORDER_BASE 保证最顶层，
 *    并按组件 name 绑定输出区（GM_OutputText）与输入框（GM_InputText）
 *
 * 注册（fish/register.ts）：
 *   GMModule.setConsoleFactory((gm) => new FishGMConsoleHUD(gm))
 *
 * 主题在资产 `asset/blueprints/ui/gm_panel.widget.json` 中定义（暗紫面板 + 部落金
 * 描边 + 亮金标题），改样式直接编辑资产即可，无需改代码。
 */
import { GMConsoleHUD } from '@/engine'
import type { GMModule } from '@/engine'

export class FishGMConsoleHUD extends GMConsoleHUD {
  constructor(gm: GMModule) {
    super(gm)
  }

  /** 项目 GM 面板 widget 资产（通用节点：遮罩/外框/内层/标题/命令列表/输出区/输入框/提示） */
  protected override get panelAssetPath(): string | null {
    return 'asset/blueprints/ui/gm_panel.widget.json'
  }

  /** 部落冲突主题就绪消息 */
  protected override get readyMessage(): string {
    return '⚔️ ClashMaster GM 控制台已就绪（输入 help 查看全部命令）'
  }
}
