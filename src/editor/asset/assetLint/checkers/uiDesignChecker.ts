/**
 * assetLint/checkers/uiDesignChecker — 游戏 UI 设计级规则检查器（widget / UI 蓝图资产）
 *
 * 在 assetLint 硬规则之上，补充 game-ui-design 设计准则的自动校验：
 * 硬规则（error，进 ui_compile 零错误门槛）：
 *  - ui:root-anchor：widget 根声明 anchor/anchorOffset → 报错。
 *    根节点默认全屏全锚（canvas 默认 1920×1080），位置自定义写在根内子元素；
 *    游戏内顶层生成（HUDClass / spawnUIActor 默认挂 HUD）时根无父容器可解算，
 *    applyAnchor 会静默跳过 → 编辑器预览正常、游戏内位置错乱。
 * 设计准则（warn，不影响通过率）：
 *  - ui:font-size：UITextComponent.fontSize < 14 → 警告（TV/掌机可读性）
 *  - ui:no-text-shadow：文本无 shadowColor → 警告（动态背景可读性）。
 *    按钮链豁免：节点自身或任一祖先挂 UIButtonComponent、或名字链含 "Btn"
 *    （按钮自带底色，其标签文本不强制阴影）。
 *  - ui:weak-text-shadow：有 shadowColor 但 shadowBlur 显式 < 4 → 警告
 *    （引擎缺省 blur=4 已达标，只有显式写小值才算误配）
 *  - ui:small-touch-target：交互节点（含 UIButtonComponent）worldWidth/Height 换算触控尺寸 < 44px → 警告
 *  - ui:z-index-war：CanvasUIComponent.zOrder > 100 → 警告（层级魔数）
 *  - ui:progress-fill-missing：UIProgressBarComponent.fillActorName（缺省 "Fill"）
 *    在子树中找不到同名子 Actor → 警告。与引擎 _findChildByName 同语义（按 name
 *    深度递归）；编译器同名后缀（Fill_2）导致运行时刷 warn 的事故可静态拦截。
 *  - ui:world-anchor-conflict：挂 UIWorldAnchorComponent 的节点声明 anchor → 警告
 *
 * 换算基准：UI 单位一元化后 1 世界单位 = 1 设计像素（1920×1080 画布 ↔ 1920×1080 世界），
 * 44px = 44 世界单位。按根画布世界尺寸实际换算（旧资产按实际比例折算）。
 *
 * 定位约定：issue.nodePath 携带节点名链（如 "<widget 根>/Panel/HeadText"）逐节点可定位，
 * 只有根规则（ui:root-anchor）落在 "<widget 根>"。历史实现把全部 issue 固定记在
 * "<widget 根>" 上，多条同类问题无法区分还会被日志指纹去重折叠——勿回退。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { CheckerContext, LintIssue } from '../types'

/** 触控目标最小像素（Apple 44pt / Google 48dp 取严） */
const MIN_TOUCH_PX = 44

/** 文本阴影建议最小模糊半径（与告警文案、引擎缺省值保持一致） */
const MIN_SHADOW_BLUR = 4

/** 世界单位 → 像素换算（按根画布尺寸推导；px 世界默认 1920/1920=1） */
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
  const worldW = typeof tsf?.worldWidth === 'number' ? (tsf.worldWidth as number) : 1920
  return worldW > 0 ? pxW / worldW : 1
}

/**
 * 递归遍历 widget 节点树。
 * path 为节点名链（"<widget 根>/Panel/HeadText"，无名节点回退 "#序号"），
 * 同时供 issue 定位与按钮链豁免判定使用；chainHasButton 表示自身或任一祖先
 * 挂 UIButtonComponent（自上而下累积）。
 */
