# DemoStudio widget UI 审查清单

> 对 `.widget.json` 资产做设计评审时的**逐项检查表**。

## A. 布局与锚点

- [ ] 所有 UI 控件用锚点定位（`anchor` + `anchorOffset`），无锚点 `position` 仅限根画布
- [ ] 边角元素用 `top-left`/`top-right`/`bottom-left`/`bottom-right` 并 `anchorOffset` 内缩 ≥ 0.48 世界单位
- [ ] 面板/遮罩用 `anchor: "stretch"` 铺满
- [ ] `worldWidth`/`worldHeight` 与 1080p 像素换算正确（1 世界单位 = 200px）

## B. 尺寸与触控

- [ ] 交互控件在 1080p 画布下 ≥ 48×48px（= 0.24×0.24 世界单位）
- [ ] 按钮背景与文字匹配，文字不溢出按钮

## C. 文字可读性

- [ ] 关键信息 `fontSize` ≥ 24，正文 ≥ 18
- [ ] 浮在动态背景上的文字有 `shadowColor` + `shadowBlur` ≥ 4

## D. 层级（zOrder 惯例）

| zOrder | 用途 |
|---|---|
| 0 | 面板/背景容器、UIMarker |
| 1 | 次级元素 |
| 2 | 文本 |
| 3 | 按钮背景图片 |
| 4 | 高优先级文本 |
| +100 | 动态面板（浮动层） |

- [ ] 动态面板**不手写**大 zOrder，靠 FLOAT_LAYER_BIAS 自动 +100

## E. 交互与状态

- [ ] 按钮有背景（同 Actor/子节点 UIImage）
- [ ] 按钮文字是独立子 Actor（UIText），非同节点
- [ ] 禁用状态：灰度 `UIImageComponent.color` + 脚本拦截点击

## F. 资产完整性（assetLint 零错误）

- [ ] 根含 `UITransformComponent`（worldWidth/worldHeight > 0）+ `CanvasUIComponent`
- [ ] 每个控件节点含 `CanvasUIComponent`（markerOnly: true, name: "UIMarker"）
- [ ] 无顶层 `position`/`rotation`/`scale`
- [ ] 所有 `id`、`name` 唯一
