# 设计模式 → DemoStudio widget 落地映射

> 把 `references/patterns.md`（创作模式）与 `references/sharp_edges.md`（失败模式）的设计建议，翻译成
> **可在 DemoStudio `.widget.json` 中直接实现的字段/结构**。设计评审时按本表给出"改哪个字段"级别的建议。

## 1. HUD 布局与定位

### 角落信息（金币/血量/弹药/小地图）
- ✅ 正确：`anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right"` + `anchorOffset` 内缩（安全区）
- ❌ 反模式：`anchor: null` + 绝对 `position` 摆死坐标（分辨率/比例变化时错位）
- 容器面板用 `anchor: "stretch"` 铺满父容器

### 中央信息（准星/警告横幅）
- ✅ `anchor: "center"` + 小 `worldWidth/worldHeight`
- 警告横幅建议 `top-center` 或 `center` 下方，勿遮挡交互热区

### 三行信息组（如兵营队列/军队容量）
- ✅ 每个信息行 = 独立 Actor（`anchor` 同锚 + `anchorOffset` 按行距递增）
- 行间距用 `anchorOffset` 的 y 递增，不要叠 position

## 2. 文字可读性（对应 sharp_edges: no-text-outline-or-shadow）

DemoStudio `UITextComponent` **无 outline 字段**，可读性靠：
- `shadowColor: "rgba(0,0,0,0.4)"` + `shadowBlur: 4`（投影）
- `bold: true`（加粗增加辨识度）
- 关键文字（金币数/血量）建议 `fontSize` ≥ 24（1080p 画布）
- 次要文字 ≥ 16，正文 ≥ 18；不要低于 14

## 3. 按钮体系（对应 patterns: Controller-First Navigation）

```json
// 按钮 = 同 Actor（UIImage 背景 + UIButton 交互）+ 子 Actor（UIText 文字）
// UIButton 为纯交互（无颜色属性）；hover/pressed 变色由脚本直接改 image.color
{ "baseClass": "UIButtonComponent", "properties": { "name": "StartButton" } }
```
- hover/pressed 视觉反馈：脚本监听状态改 `UIImageComponent.color`，或依赖内置 `pressScale`（按下微缩，默认 0.92）
- **引擎无 focus/disabled 状态**：用 `CanvasUIComponent.active` 控制整体显隐；禁用态用灰度 `UIImageComponent.color` + 忽略点击（脚本判断）

## 4. 面板与浮动层（对应 patterns: Safe Zone / 上下文可见性）

- 动态面板（暂停/地图/建筑菜单）：运行时 `world.ui.spawnUIActor()` 生成 → **自动获得 FLOAT_LAYER_BIAS +100**，盖住静态 HUD，无需手写 zOrder
- 面板根用 `anchor: "stretch"` + 半透明遮罩（`UIImageComponent.color: "rgba(0,0,0,0.5)"`）
- 面板自身 `zOrder: 0`，内部元素 1~4 递增
- 显隐：根节点 `CanvasUIComponent.active` 控制（级联子树）

## 5. 状态与反馈（对应 patterns: Cooldown / 伤害数字）

- 冷却/进度：`UIImageComponent` 叠加层（遮罩宽度随进度）+ 子 Actor 数字文本
- 伤害数字：动态 `spawnUIActor` 生成数字卡片，脚本内 tween 上浮后销毁
- 状态色：**颜色 + 图标/文字双通道**（色盲友好），如红色圆形 + "危险"标签

## 6. 多状态 UI（对应 patterns: Contextual HUD Visibility）

DemoStudio 用 **widget 拆分 + active 切换** 实现多状态：
| 状态 | 实现 |
|---|---|
| 常驻 HUD | `base_hud.widget.json`（GameMode.HUDClass） |
| 菜单/面板 | 独立 `.widget.json`，运行时 spawn/destroy 或根 active 切换 |
| 暂停菜单 | 独立 widget + `UIScriptComponent` 挂暂停逻辑 |
| 隐藏/展开 | 根节点 `active` 切换；子细节用节点级 `active` |

## 7. 反模式在 DemoStudio 中的具体形态

| 反模式 | DemoStudio 表现 | 修正 |
|---|---|---|
| Cluttered HUD | 所有信息常驻显示 | 拆 widget + active 按需切换 |
| UI Blocking Action | 面板盖住操作区 | 面板 `stretch` 居中 + 遮罩变暗（保留视觉路径） |
| 仅颜色传达 | 敌我仅靠颜色 | 加图标（UIImage src）或文字标签 |
| 分辨率依赖 | `anchor: null` + 绝对 position | 改锚点 + anchorOffset |
| 过小触控目标 | worldWidth/Height 过小 | 1080p 画布下按钮 ≥ 48×48 px（world 0.24×0.24 @ 9.6 宽） |
| 文字不可读 | 无阴影白字盖在亮背景 | shadowColor + shadowBlur + bold |

## 8. 换算速查（画布 1920×1080 ↔ 世界 9.6×5.4）

- 比例：**1 世界单位 = 200 像素**
- `worldWidth = 像素宽 / 200`；`worldHeight = 像素高 / 200`
- 触控目标 44px → 0.22 世界单位；48px → 0.24；56px → 0.28
- 安全区内缩 5% = 96px = 0.48 世界单位（`anchorOffset` 用世界单位）
