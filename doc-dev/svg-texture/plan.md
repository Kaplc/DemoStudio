# SVG 贴图功能实施方案（一期：SVG → CanvasTexture）

> 状态：方案待拍板，未动码。
> 范围：SVG 文件作为贴图资产，两端消费——UI（widget `<img>`）与局内模型（蓝图/组件 texture 属性）。
> 明确不做（二期候选见 §9）：内联 `<svg>` 标签、编译期烘焙 PNG、SVGLoader 挤出 3D 几何、SVG 热重载。

---

## 1. 结论

**路线：运行时浏览器栅格化**。SVG 文本 → 定标 → blob URL → `new Image()` 解码 → 离屏 canvas `drawImage` → `THREE.CanvasTexture`。不引入 three SVGLoader（贴图场景它覆盖度差且多余；浏览器就是最完整的 SVG 渲染器）。

改动总量约 6 处，其中引擎核心只有 1 个新模块 + 2 个分流点，3D 组件（SphereMesh/BoxMesh/Sprite/CloudLayer/ThreeFactory）因统一收口 `loadTexture()` 而**零改动自动获益**。

## 2. 现状衔接点（已核实的代码事实）

| # | 事实 | 位置 |
|---|---|---|
| 1 | UI 渲染底座 = CanvasUIComponent 自绘共享 canvas → CanvasTexture → PlaneGeometry | `src/engine/rendering/CanvasUIComponent.ts:138-144` |
| 2 | UIImage.drawImage 接受任何 CanvasImageSource；loadImage = 裸 `new Image()` + onload redraw，**未过 TextureRegistry.resolve**（widget 里写 `asset/...` 相对路径今天就会 404） | `src/engine/ui/UIImageComponent.ts:141-153` |
| 3 | 3D 贴图统一收口 `loadTexture(path)`：同步返回 Texture、异步填充、按路径缓存、`TextureRegistry.resolve` 翻译打包 URL | `src/engine/rendering/TextureLoader.ts:16-24` |
| 4 | 贴图资产经 `import.meta.glob(?url)` 收集注册，glob 模式为字面量 `'./textures/*.{jpg,png,webp}'`（**vite 静态分析，不能拼变量**） | `projects/warm-current/asset/index.ts:28` |
| 5 | 编译器显式拒绝内联 `<svg>` 标签；`<img>` 标签支持且 src 原样透传（编译期无后缀白名单） | `src/editor/asset/uiCompiler/compile.ts:121`（UNSUPported_TAGS）、`compile.ts:1167`（emitImage） |
| 6 | assetLint 只收 `*.scene.json / *.blueprint.json / *.widget.json`，checker 自注册（kind 派发）；Electron 源有现成 `readTextFile` IPC | `src/editor/asset/assetLint/AssetSource.ts:22`、`electron/preload.ts:133` |
| 7 | `TextureRegistry.resolve`：非 `asset/` 路径原样 passthrough；`asset/` 查表，未注册返回 null | `src/engine/asset/TextureRegistry.ts:61-64` |

## 3. 总体设计（数据流）

```
                         ┌─ UI 端 ──────────────────────────────────────────┐
asset/textures/icon.svg  │  widget html: <img src="asset/textures/icon.svg"> │
        │                │     → 编译器 emitImage 原样透传 src                │
        │ glob(?url)     │     → UIImage.loadImage: .svg 分流                │
        ▼                │       → loadSVGImage(src, 控件尺寸×2) ─┐          │
TextureRegistry ─────────┘                                       │          │
  (打包 URL)                                                     ▼          │
                                                        ┌──────────────┐   │
                         ┌─ 3D 端 ─────────────┐        │ SVGTexture.ts │   │
                         │ 蓝图/组件 texture:   │        │ 定标→fetch→   │   │
                         │ "asset/textures/x.svg"│──────▶│ 注入尺寸→blob │   │
                         │   → loadTexture()    │ 分流   │ →Image→canvas │   │
                         │   （SphereMesh 等    │        └──────┬───────┘   │
                         │    零改动）          │               │           │
                         └─────────────────────┘        UI: canvas 直接画入   │
                                                        3D: CanvasTexture     │
                                                            (同步占位/异步填充)│
                         └──────────────────────────────────────────────────┘
```

