# 方案：UI 视口自适应重排（运行时 resize 触发全屏根重排）

> 状态：**已实施（2026-09-04）**｜验收用例：[test-cases.md](./test-cases.md)（P2 全绿，`tests/uiViewportRelayout.test.ts` 14/14）
> 关联：`doc-dev/ui-unit-unification/`（1px=1 单位，本方案的空间基础）、`doc-dev/ui-world-space/`（锚定 widget 豁免边界）

---

## 一、问题与目标

**问题**：UI 单位一元化后，UICamera 的 contain 视锥使 UI 在**任意分辨率/窗口尺寸下等比缩放不裁切**，但运行时视口比例变化（拖拽窗口、Game 视口改比例）只会改相机视锥——**UI 树没有任何重排**。非 16:9 视口下全屏 HUD 根（1920×1080）不跟随视锥，两侧/上下留黑；`stretch` 全锚、九宫格锚点在运行时全部失效（编辑器 widget 预览里是好的——`UIPreviewManager.applyViewportAspect` 有成熟实现，但只在预览态生效）。

**目标**：把预览态的"视口比例 → 全屏根重排"逻辑下沉到引擎：`SceneRendererComponent.resize()` 联动 `UIManager.relayoutForViewport()`，全屏根重排为 contain 视锥尺寸，子树锚点递归重算。任意比例视口下 HUD 铺满、锚点跟随。

**非目标**：
- UILayout flex/grid 的**条目间距**不随重排缩放（间距是设计 px，恒定；行的对齐位置由锚点重算跟随）——与单位一元化"设计 px 恒定、画布长大"的哲学一致；
- DPI 分级 / 缩放区间钳制（scale ∈ [min,max]）不做——有真实多设备需求再立项；
- GM 控制台 HUD（`layerBaseZ` 特殊层，独立 HUD 实例）不在 `this._hud` 上，本期不重排（边界见 §五）。

## 二、核心架构决策

### D1 ｜重排目标 = 根尺寸 = contain 视锥（不是"保持高度改宽"）

contain 视锥（设计单位）= `画布/scale`，`scale = min(w/1920, h/1080)`，**恒 ⊇ 画布**：
16:9 → 1920×1080；4:3(1440×1080) → **1920×1440**；超宽(2560×1080) → **2560×1080**。

预览态 `applyViewportAspect` 用"保持高度、宽随比例"（4:3 → 1440×1080），那是 `fitToWidget` 视口语境；运行时若照搬，根会缩小到视锥的 3/4 占比（1080/1440），画面反而变小。**运行时唯一正确目标：根 = 视锥**，根的视觉占比与 16:9 时逐像素一致（整个设计稿被等比放大铺满）。

### D2 ｜全屏根判定与预览态同式

真实画布根 `1920×1080`，或 markerOnly 容器根高 ≥ 半屏（540）。浮层 widget（toast/tooltip 小画布）与顶层锚定 widget 不满足判定，天然豁免。

### D3 ｜触发点：SceneRendererComponent.resize() 尾部联动

`resize()` 在 `_uiCam.setCanvasSize(w, h)` 之后、同源公式（`UICamera.computeContainFrustum`）计算视锥设计尺寸，调 `owner.ui.relayoutForViewport(vw, vh)`。ResizeObserver（容器监听）→ `resize()` → relayout 的链路无需新监听器，复用现有 observer。

### D4 ｜幂等与安全

- 尺寸已等于目标（16:9 视锥 = 原画布）时跳过，同比例 resize 零开销；
- 无 HUD / HUD 无 UI / 根非全屏时 no-op；
- 重排只动 `setWorldSize` + `applyAnchor`（scale/position），**不重建 mesh/纹理**（GPU 脏区最小化）。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/engine/rendering/UICamera.ts` | 新增静态 `computeContainFrustum(w,h)`（共享公式）；`setCanvasSize` 改为复用 |
| `src/engine/ui/UIManager.ts` | 新增 `relayoutForViewport(vw,vh)` + 私有 `relayoutFullscreenRoot`（全屏根判定 + 幂等跳过 + 子树锚点递归重算） |
| `src/engine/gameflow/SceneRendererComponent.ts` | `resize()` 尾部联动 relayout（World 未就绪时跳过）；顺带修正上方一元化前的旧注释（9.6×5.4） |
| `tests/uiViewportRelayout.test.ts` | 新增，14 用例（P0 概念基线 4 + P2 目标 10） |

## 四、边界与已知限制

- **锚定 widget（UIWorldAnchor screen 模式）**：均为顶层 Actor（`spawnAnchoredWidget` 强制），不在全屏根子树内，重排不触碰；其 position 由锚定 tick 每帧重写，天然自洽。
- **伤害数字 / 战利品飞行**：根无锚（anchor=null），`applyAnchor` 对其 no-op；挂在全屏根子树内也不受影响。
- **UILayout 行**：行内条目间距保持设计 px（不缩放）；行本身位置经锚点重算跟随新容器。
- **GM 控制台**：独立 HUD 实例不重排（控制台是调试工具，低优先级；后续需要时把 `relayoutFullscreenRoot` 扩展到全部 HUD 实例）。
- **world 模式面板**：挂主场景、位姿由 3D 世界决定，与视锥无关。

## 五、HTML 源侧配套：两轴 100% → stretch 映射（2026-09-04 二期）

base_hud 实测暴露的盲区闭环：运行时重排只对**锚点子节点**生效，但存量 HUD 的全屏容器层（TopBar）由 HTML 固定 px 写法编译为 `center + 1920×1080` 快照——根面板重排变大，center 容器居中不动，整个 HUD 纹丝不动（日志证实重排在跑、视觉零变化）。

**方案**：CSS 层补上"铺满父容器"的原生表达——`position: absolute` 且两轴 `100%` → 发射 `stretch` 全锚（与运行时 `applyAnchor` stretch 分支"填满父容器、父变即跟随"语义对接）。单轴 100% 不映射（保持九宫格推导，行为不变）。反编译端 stretch → 回写 `width/height: 100%` + `left/top: 0%`，构成 round-trip 不动点（编辑器保存不再退化回 center）。

| 文件 | 改动 |
|---|---|
| `src/editor/asset/uiCompiler/compile.ts` | `buildTransform` absolute 分支：两轴 100% 解算恰等包含块 → `anchor: stretch` + 父尺寸世界值（跳过九宫格推导） |
| `src/editor/asset/uiCompiler/decompile.ts` | stretch 节点回写 `width/height: 100%`（替代快照 px）+ `left/top: 0%` |
| `scripts/ui-compiler-smoke.ts` | §8 用例：stretch 映射 + round-trip 不动点 + 单轴边界（TDD：P1 锁 center 现状 → 实现 → P2 断言） |
| `base_hud.widget.html/.json` | `.TopBar` 改两轴 100% 并重编译（`anchor: "stretch"` 落盘，assetLint 零错误） |

手册同步：`doc/editor/ui/ui_widget_html_manual.md` 新增 §7 配方 A2（全屏容器推荐写法）+ §14 坑 15（固定 px 全屏容器是重排盲区）。注意：**流式布局的 100% div 不受影响**（映射仅在 absolute 分支内，锚定 widget 承载 div 的流式写法约定不变，见手册坑 14）。

## 六、执行命令

```bash
npx vitest run tests/uiViewportRelayout.test.ts   # 专项 14/14
npx vitest run                                    # 全量（decompileRoundtrip 为既有失败）
npx tsc --noEmit                                  # 0 错误
```
