# UI widget 渲染陷阱（2026-09-13 主菜单 SVG 落地实证）

## 白色 fallback：只有圆角无颜色的 div

**Problem:** `PlanetSurface`（584×584、仅 border-radius 无背景色、overflow:hidden 裁剪容器）在游戏里渲染成白色实心圆，盖住下层行星渐变。

**Cause:** uiCompiler `collectImageProps` 的 `hasVisual = image || gradient || color || corners.some(>0)`——只有圆角也被判为"有视觉"，发射**无 color 无 gradient 的 UIImageComponent**；运行时 `UIImageComponent` 构造 `color ?? '#ffffff'` → 白色 fallback 实心面板。`background-color: transparent` 救不了（corners 仍触发 hasVisual）。

**Solution:** 裁剪容器不要单独建无色 div——把 `overflow: hidden` 直接挂到**有颜色的元素**上（如行星渐变本体挂 overflow:hidden，波纹做它的子节点）。排查命令：遍历 widget.json 找 `UIImageComponent` 无 color/gradient/src 的节点即白色 fallback。

**Applicable:** 所有 `.widget.html` 手写资产；`src/editor/asset/uiCompiler/compile.ts` collectImageProps 若要根治需改 hasVisual 判定（未做，2026-09-13 状态）。

## UITextComponent bold=true 整体不渲染

**Problem:** 主菜单 78px 标题 `font-weight: bold` 时文本完全不可见（运行时 ai.getActor 全字段健康：text/fontSize/color/active/renderVisible 正常）；`ai.setProperty` 把 bold 改 false 后**立即显示**（变量隔离实证）。

**Cause:** 未查透（2026-09-13 状态）。嫌疑：UIText 渲染链 bold 字体变体加载失败。shadow 属性已排除（`_shadowColor` 只存储无渲染消费）。

**Solution:** 资产侧规避：标题不用 `font-weight: bold`，靠大字号 + letter-spacing 支撑品牌感。引擎侧根因（UIText 渲染器 bold 处理）待专项排查。

**Applicable:** 所有 `.widget.html` 的 text/button 标签；`src/engine/ui/UITextComponent.ts` bold 渲染链。
