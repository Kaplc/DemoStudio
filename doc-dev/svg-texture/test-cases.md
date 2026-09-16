# SVG 贴图功能测试用例

> 配套 [plan.md](./plan.md)（M1–M7 改动项）。用例分级：**UT** 单测（`tests/svgTexture.test.ts`）、**LT** assetLint、**MT** 手动目检、**RT** 回归。
> 优先级：P0 = 一期验收必须全绿；P1 = 应绿，挂了要给说法；P2 = 观察项。

---

## 1. 测试资产样本

实施时先落一组标准样本到 `projects/warm-current/asset/textures/svgtest/`（验收后可删或留作示例）。下表供直接复制：

| 样本文件 | 内容要点 | 用途 |
|---|---|---|
| `ok.svg` | 根元素带 `width="64" height="64" viewBox="0 0 64 64"`，内画一个红圆 | 基准好图 |
| `viewbox_only.svg` | 只有 `viewBox="0 0 24 24"`，无 width/height | 注入兜底 + lint warn |
| `no_size.svg` | 既无 viewBox 也无宽高（一根 path） | lint error + 运行时 throw 路径 |
| `external_ref.svg` | `<image href="https://example.com/a.png">` | lint error（taint 防呆） |
| `bad_xml.svg` | 标签不闭合（`<svg><circle<...`） | lint error + DOMParser parseerror |
| `script.svg` | 内含 `<script>alert(1)</script>` | lint error |
| `oversize.svg` | `width="8192" height="8192"` | lint warn + 4096 clamp |

## 2. UT — 单元测试（`tests/svgTexture.test.ts`）

环境：vitest + jsdom；stub `fetch`（返回样本文本）、手动触发 `Image` onload（jsdom 无 SVG 解码器）；`UIImage` 实例化 stub getContext（既有先例）。

| 编号 | 用例 | 前置/输入 | 操作 | 预期 | 优先级 |
|---|---|---|---|---|---|
| UT-01 | 显式尺寸优先 | `ok.svg`（64×64） | `loadSVGImage(url, { density: 2 })` | canvas 128×128（64×2） | P0 |
| UT-02 | viewBox 注入 | `viewbox_only.svg`（24×24） | `loadSVGImage(url)` | 根元素被注入 width/height=24，canvas 48×48 | P0 |
| UT-03 | opts 覆盖固有尺寸 | `ok.svg` | `loadSVGImage(url, { width: 200, height: 100, density: 1 })` | canvas 200×100 | P0 |
| UT-04 | 4096 clamp | `oversize.svg`（8192², density 2） | `loadSVGImage(url)` | canvas 4096×4096（clamp 生效，非 16384） | P1 |
| UT-05 | 非法 XML 不 throw | `bad_xml.svg` | `loadSVGImage(url)` | Promise resolve，返回洋红占位 canvas，error 日志 | P0 |
| UT-06 | 缓存同实例 | `ok.svg` | `loadSVGTexture(url)` 调两次 | 返回同一 Texture 实例 | P0 |
| UT-07 | density 进缓存键 | `ok.svg` | `loadSVGTexture(url)` 与 `loadSVGTexture(url, { density: 4 })` | 两个不同实例 | P0 |
| UT-08 | 同步返回契约 | `ok.svg`（fetch 挂起未完成时） | `loadSVGTexture(url)` 立即检查 | 同步拿到 CanvasTexture（占位态），texture.isCanvasTexture = true | P0 |
| UT-09 | 异步填充不换实例 | UT-08 的 texture | await onload 后检查 | 同一实例 `needsUpdate === true`，canvas 尺寸已为真实光栅化尺寸 | P0 |
| UT-10 | 纹理属性 | `loadSVGTexture` 返回值 | 检查 colorSpace / flipY | `colorSpace === SRGBColorSpace`，`flipY === true`（与 TextureLoader 一致） | P1 |
| UT-11 | 缓存清空 | 已有缓存 | `clearSVGTextureCache()` 后再 `loadSVGTexture` | 返回新实例；旧 texture `dispose()` 被调 | P1 |
| UT-12 | loadTexture 分流 | TextureRegistry 注册 `asset/textures/svgtest/ok.svg` | `loadTexture('asset/textures/svgtest/ok.svg')` | 返回 CanvasTexture（走 SVG 分支），resolve 后 URL 作缓存键 | P0 |
| UT-13 | loadTexture 非 svg 不受影响 | 已注册 png | `loadTexture('asset/textures/earth.png')` | 行为与改前一致（TextureLoader 路径，非 CanvasTexture） | P0 |
| UT-14 | UIImage svg 分流 | UIImage 构造 `{ src: 'asset/textures/svgtest/ok.svg' }`，控件 100×100 | await loadImage 完成 | `_image` 为 HTMLCanvasElement，光栅化尺寸 = 100×100×2 = 200×200，redraw 触发 | P0 |
| UT-15 | UIImage resolve 翻译 | 同上但用 png src | 检查 `new Image()` 收到的 src | 已过 `TextureRegistry.resolve`（asset/ → 打包 URL；非 asset/ 原样） | P0 |
| UT-16 | 无尺寸 SVG 运行时 | `no_size.svg` | `loadSVGImage(url)` | reject/占位（按 M1 实现取一，与 lint error 对应），error 日志，不 crash | P1 |

