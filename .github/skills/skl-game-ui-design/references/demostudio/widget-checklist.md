# DemoStudio widget UI 审查清单

> 对 `.widget.json` 资产做设计评审时的**逐项检查表**（结合 assetLint 硬规则 + 游戏 UI 设计原则）。
> 硬规则（lint error）优先；以下为设计层面的补充审查。

## A. 布局与锚点（Lint：anchor 枚举）

- [ ] 所有 UI 控件用锚点定位（`anchor` + `anchorOffset`），无锚点 `position` 仅限根画布/特殊 3D 用途
- [ ] 边角元素（金币/地图按钮等）用 `top-left`/`top-right`/`bottom-left`/`bottom-right` 并 `anchorOffset` 内缩 ≥ 0.48 世界单位（≈5% 安全区）
- [ ] 面板/遮罩用 `anchor: "stretch"` 铺满
- [ ] 同一锚点组的多行信息用 `anchorOffset` y 递增排列，间距一致
- [ ] `worldWidth`/`worldHeight` 与 1080p 像素换算正确（1 世界单位 = 200px）

## B. 尺寸与触控（Lint：number 校验）

- [ ] 交互控件（按钮/卡片）在 1080p 画布下 ≥ 48×48px（= 0.24×0.24 世界单位），重要操作 ≥ 56px（0.28）
- [ ] 相邻触控目标间距 ≥ 8px（0.04 世界单位）
- [ ] 按钮背景（UIImage width/height）与文字（UIText width/height）匹配，文字不溢出按钮

## C. 文字可读性

- [ ] 关键信息 `fontSize` ≥ 24，正文 ≥ 18，次要 ≥ 16（1080p 画布）
- [ ] 浮在动态背景上的文字有 `shadowColor`（如 `rgba(0,0,0,0.4)`）+ `shadowBlur` ≥ 4，或 `bold: true`
- [ ] 数字类信息（金币/时间）左对齐或右对齐固定（`align`），避免跳动
- [ ] `lineHeight` 合理（默认 1.0~1.4），中文长文本不裁切

## D. 层级（zOrder 惯例）

- [ ] 面板背景 0 → 元素 1 → 按钮图 3 → 文本 2/4，符合惯例表
- [ ] 同层文字与图片：文字 zOrder ≥ 图片（+0.0002 防 z-fighting 只在同层生效）
- [ ] 动态面板（暂停/地图）**不手写**大 zOrder，靠 FLOAT_LAYER_BIAS 自动 +100
- [ ] 同一面板内 zOrder 跨度小（0~4），无魔数

## E. 交互与状态

- [ ] `UIButtonComponent.colors` 三态齐全：normal ≠ hover（明显视觉差）≠ pressed（按下反馈）
- [ ] 按钮有背景（同 Actor UIImage）——纯 UIButton 无背景 = 不可见按钮
- [ ] 按钮文字是独立子 Actor（UIText），非同节点
- [ ] 禁用/不可用状态：灰度 `UIImageComponent.color` + 脚本拦截点击（引擎无 disabled 状态）
- [ ] 图标/色块信息带文字或图标后备（色盲友好），不纯靠颜色

## F. 状态管理与多面板

- [ ] 常驻 HUD（GameMode.HUDClass）与动态面板（spawnUIActor）职责分离
- [ ] 面板显隐用根节点 `active`（级联子树），勿逐节点开关
- [ ] 暂停/全屏菜单存在时遮挡视觉已处理（遮罩变暗）
- [ ] 关键信息在暂停菜单外也可见（一瞥可达），不全藏菜单里

## G. 资产完整性（assetLint 零错误）

- [ ] 根含 `UITransformComponent`（worldWidth/worldHeight > 0）+ `CanvasUIComponent`（width/height ≥ 1, active: true）
- [ ] 每个控件节点含 `CanvasUIComponent`（markerOnly: true, name: "UIMarker"）
- [ ] 无顶层 `position`/`rotation`/`scale`；组件 properties 内仅变换组件有变换字段
- [ ] 所有 `id`、`name` 唯一
- [ ] `script` 引用的脚本 id 真实存在（`src/projects/<project>/gameplay/**/*.script.ts`）
- [ ] 颜色格式 hex / rgba() 合法；数值在组件 schema 范围内

## H. 完成态验证

- [ ] 用 `UIPreviewManager` 2D 预览检查：无文字裁切、无重叠、锚点跟随视口比例
- [ ] 运行时验证：动态面板（spawn）层级盖住 HUD、active 切换即时生效、按钮三态有反馈
- [ ] 多分辨率检查：切换视口比例（16:9 ↔ 4:3）锚点自适应
