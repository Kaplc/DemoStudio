# 设计模式 → DemoStudio widget 落地映射

> 把游戏 UI 设计模式翻译成**可在 DemoStudio `.widget.json` 中直接实现的字段/结构**

## 1. HUD 布局与定位

### 角落信息（金币/血量/小地图）
- ✅ 正确：`anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right"` + `anchorOffset` 内缩
- ❌ 反模式：`anchor: null` + 绝对 position

### 换算速查（画布 1920×1080 ↔ 世界 9.6×5.4）
- 比例：**1 世界单位 = 200 像素**
- 触控目标 48px → 0.24 世界单位
- 安全区内缩 5% = 0.48 世界单位

## 2. 文字可读性

DemoStudio `UITextComponent` **无 outline 字段**：
- `shadowColor: "rgba(0,0,0,0.4)"` + `shadowBlur: 4`
- `bold: true`
- 关键文字 fontSize ≥ 24

## 3. 按钮体系

```json
// 按钮 = 同 Actor（UIImage 背景 + UIButton 交互）+ 子 Actor（UIText 文字）
{ "baseClass": "UIButtonComponent", "properties": { "name": "StartButton" } }
```
- hover/pressed 视觉反馈：脚本监听状态改 `UIImageComponent.color`
- **引擎无 disabled 状态**：用 `CanvasUIComponent.active` 控制显隐

## 4. 面板与浮动层

- 动态面板：运行时 `world.ui.spawnUIActor()` → **自动获得 FLOAT_LAYER_BIAS +100**
- 显隐：根节点 `CanvasUIComponent.active`

## 5. 反模式修正表

| 反模式 | 修正 |
|---|---|
| `anchor: null` + 绝对 position | 改锚点 + anchorOffset |
| 无阴影白字 | shadowColor + shadowBlur + bold |
| 过小触控目标 | 按钮 ≥ 48×48px |