## 3. LT — assetLint（`doc:svg` checker）

用 §1 样本扫描（AssetLintEngine 全量扫描或单文件触发），核对 issue 的 rule/severity/nodePath：

| 编号 | 输入 | 预期 issue | 优先级 |
|---|---|---|---|
| LT-01 | `ok.svg` | 0 issue | P0 |
| LT-02 | `bad_xml.svg` | error：XML 解析失败（含行信息） | P0 |
| LT-03 | `no_size.svg` | error：无 viewBox 且无显式宽高 | P0 |
| LT-04 | `viewbox_only.svg` | warn：建议声明 width/height | P0 |
| LT-05 | `external_ref.svg` | error：外链引用（href http） | P0 |
| LT-06 | `style="fill:url(http://…)"` 变体 | error：外链 url() | P1 |
| LT-07 | `script.svg` | error：`<script>` 元素 | P1 |
| LT-08 | `onload="…"` 属性变体 | error：on* 事件属性 | P1 |
| LT-09 | `oversize.svg` | warn：声明尺寸 > 4096 | P2 |
| LT-10 | 收集范围 | AssetSource 只增收 `.svg`，不误收其他扩展名；RegistryAssetSource 降级源静默跳过 svg | P1 |
| LT-11 | 指纹缓存 | 同一 svg 二次扫描内容未变 → 复用缓存 issue（日志无重复 walk） | P2 |

## 4. MT — 手动目检（dev server + 编辑器）

> 教训引用：headless 截图有伪影（troika 随机缺失/3fps 合成不可靠），svg 贴图目检以**真实浏览器整页 screenshot** 或肉眼为准。

| 编号 | 场景 | 操作 | 预期 | 优先级 |
|---|---|---|---|---|
| MT-01 | 3D 端贴图 | 临时蓝图：SphereMeshComponent `{ texture: "asset/textures/svgtest/ok.svg" }`，▶ 进图 | 球面显示红圆图案；加载瞬间无洋红残留（或一闪而过属正常） | P0 |
| MT-02 | UI 端 img | warm HUD widget 加 `<img src="asset/textures/svgtest/ok.svg" style="width:64px;height:64px">` → ui_compile → 刷新进图 | 图标按 64×64 显示、图案清晰（非模糊/拉伸变形） | P0 |
| MT-03 | 编辑器资产浏览 | 资产浏览器定位 svgtest 目录 | svg 可预览（或至少不出错、有扩展名标签） | P2 |
| MT-04 | 坏图占位可见性 | 临时把球 texture 指到 `bad_xml.svg` | 球面呈洋红占位 + Console error 日志，不 crash | P1 |
| MT-05 | 放大清晰度 | MT-02 的 img 放大到 256×256 | 边缘仍平滑（density 2 下 128px 位图放大约 2 倍，可接受；锐利度明显劣化则说明定标策略要调） | P2 |
| MT-06 | 编译器指路文案 | widget html 写内联 `<svg>…</svg>` → ui_compile | error 信息为「存为 asset/textures/*.svg 资产后用 <img src> 引用」（非旧文案「引擎不支持」） | P1 |
| MT-07 | 工程切换缓存 | MT-01 通过后切工程再切回，重进图 | 贴图正常（clearTextureCache 联动生效，无残废纹理） | P1 |

## 5. RT — 回归

| 编号 | 项目 | 通过标准 | 优先级 |
|---|---|---|---|
| RT-01 | `npx tsc --noEmit` | 根项目 0 错误 | P0 |
| RT-02 | vitest 既有套件 | 与改前基线一致 + UT 全绿 | P0 |
| RT-03 | warm e2e | 与基线一致（基线 6 失败：click_actor_raycast×2 / hud / route_lane / save_menu / view_toggle）；判新失败先 `stash` 自己的改动对照 | P0 |
| RT-04 | ui-compile-gate / smoke | `scripts/ui-compile-gate.mjs` 冒烟无新增错误（M6 只改文案，理论零影响） | P1 |
| RT-05 | 既有贴图链路 | warm 进图：地球等 png 贴图正常（loadTexture 非 svg 分支零回归） | P0 |

## 6. 通过标准汇总（一期验收）

1. UT-01/02/05/06/08/09/12/13/14/15 全绿（P0 集合）；
2. LT-01～05 全绿；
3. MT-01、MT-02 目检通过；
4. RT-01/02/03/05 与基线一致。
