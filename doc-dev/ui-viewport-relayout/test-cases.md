# 测试用例：UI 视口自适应重排（运行时 resize 触发全屏根重排）

> 状态：**P2 全绿（2026-09-04）**｜可执行测试：`tests/uiViewportRelayout.test.ts`（14/14）
> 范式：P0 概念基线 = 实现前后不变契约；P1 基线（resize 不重排的现状断言）实现落地后已翻新删除（历史见 git）；P2 = 目标口径断言。
> 运行：`npx vitest run tests/uiViewportRelayout.test.ts`

---

## P0 概念基线（不变契约）

| 编号 | 用例 | 断言 |
|---|---|---|
| TC-B0.1 | contain 视锥 16:9 | 视锥恰为 1920×1080（铺满） |
| TC-B0.1 | contain 视锥 4:3(1440×1080) | 视锥 1920×1440（宽铺满、高留空，恒 ⊇ 画布） |
| TC-B0.1 | contain 视锥 21:9(2560×1080) | 视锥 2560×1080（高铺满、两侧留空） |
| TC-B0.2 | projectToUi 坐标语言 | 世界原点 → [960,540]（角原点像素、y 向上） |

## P2 目标口径（全绿）

| 编号 | 用例 | 断言 |
|---|---|---|
| TC-B2.11 | 16:9 视锥 relayout | 根保持 1920×1080（现状视觉不变锚定） |
| TC-B2.1 | 4:3 视锥 relayout | 全屏根 1920×1080 → 1920×1440（根 = 视锥，铺满） |
| TC-B2.3 | stretch 子节点 | 铺满新容器 1920×1440 |
| TC-B2.4 | top-right 锚点子节点 | position 重算 x=(960-36)-24=900, y=(720-36)-24=660 |
| TC-B2.5 | 浮层 toast（120×40，挂 HUD 容器） | 不参与重排（尺寸不变） |
| TC-B2.5b | markerOnly 容器根（高 ≥ 540） | 同样参与重排 |
| TC-B2.8 | 同视锥重复 relayout | 幂等（子节点位置稳定） |
| TC-B2.9 | 无 HUD | no-op 不抛错 |
| TC-B2.10 | 重排后 material 引用 | 不变（不重建 mesh/纹理） |
| TC-B2.7 | resize 联动（视锥计算 + relayout 同式驱动） | 4:3 → 根 1920×1440；16:9 回正 → 1080 |

## 踩坑记录

1. **esbuild/vite-node 擦除"仅被函数体间接使用"的 import** → 循环链（Actor→ActorUtils→GameInstance→World→UIManager→HUD→Actor）中 World 成为首个求值模块，经 GenericActor→Actor→ActorUtils→GameInstance→GMModule→GMConsoleHUD→HUD 在 **Actor 半初始化**处炸出 `Class extends value undefined`。修法：测试顶层 `void UICamera` 等值使用锚点维持求值顺序（叶子 UICamera 与 UIWorldAnchorComponent 先导）。二分定位过程 20+ 探针，最终由 verbose 堆栈的模块求值链锁定。
2. **jsdom 无 WebGL**：TC-B2.7 不能真建 SceneRendererComponent（`new WebGLRenderer` 即抛错），联动验证改为直接驱动"视锥计算 + relayout"同式核心路径。
3. **toast 挂载位置**：`spawnUIActor` 缺省 parent 是 HUD 容器（`world.ui.hud`），不是 HUD 的 uiActor 子树；浮层豁免断言要在 `hud.getChildren()` 找。