## 4. 改动清单

### M1（新增）`src/engine/rendering/SVGTexture.ts`

```ts
export interface SVGRenderOptions {
  /** 光栅化目标宽/高（SVG 用户单位）。缺省 = 根元素 width/height，再缺省 = viewBox 宽高 */
  width?: number
  height?: number
  /** 超采样倍率，默认 2（位图像素 = 目标尺寸 × density，覆盖 4K 缩放） */
  density?: number
}

/** SVG → 离屏 canvas（定标 → fetch → 注入尺寸 → blob → Image → drawImage） */
export function loadSVGImage(url: string, opts?: SVGRenderOptions): Promise<HTMLCanvasElement>

/** loadTexture 的 svg 分流出口：同步返回占位 CanvasTexture、异步填充（与 loadTexture 契约一致） */
export function loadSVGTexture(resolvedUrl: string, opts?: SVGRenderOptions): THREE.CanvasTexture

export function clearSVGTextureCache(): void
```

实现要点：

1. **定标**：目标尺寸解析顺序 `opts` → 根元素 width/height → viewBox 宽高；都无 = throw（lint 会更早拦）。光栅化像素 `pw = round(w × density)`、`ph` 同理，**clamp 到 4096**（GPU 纹理尺寸保守上限）。
2. **尺寸注入**：根元素缺显式 width/height 时 `setAttribute` 注入。只有 viewBox 的 SVG 直接画进 canvas 会得到 Firefox 0×0 / Chrome 300×150（浏览器兼容行为），注入是硬前提。
3. **解码绘制**：`XMLSerializer` 序列化 → `Blob(image/svg+xml)` → `URL.createObjectURL` → `new Image()`（`crossOrigin='anonymous'`）→ onload 后 `canvas(pw,ph).drawImage(img, 0, 0, pw, ph)` → `revokeObjectURL`。
4. **占位契约**（关键设计）：`loadSVGTexture` 同步阶段先建 **1×1 洋红斜纹占位 canvas** 的 CanvasTexture（`colorSpace=SRGBColorSpace`，flipY 走 THREE 默认 true 与 TextureLoader 一致），异步拿到真实尺寸后**重设同一 canvas 的 width/height 再画入**（重设即清空，正好），`texture.needsUpdate = true`。**Texture 实例不变**——材质引用不断，SphereMesh 等调用方零感知。失败路径：logger.error + 保留洋红占位（编辑器里一眼可见坏图，不 crash）。
5. **缓存**：`Map<`${url}|${pw}x${ph}`, CanvasTexture>`；density 不同 = 不同实例。`SVGTexture.ts` 只 import three，**不 import TextureLoader/TextureRegistry**（分流在调用侧完成，避免循环依赖）。

### M2（修改）`src/engine/rendering/TextureLoader.ts`

```ts
export function loadTexture(path: string): THREE.Texture {
  const resolved = TextureRegistry.resolve(path) ?? path
  if (/\.svg($|\?)/i.test(resolved)) return loadSVGTexture(resolved)
  // ...原逻辑不动
}
```

- `clearTextureCache()` 追加 `clearSVGTextureCache()`（两个缓存都要清）。
- 改完这一处，**所有走 texture 路径属性的 3D 组件与蓝图自动获得 SVG 能力**。

### M3（修改）`src/engine/ui/UIImageComponent.ts`

- `loadImage(src)`：
  1. 先 `TextureRegistry.resolve(src)`（passthrough 非 asset/ 路径）——**顺手修复 widget img 写 `asset/...` 路径 404 的既有缺口**（png/webp 同步获益）；
  2. `.svg` 后缀 → `loadSVGImage(resolvedUrl, { width: this._width, height: this._height, density: 2 })` → onload 后 `this._image = canvas`、`redraw()`；
  3. 其余格式走原 `new Image()` 逻辑。
