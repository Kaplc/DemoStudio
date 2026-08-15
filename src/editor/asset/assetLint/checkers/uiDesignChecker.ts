/**
 * assetLint/checkers/uiDesignChecker — 游戏 UI 设计级规则检查器（widget 资产）
 *
 * 在 assetLint 硬规则之上，补充 game-ui-design 设计准则的自动校验（全部 warn，不影响通过率）：
 *  - ui:font-size：UITextComponent.fontSize < 14 → 警告（TV/掌机可读性）
 *  - ui:small-touch-target：交互节点（含 UIButtonComponent）worldWidth/Height 换算触控尺寸 < 44px → 警告
 *  - ui:no-text-shadow：HUD 文本（UITextComponent）无 shadowColor → 警告（动态背景可读性）
 *  - ui:z-index-war：CanvasUIComponent.zOrder > 100 → 警告（层级魔数）
 *
 * 换算基准：1920×1080 画布 ↔ 9.6×5.4 世界（1 世界单位 = 200px），44px = 0.22 世界单位。
 * 按根画布世界尺寸实际换算（比例非 200 时按比例折算）。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { CheckerContext, LintIssue } from '../types'

/** 触控目标最小像素（Apple 44pt / Google 48dp 取严） */
const MIN_TOUCH_PX = 44

/** 世界单位 → 像素换算（按根画布尺寸推导；默认 1920/9.6=200） */
function pxPerWorldUnit(root: unknown): number {
  // 找根 UITransformComponent worldWidth 与 CanvasUIComponent width
  const find = (node: unknown, baseClass: string): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object') return null
    const n = node as Record<string, unknown>
    if (Array.isArray(n.components)) {
      for (const c of n.components as Array<Record<string, unknown>>) {
        if (c.baseClass === baseClass && c.properties && typeof c.properties === 'object') {
          return c.properties as Record<string, unknown>
        }
      }
    }
    return null
  }
  const rootNode = root as Record<string, unknown>
  const canvas = find(rootNode, 'CanvasUIComponent')
  const tsf = find(rootNode, 'UITransformComponent')
  const pxW = typeof canvas?.width === 'number' ? (canvas.width as number) : 1920
  const worldW = typeof tsf?.worldWidth === 'number' ? (tsf.worldWidth as number) : 9.6
  return worldW > 0 ? pxW / worldW : 200
}

/** 递归遍历 widget 节点树 */
function walkNodes(
  node: unknown,
  cb: (n: Record<string, unknown>, nodePath: string) => void,
  path = 'root',
): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  cb(n, path)
  if (Array.isArray(n.children)) {
    n.children.forEach((child, i) => {
      walkNodes(child, cb, `${path}.children[${i}]`)
    })
  }
}

/** 组件属性（按 baseClass 找首个匹配组件） */
function compProps(node: Record<string, unknown>, baseClass: string): Record<string, unknown> | null {
  if (!Array.isArray(node.components)) return null
  for (const c of node.components as Array<Record<string, unknown>>) {
    if (c.baseClass === baseClass && c.properties && typeof c.properties === 'object') {
      return c.properties as Record<string, unknown>
    }
  }
  return null
}

/** 设计级检查器（widget 资产 doc:blueprint 上运行） */
class UiDesignChecker extends AbstractAssetChecker {
  readonly kind = 'doc:ui-design'

  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const root = node as Record<string, unknown>

    walkNodes(node, (n, nodePath) => {
      const textProps = compProps(n, 'UITextComponent')
      if (textProps) {
        // 1. 字号过小
        const fontSize = textProps.fontSize
        if (typeof fontSize === 'number' && fontSize < 14) {
          issues.push(ctx.issue(
            'properties.fontSize',
            'ui:font-size',
            `字号 ${fontSize}px 小于 14px——TV/掌机难以阅读；次要文字建议 ≥16px，正文 ≥18px，关键信息 ≥24px`,
            'warn',
            fontSize,
          ))
        }
        // 2. HUD 文本无阴影（可读性）
        const hasShadow = textProps.shadowColor !== undefined && String(textProps.shadowColor).length > 0
        const isButtonText = nodePath.includes('Btn') || String(n.name ?? '').includes('Btn')
        if (!hasShadow && !isButtonText) {
          issues.push(ctx.issue(
            'properties.shadowColor',
            'ui:no-text-shadow',
            '文本未配置 shadowColor——动态背景上可能不可读；建议 shadowColor: "rgba(0,0,0,0.4)" + shadowBlur ≥ 4',
            'warn',
          ))
        }
      }

      // 3. 触控目标过小（交互节点：含 UIButtonComponent）
      const hasButton = compProps(n, 'UIButtonComponent') !== null
      if (hasButton) {
        const tsfProps = compProps(n, 'UITransformComponent')
        if (tsfProps) {
          const ww = typeof tsfProps.worldWidth === 'number' ? (tsfProps.worldWidth as number) : 0
          const wh = typeof tsfProps.worldHeight === 'number' ? (tsfProps.worldHeight as number) : 0
          const ppu = pxPerWorldUnit(root)
          const px = Math.min(ww * ppu, wh * ppu)
          if (px > 0 && px < MIN_TOUCH_PX) {
            issues.push(ctx.issue(
              'properties.worldWidth',
              'ui:small-touch-target',
              `按钮触控尺寸约 ${px.toFixed(0)}px 小于 ${MIN_TOUCH_PX}px（Apple 44pt）——触控/手柄选择困难；建议扩大命中区`,
              'warn',
              px,
            ))
          }
        }
      }

      // 4. zOrder 魔数（>100 通常只有 FLOAT_LAYER_BIAS 动态叠加，资产内不应出现）
      const canvasProps = compProps(n, 'CanvasUIComponent')
      if (canvasProps && typeof canvasProps.zOrder === 'number' && (canvasProps.zOrder as number) > 100) {
        issues.push(ctx.issue(
          'properties.zOrder',
          'ui:z-index-war',
          `zOrder ${canvasProps.zOrder} 超过惯例区间（0~4，浮动层由 FLOAT_LAYER_BIAS 自动 +100）——检查是否误写`,
          'warn',
          canvasProps.zOrder,
        ))
      }
    })

    return issues
  }
}
registerAssetChecker('doc:ui-design', UiDesignChecker)
