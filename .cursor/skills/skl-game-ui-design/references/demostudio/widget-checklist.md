# DemoStudio widget UI 审查清单

> 对 `.widget.json` 资产做设计评审时的**逐项检查表**

## A. 布局与锚点

- [ ] 所有 UI 控件用锚点定位（`anchor` + `anchorOffset`）
- [ ] 边角元素用边角锚 + `anchorOffset` 内缩 ≥ 0.48 世界单位
- [ ] 面板/遮罩用 `anchor: "stretch"`
- [ ] `worldWidth`/`worldHeight` 换算正确（1 世界单位 = 200px）

## B. 尺寸与触控

- [ ] 交互控件在 1080p 画布下 ≥ 48×48px（= 0.24×0.24 世界单位）
- [ ] 按钮背景与文字匹配，文字不溢出

## C. 文字可读性

- [ ] 关键信息 `fontSize` ≥ 24，正文 ≥ 18
- [ ] 浮在动态背景上的文字有 `shadowColor` + `shadowBlur` ≥ 4

## D. 层级（zOrder）

| zOrder | 用途 |
|---|---|
| 0 | 面板/背景、UIMarker |
| 2 | 文本 |
| 3 | 按钮背景图片 |
| +100 | 动态面板（浮动层） |

- [ ] 动态面板**不手写**大 zOrder

## E. 交互与状态

- [ ] 按钮有背景（同 Actor UIImage）
- [ ] 按钮文字是独立子 Actor（UIText）
- [ ] 禁用状态：灰度 `UIImageComponent.color` + 脚本拦截点击

## F. 资产完整性

- [ ] 根含 `UITransformComponent`（worldWidth/worldHeight > 0）+ `CanvasUIComponent`
- [ ] 每个控件节点含 `CanvasUIComponent`（markerOnly: true）
- [ ] 无顶层 transform
- [ ] 所有 `id`、`name` 唯一