- `_image` 类型 `HTMLImageElement | null` 放宽为 `HTMLImageElement | HTMLCanvasElement | null`（drawImage 本就两者通吃）。
- 定标依据：控件 canvas 位图尺寸即显示尺寸（1单位=1px 体制），`density: 2` 已覆盖 4K。控件后续 resize 不重栅格（v1 接受，见 §8 坑清单）。

### M4（修改）贴图 glob 扩展

`projects/warm-current/asset/index.ts:28`：

```ts
const textureModules = import.meta.glob<{ default: string }>('./textures/*.{jpg,png,webp,svg}', {
  eager: true,
  query: '?url',
})
```

- **glob 模式是 vite 静态分析的字面量，不能提共享常量拼接**——其他项目要用 SVG 时各自照抄此行（写进使用说明）。
- svg 经 `?url` 拿到打包 URL，与 png 同一注册通道（`TextureRegistry.registerGlob`），蓝图引用字符串形态完全一致。

### M5（新增 + 小改）assetLint `doc:svg` checker

- 新文件 `src/editor/asset/assetLint/checkers/svgDocChecker.ts`，`kind = 'doc:svg'`，`registerAssetChecker` 自注册（照 docCheckers.ts 模式）。
- `AssetSource.ts`：
  - `ASSET_EXT_RE` 扩为 `/\.(scene|blueprint|widget)\.json$|\.svg$/i`；
  - ElectronAssetSource 对 `.svg` 走 `api.readTextFile`（preload.ts:133 现成），`AssetFile.doc` 存纯文本字符串；RegistryAssetSource（降级源）跳过 svg 并注释说明。
- `AssetLintEngine.validateDoc`：svg 文件不走 `walkDocument`（那是 JSON 结构遍历），按 `f.ext === '.svg'` 直接派发 `resolveChecker('doc:svg')`；内容指纹缓存（hashOf 对字符串同样适用）照常生效。
- 规则（error 级进门禁）：
  - XML 解析失败（DOMParser `parseerror`）；
  - 根元素既无 viewBox 也无显式 width/height；
  - 外链引用：`href` / `xlink:href` / `src` 属性以 `http(s)://` 或 `//` 开头，`style`/属性中 `url(http...)`；svg 内 `<image href="http...">` 还会造成 **canvas 污染 → 纹理 GPU 上传静默失败**，必须 error；
  - `<script>` 元素、`on*` 事件属性（SVG-in-img 本就不执行，error 防呆）。
  - warn 级：有 viewBox 但缺 width/height（运行时会注入，建议声明）；声明尺寸 > 4096。

### M6（一行修改）编译器文案

`compile.ts:121` UNSUPPORTED_TAGS.svg：

```
svg: 'SVG 不作内联标签支持：存为 asset/textures/*.svg 资产后用 <img src> 引用'
```

内联 `<svg>` 仍是 error（一期不支持），但错误信息从「引擎不支持」变为指路。

### M7（新增）单测 `tests/svgTexture.test.ts`

vitest/jsdom：stub `fetch`、手动触发 Image onload（jsdom 无解码器，参照 UIImage 实例化 stub getContext 先例）。

用例：
1. 无 width/height 有 viewBox → 注入后光栅化 canvas = viewBox × density；
2. 显式 width/height 优先；
3. 缓存：同 url 同 opts 返回同实例；不同 density 不同实例；
4. 非法 SVG → 不 throw，洋红占位 + error 日志；
5. `loadTexture('x.svg')` 分流返回 CanvasTexture；
6. `loadImage('asset/textures/a.svg')` → `_image` 为 canvas 且 redraw 触发（含 resolve 翻译断言）。