function walkNodes(
  node: unknown,
  cb: (n: Record<string, unknown>, path: string, chainHasButton: boolean) => void,
  path = '<widget 根>',
  chainHasButton = false,
): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  const hasButton = chainHasButton || compProps(n, 'UIButtonComponent') !== null
  cb(n, path, hasButton)
  if (Array.isArray(n.children)) {
    n.children.forEach((child, i) => {
      if (!child || typeof child !== 'object') return
      const c = child as Record<string, unknown>
      const seg = typeof c.name === 'string' && c.name ? c.name : `#${i}`
      walkNodes(c, cb, `${path}/${seg}`, hasButton)
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

/** 子树（不含 node 自身）中是否存在名为 name 的后代节点（与引擎 _findChildByName 同语义）。 */
function subtreeHasChildNamed(node: Record<string, unknown>, name: string): boolean {
  if (!Array.isArray(node.children)) return false
  for (const c of node.children as unknown[]) {
    if (!c || typeof c !== 'object') continue
    const child = c as Record<string, unknown>
    if (child.name === name) return true
    if (subtreeHasChildNamed(child, name)) return true
  }
  return false
}

/** 设计级检查器（widget 资产 doc:blueprint 上运行） */
class UiDesignChecker extends AbstractAssetChecker {
  readonly kind = 'doc:ui-design'

  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const root = node as Record<string, unknown>

    // 0. 根锚点禁用（硬规则）：widget 根默认全屏全锚，位置自定义写在根内子元素。
    //    游戏内顶层生成时根的父级是 HUD Actor（无 UITransform/Canvas 尺寸），
    //    applyAnchor 找不到父容器会静默跳过 → 锚点声明在游戏内不生效（编辑器预览
    //    有预览容器所以看不出）。仅查文档根；子元素的 anchor 是编译器
    //    position:absolute + left/top % 的合法映射产物，不受此规则约束。
    const rootTsf = compProps(root, 'UITransformComponent')
    if (rootTsf) {
      const rootAnchor = rootTsf.anchor
      const hasOffset = Array.isArray(rootTsf.anchorOffset)
      if ((rootAnchor !== undefined && rootAnchor !== null) || hasOffset) {
        issues.push(ctx.issue(
          'properties.anchor',
          'ui:root-anchor',
          `widget 根声明了 anchor "${String(rootAnchor ?? '（无）')}"（含 anchorOffset）——游戏内顶层生成时无父容器，applyAnchor 静默跳过，位置不生效；根节点默认全屏全锚（canvas 默认 1920x1080），自定义定位写在根内子元素（position: absolute + left/top）`,
          'error',
          rootAnchor ?? rootTsf.anchorOffset,
        ))
      }
    }

    // per-node issue 构造器：覆写 ctx 固定的 nodePath，使 walk 途中发现的
    // 问题定位到具体节点并直接入列（ctx 由派发方以 "<widget 根>" 构造，仅供根规则使用）
    const issueAt = (nodePath: string) =>
      (field: string, ruleId: string, message: string, severity: 'error' | 'warn' = 'warn', value?: unknown): void => {
        issues.push({ filePath: ctx.filePath, nodePath, field, ruleId, severity, message, value })
      }

    walkNodes(node, (n, path, chainHasButton) => {
      const issue = issueAt(path)
      const textProps = compProps(n, 'UITextComponent')
      if (textProps) {
        // 1. 字号过小
        const fontSize = textProps.fontSize
        if (typeof fontSize === 'number' && fontSize < 14) {
          issue(
            'properties.fontSize',
            'ui:font-size',
            `字号 ${fontSize}px 小于 14px——TV/掌机难以阅读；次要文字建议 ≥16px，正文 ≥18px，关键信息 ≥24px`,
            'warn',
            fontSize,
          )
        }
        // 2. 文本无阴影（可读性）。按钮链豁免：自身/祖先挂 UIButtonComponent，
        //    或名字链含 "Btn"（按钮自带底色，标签不强制阴影）。
        const hasShadow = textProps.shadowColor !== undefined && String(textProps.shadowColor).length > 0
        const isButtonText = chainHasButton || path.split('/').some((seg) => seg.includes('Btn'))
        if (!hasShadow && !isButtonText) {
          issue(
            'properties.shadowColor',
            'ui:no-text-shadow',
            '文本未配置 shadowColor——动态背景上可能不可读；建议 shadowColor: "rgba(0,0,0,0.4)" + shadowBlur ≥ 4',
            'warn',
          )
        } else if (hasShadow && typeof textProps.shadowBlur === 'number' && textProps.shadowBlur < MIN_SHADOW_BLUR) {
          // 2b. 阴影模糊不足：引擎缺省 blur=4 已达标，显式写小值视为误配
          issue(
            'properties.shadowBlur',
            'ui:weak-text-shadow',
            `shadowBlur ${textProps.shadowBlur} 小于建议值 ${MIN_SHADOW_BLUR}——阴影过锐可读性提升有限`,
            'warn',
            textProps.shadowBlur,
          )
        }
      }

      // 2c. 进度条 fill 子 Actor 存在性（跨引用）：fillActorName 缺省 "Fill"，
      //     引擎按 name 深度递归查找；找不到时运行时每次刷新刷 warn 且进度条不显示
      const progressProps = compProps(n, 'UIProgressBarComponent')
      if (progressProps) {
        const fillName = typeof progressProps.fillActorName === 'string' && progressProps.fillActorName
          ? progressProps.fillActorName
          : 'Fill'
        if (!subtreeHasChildNamed(n, fillName)) {
          issue(
            'properties.fillActorName',
            'ui:progress-fill-missing',
            `进度条找不到 fill 子 Actor "${fillName}"——运行时进度条不显示并持续刷 warn；注意同名节点会被编译器加后缀（Fill_2/Fill_3），data-props 需显式写 "fillActorName"`,
            'warn',
            fillName,
          )
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
            issue(
              'properties.worldWidth',
              'ui:small-touch-target',
              `按钮触控尺寸约 ${px.toFixed(0)}px 小于 ${MIN_TOUCH_PX}px（Apple 44pt）——触控/手柄选择困难；建议扩大命中区`,
              'warn',
              px,
            )
          }
        }
      }

      // 4. zOrder 魔数（>100 通常只有 FLOAT_LAYER_BIAS 动态叠加，资产内不应出现）
      const canvasProps = compProps(n, 'CanvasUIComponent')
      if (canvasProps && typeof canvasProps.zOrder === 'number' && (canvasProps.zOrder as number) > 100) {
        issue(
          'properties.zOrder',
          'ui:z-index-war',
          `zOrder ${canvasProps.zOrder} 超过惯例区间（0~4，浮动层由 FLOAT_LAYER_BIAS 自动 +100）——检查是否误写`,
          'warn',
          canvasProps.zOrder,
        )
      }

      // 5. World-Space UI 锚定（doc-dev/ui-world-space TC-W3.5）：
      //    UIWorldAnchorComponent(mode='world') 根禁用 anchor（位姿由锚定系统接管）；
      //    screen 模式根同样应 anchor:null（applyAnchor 会覆盖投影写入的 position）。
      const anchorProps = compProps(n, 'UIWorldAnchorComponent')
      if (anchorProps) {
        const tsfProps2 = compProps(n, 'UITransformComponent')
        const anchorVal = tsfProps2?.anchor
        const isWorld = anchorProps.mode === 'world'
        if (anchorVal !== undefined && anchorVal !== null) {
          issue(
            'properties.anchor',
            'ui:world-anchor-conflict',
            `${isWorld ? 'world' : 'screen'} 模式锚定 widget 根声明了 anchor "${String(anchorVal)}"——位姿由 UIWorldAnchorComponent 接管，applyAnchor 会覆盖投影写入的 position；请删除 anchor（保持 null）`,
            'warn',
            anchorVal,
          )
        }
      }
    })

    return issues
  }
}
registerAssetChecker('doc:ui-design', UiDesignChecker)