## 5. 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 栅格化引擎 | 浏览器 Image + drawImage | Electron 有完整 DOM；SVG-in-img 支持 CSS/滤镜/文本全特性；SVGLoader 覆盖度差且是为「解析成几何」设计的 |
| 返回物 | 离屏 canvas（非 Image） | 尺寸可控可 clamp；UIImage.drawImage 与 CanvasTexture 都直接吃 canvas |
| 3D 占位方式 | 同一 Texture 实例 + canvas 重设尺寸 + needsUpdate | 保住「同步返回异步填充」契约，调用方与材质引用零改动 |
| UI 定标 | 控件 canvas 尺寸 × density 2 | 1单位=1px 下控件位图即显示像素；×2 覆盖 4K；不做 resize 重栅格（记坑） |
| 失败视觉 | 洋红占位 | 与引擎排障习惯一致，坏图一眼可见 |
| 内联 svg | 一期不做 | 编译期提取 dataURL 要连动 decompile 往返与 patch.ts 写回，工程量大收益小 |

## 6. 实施顺序

1. M1 SVGTexture 模块 + M7 单测（纯新增，先行验证）；
2. M2 TextureLoader 分流 + clearTextureCache 联动；
3. M3 UIImage loadImage 分流 + resolve 接入；
4. M4 glob 扩展 + warm-current 放一枚示例 svg（如把 HUD 某图标矢量化）→ 手动目检两端：蓝图球体贴 svg + widget img 引 svg；
5. M5 lint checker + AssetSource 扩展；
6. M6 编译器文案；
7. 回归：`npx tsc --noEmit` 全绿 + vitest 套件 + warm e2e 与基线对照（基线 6 失败，判新失败先 stash 对照）。

## 7. 验收标准

1. `asset/textures/*.svg` → 蓝图 `SphereMeshComponent.texture` 引用 → 进图球面显示 SVG 内容（目检截图）；
2. widget HTML `<img src="asset/textures/x.svg">` → ui_compile 零错误 → 运行时 UIImage 正常显示；
3. 坏 svg（无尺寸 / 外链 / script）→ assetLint 面板 error，好 svg 零警告；
4. `tsc --noEmit` 全绿、新单测全绿、既有 e2e 与基线一致。

## 8. 已知坑清单（实施时对照）

- **import.meta.glob 模式必须字面量**（vite 静态分析），不能共享常量拼后缀表；
- **SVG-in-img 是静态快照**：不执行脚本、不加载外链图片/外部字体（缺内容不报错）→ lint 拦外链；SVG 内文字要转 path 或内嵌字体子集；
- **canvas 污染**：svg 内引用 http 资源 → canvas taint → CanvasTexture GPU 上传**静默失败**（无报错）→ lint error 硬拦；同源/blob/dataURL 安全；
- **只有 viewBox 的 SVG**：直接画 = Firefox 0×0 / Chrome 300×150 → 运行时注入兜底 + lint 双保险；
- **纹理尺寸**：光栅化 clamp 4096；非 2 的幂尺寸 WebGL2 下 mipmap 完整支持（three r150+ 默认 WebGL2），无需 POT 取整；
- **UI resize 不重栅格**：控件显示尺寸变更后 svg 位图沿用旧尺寸（缩小无碍、放大会糊）；出现实际需求再加 resize 钩子重栅格；
- **SVG 热改不生效**：与现有贴图行为一致，改文件后重进场景/刷新（vite dev 下 fetch 拿最新内容，但缓存键不变）；
- **vitest 无解码器**：Image onload 须手动触发；DOMParser jsdom 可用。

## 9. 不做清单（二期候选，按需另立）

- 内联 `<svg>` 编译期提取为 dataURL（连动 decompile/patch 往返）；
- 编译期烘焙 PNG（发布优化：图标集批量 @1x/@2x 烘焙）；
- `SVGExtrudeComponent`（SVGLoader.createShapes + ExtrudeGeometry，真矢量 3D 模型/立体 logo）；
- tint 变体缓存（同 svg 多色渲染 `svgTexture(path, {tint})`）；
- SVG 内容热重载。
