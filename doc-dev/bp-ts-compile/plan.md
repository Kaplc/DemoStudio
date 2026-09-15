# 蓝图 TS 源编译方案（.blueprint.ts → .blueprint.json）

> 2026-09-16 定稿。对标 UI 资产 HTML 源格式方案（doc-dev/ui-html-source-format，已实施），
> 把同一套"单一事实源 + 编译器 + assetLint 零错误门槛 + MCP 工具 + 离线 gate"管线移植到蓝图资产。
> **本方案未实施**；实施顺序见 §11。

## 1. 背景与目标

蓝图资产（`.blueprint.json`）目前只能手写 / AI 直编 / 蓝图编辑器 op 维护，没有代码形态的源。
当蓝图含重复结构（N 个同构子节点）、跨文件共享常量、需要表驱动参数时，手写 json 成本高且易漂移。

目标：允许用**普通 TS** 编写蓝图源（`.blueprint.ts`），编译产出与手写格式完全相同的 `.blueprint.json`。

非目标（明确不做）：
- **编辑器往返补丁**：TS 计算值（如 `[0, i * 2.6, 0]`）在 json 里只剩结果，无法回映射到源码。
  一期策略 = 编译资产**源码管辖、编辑器只读**（§8）；声明式字面量子集的 AST 补丁留待真实需求出现再立项。
- 运行时任何改动：BlueprintRegistry / 实例化 / ref 引用 / 游戏侧零改动。
- 不做反编译（json → ts）：widget 侧反编译服务于"手改回写源"，蓝图一期是纯单向。

## 2. 已定策略

| 决策点 | 结论 |
|---|---|
| 源文件 | `asset/blueprints/**/*.blueprint.ts`，与产物同目录同名 |
| 源形态 | 程序化 TS（`defineBlueprint({ build })`），允许循环 / 常量导入 / 表驱动 |
| 产物 | `.blueprint.json`，与手写 json 同格式同待遇（ref 互通、编辑器可预览） |
| 往返 | 一期单向：源码管辖，编辑器保存被拦（§8）；逃生门 = 删 json 里 `sourceHash` 转手写资产 |
| 编译执行环境 | Node（esbuild 现场打包用户 TS 后 import 执行），不依赖编辑器在线 |
| lint 门槛 | 复用 assetLint 全套（doc:blueprint / node / comp），零 error 才落盘 |
| id | 编译器确定性分配（显式 id 可覆盖） |
| sourceHash | `fnv1a(源文件文本)`，与 widget 产物同格式，用于冲突检测 |

## 3. 架构与数据流

```
asset/blueprints/xxx.blueprint.ts          ← 人/AI 只写这个
        │  ① 读源文本 → sourceHash = fnv1a(去 BOM 文本)
        │  ② esbuild bundle（alias '@'→src, cjs, tmp 目录）
        ▼
scripts/bp-compile-main.ts（Node）
        │  ③ import 临时 cjs → default export（defineBlueprint 产物）
        │  ④ compileBlueprint(def) → 规范化 + 确定性 id + 校验
        │  ⑤ assetLint：import checkers barrel + validateWidgetDoc(doc, outPath)
        ▼
asset/blueprints/xxx.blueprint.json        ← 运行时/编辑器只认这个
（BlueprintRegistry glob 只吃 *.blueprint.json，.ts 源不会误入运行时）
```

关键性质：
- **编译产物零特权**：与手写 json 完全同格式，`ref` 可互相引用，蓝图编辑器可打开预览。
- **编译管线离线可用**：全链路 Node，不依赖编辑器 HTTP（与 ui_compile 必须进编辑器不同，
  这也是 bp_compile 的 MCP 实现可以更简单的原因，见 §7）。
- **零运行时风险**：不改 BlueprintRegistry / ActorManagerComponent / 任何游戏代码；回滚 = 删新增文件。

## 4. 源格式规范

### 4.1 文件约定

- 路径：`<project>/asset/blueprints/**/*.blueprint.ts`（内部根 `src/projects/...` 与外部根 `projects/...` 同规则）。
- 命名：`<snake_case>.blueprint.ts`，产物为同目录同名 `.blueprint.json`。
- **必须 default export** `defineBlueprint(...)` 的返回值。
- 依赖规则：只可 import `@/editor/asset/bpCompiler/dsl`（helper）、`import type` 引擎类型、
  工程 gameplay/config 下的纯数据模块。禁止 import 引擎运行时（`@/engine` barrel 会拖入 three 等，
  编译期用不到；误 import 会打包出臃肿 bundle，由 code review 把关，不做机器校验）。
- 确定性约定：`build()` 应为纯函数（禁 `Date.now()` / `Math.random()`），否则每次编译 diff 抖动，
  由作者自负；编译器不强制。

### 4.2 DSL（`src/editor/asset/bpCompiler/dsl.ts`）

```ts
// ── 类型（对齐 src/engine/asset/BlueprintAsset.ts，仅 import type，不引运行时）──
export type Vec3 = [number, number, number]

export interface BpComponentInput {
  baseClass: string
  name?: string
  id?: number                      // 显式 id 优先；缺省由编译器分配
  properties?: Record<string, unknown>
}
export interface BpChildInput {
  name?: string
  id?: number
  ref?: string                     // 与 baseClass 互斥（lint 规则同手写）
  baseClass?: string
  overrides?: Record<string, unknown>
  components?: BpComponentInput[]
  active?: boolean
  children?: BpChildInput[]
}
export interface BpRootInput {
  name: string
  baseClass?: string               // 缺省 'Actor'
  components?: BpComponentInput[]
  children?: BpChildInput[]
}
export interface BlueprintDef { build: () => BpRootInput }

// ── helper ──
export function defineBlueprint(def: BlueprintDef): BlueprintDef   // 恒等函数，仅类型锚点
export function comp(baseClass: string, properties?, name?): BpComponentInput
export function transform(position: Vec3, rotation?: Vec3, scale?: Vec3): BpComponentInput   // 语法糖
export function mesh(properties: Record<string, unknown>): BpComponentInput                  // 语法糖
export function scriptRef(scriptId: string, args?: unknown): BpComponentInput
// 产物 = { baseClass: 'UIScriptComponent', properties: { script, args? } }
```

设计取舍：children 用普通对象字面量（name/baseClass/children 直接写，配合 spread 最灵活），
helper 只做组件层的高频语法糖。组件 properties 一期宽松类型（`Record<string, unknown>`），
schema 校验交给 assetLint comp:* 检查器（它比 TS 类型更权威）；
从 comp schema 生成精确 TS 类型列为 P3 远期。

### 4.3 源文件示例

```ts
// projects/warm-current/asset/blueprints/stars/earth.blueprint.ts
import { defineBlueprint, comp, transform } from '@/editor/asset/bpCompiler/dsl'
import { STAR_DEFS } from './starDefs'   // 跨文件共享参数表（TS 的核心价值）

export default defineBlueprint({
  build: () => {
    const d = STAR_DEFS.earth
    return {
      name: 'EarthActor',
      baseClass: 'EarthActor',
      components: [
        transform([0, 0, 0]),
        comp('SphereMeshComponent', {
          radius: d.radius, segments: [48, 32], color: '#ffffff',
          texture: `asset/textures/${d.texture}`, name: 'EarthMesh', opacity: 1, visible: true,
        }),
        comp('AtmosphereComponent', d.atmosphere),
        ...d.clouds.map((c, i) => comp('CloudLayerComponent', { name: `Cloud${i}`, ...c })),
      ],
      children: [],
    }
  },
})
```

## 5. 编译器模块（`src/editor/asset/bpCompiler/`）

| 文件 | 职责 |
|---|---|
| `dsl.ts` | §4.2 全部类型与 helper。**纯函数、零引擎运行时依赖**（只许 `import type`），保证可被 esbuild 安全打包 |
| `compile.ts` | `compileBlueprint(def, { sourceHash })` 主入口：duck 校验 → 规范化 → 确定性 id → 错误收集 |
| `hash.ts` | `sourceHashOf(text)`。实现 = 把 `uiCompiler/compile.ts:74` 的 `fnv1a` 导出复用（加 `export` 即可，不复制） |

### 5.1 API

```ts
export interface BpCompileError { path: string; rule: string; message: string }
// path 形如 'children[2].components[0].baseClass'，直接指认源构造树中的位置

export type CompileBlueprintResult =
  | { ok: true; doc: BlueprintAsset }     // doc 含 sourceHash
  | { ok: false; errors: BpCompileError[] }

export function compileBlueprint(def: unknown, opts: { sourceHash: string }): CompileBlueprintResult
```

### 5.2 编译步骤

1. **duck 校验 def**：`def` 为对象且 `def.build` 为函数，否则报 `missing-define-blueprint`
   （提示"须 default export defineBlueprint(...) 的返回值"）。
2. **执行 build()** 得根输入；异常捕获包装为 `build-threw` 错误（带原异常 message）。
3. **根规范化**：`name` 非空 string；`baseClass` 缺省补 `'Actor'`；
   顶层出现 `position/rotation/scale` → 报 `top-transform-forbidden`（与手写 lint 规则同语义，
   在编译期提前报、错误指向构造树 path）。
4. **组件/子节点规范化**：components/children 缺省补 `[]`；child 的 `ref`/`baseClass` 互斥校验；
   `ref` 格式 `asset/.../*.blueprint.json` 前置校验（lint 兜底）。
5. **确定性 id 分配**：深度先序遍历，未带显式 id 的子节点从 **10001** 起递增分配
   （跳过已被显式 id 占用的值；根节点不分配 id，与手写约定一致）。分配完成后做全文件唯一性校验。
6. **附 sourceHash**：`doc.sourceHash = opts.sourceHash`（`fnv1a-xxxxxxxx` 格式）。

错误模型：收集全部错误一次返回（不 fail-fast），与 uiCompiler 的 CompileFail 风格一致。

## 6. Node 编译管线

### 6.1 启动器 `scripts/bp-compile-gate.mjs`

照抄 `ui-compile-gate.mjs` 模式：`createRequire(cwd/package.json)` 取 esbuild →
`buildSync` 打包 `scripts/bp-compile-main.ts` 为临时 cjs（`platform:'node'`，无 external）→ 重写
`process.argv` → `import(pathToFileURL(...))`。

### 6.2 主逻辑 `scripts/bp-compile-main.ts`

```
用法: node scripts/bp-compile-gate.mjs <xxx.blueprint.ts> [--check]
```

1. 读源文件文本 → `sourceHash = sourceHashOf(text.replace(/^\uFEFF/, ''))`。
2. esbuild 打包**用户源文件**：
   ```ts
   esbuild.buildSync({
     entryPoints: [srcPath], bundle: true, format: 'cjs', platform: 'node',
     alias: { '@': path.resolve(repoRoot, 'src') },   // ★ 与 vite/vitest 的 '@' 别名对齐
     outfile: path.join(tmpDir, 'bp-def.cjs'), logLevel: 'silent',
   })
   ```
3. `import` 临时产物 → default export 交 `compileBlueprint`。
4. **lint 门槛**：`import '../src/editor/asset/assetLint/checkers/index'`（★ 副作用注册，
   漏了 = getChecker 全空 = lint 假通过，ui-compile-gate.ts:12 同款注释必须带上）→
   `validateWidgetDoc(doc, outPath)`。
   **复用论证**：该函数实为通用 walk+派发（`lintBridge.ts:14`），对 `.blueprint.json` 路径
   `shouldRunUiDesignCheck` 不会误触发 ui-design 检查（`AssetWalker.ts:71` 只认 .widget.json
   后缀或含 CanvasUIComponent 的树）；widget 产物根早已携带 sourceHash 通过 doc:blueprint，
   故 **docCheckers 无需任何改动**。
5. error > 0 → 列出全部 issue（格式与 ui-compile-gate.ts:39-42 一致）→ **exit 4，json 不落盘**；
   编译错误 exit 3；用法/文件错误 exit 1/2（与 ui gate 语义对齐）。
6. `--check` 模式：与磁盘现有 json 深比较（忽略 sourceHash），不一致报 exit 5——供 CI/全量门用。
7. 落盘：`JSON.stringify(doc, null, 2) + '\n'`（与 ui gate 一致）。
   **覆盖语义：源码恒为权威**。若现有 json 的 sourceHash 与本次不同 → 打印
   "⚠ 现有 json 曾被手改，本次以源码为准覆盖"；若现有 json 无 sourceHash（手写资产迁移）→
   打印 "⚠ 迁移转换：手写资产将被编译产物接管"。

### 6.3 npm scripts（package.json）

```json
"bp": "node scripts/bp-compile-gate.mjs",
"bp:all": "node scripts/bp-compile-all.mjs"
```

`bp:all`（可选，P1）：glob `src/projects/*/asset/blueprints/**/*.blueprint.ts` +
`projects/*/asset/blueprints/**/*.blueprint.ts` 逐个编译，任一失败即非零退出。

## 7. MCP 工具 `bp_compile`（editor/mcp-server.mjs）

- 工具定义（ListToolsRequestSchema 数组追加，格式同 `ui_compile` :78）：
  - description：编译蓝图 TS 源（*.blueprint.ts）为 .blueprint.json；Node 侧直编，编辑器离线可用；
    编译后编辑器需刷新（F5）或重开资产页签才能看到新内容。
  - inputSchema：`{ asset: string }`，路径为仓库相对路径（如
    `projects/warm-current/asset/blueprints/stars/earth.blueprint.ts`）或绝对路径。
- handler（CallToolRequestSchema 加分支，格式同 :172）：**不走 callEditor**，
  `execFile('node', ['scripts/bp-compile-gate.mjs', asset], { cwd: <仓库根>, timeout: 30000 })`，
  合并 stdout/stderr 原样返回。单实现（gate 即权威管线），无编辑器侧镜像逻辑。
- 可选 P2：落盘成功后尝试 `callEditor('bp_reload', { asset })`（新增编辑器命令，做
  BlueprintRegistry.invalidate + 已开页签 bump），消除"手动刷新"一步。一期不做。

## 8. 编辑器侧改造

### 8.1 类型（`src/engine/asset/BlueprintAsset.ts`）

`BlueprintAsset` 接口追加：

```ts
/** bp 编译产物标记（.blueprint.ts 的 fnv1a）；运行时忽略，编辑器据此判定"源码管辖" */
sourceHash?: string
```

`ResolvedBlueprint` 不加——`BlueprintRegistry.resolve` 显式构造结果对象，sourceHash 自然出局，
运行时零感知（无需验证也改不到它）。

### 8.2 保存守卫（`src/editor/blueprintEdit/BlueprintEditorService.ts`）

```ts
function isSourceManaged(asset: unknown): boolean {
  return !!(asset as { sourceHash?: string })?.sourceHash
}
```

- `save()`（:387）与 `saveAssetOnly()`（:414）入口处：`isSourceManaged` 命中 → 返回
  `{ ok: false, error: '该资产由 .blueprint.ts 编译生成（源码管辖）：请修改源码后执行 bp_compile；'
   + '如需转手写资产，删除 json 中的 sourceHash 字段' }`。
- 不拦 `apply/applyBatch`（预览态编辑允许，但永远存不进去；错误信息即引导）。

### 8.3 P2：只读提示 UI

`read()` 结果携带 `sourceManaged: true` → `BlueprintEditor.tsx` 顶部 banner
"源码管辖：本资产由 xxx.blueprint.ts 编译"，Inspector 保存按钮置灰。一期只有保存时的错误提示，够用。

### 8.4 刷新语义

外部编译落盘后编辑器**不会**自动重载（与现状一致：json 缓存于打开时机、"编辑器须刷新才吃新内容"）。
一期靠 F5；P2 见 §7 的 bp_reload。

## 9. assetLint / checker：零改动清单

| 项 | 结论 |
|---|---|
| doc:blueprint 根 schema | **不改**。widget 产物根已带 sourceHash + 节点 id 通过现有检查（先例即证明） |
| lintBridge.validateWidgetDoc | **不改，直接复用**。名字带 widget 但实现是通用 walk+三态派发 |
| doc:ui-design | 不会误触发（AssetWalker.ts:71 按后缀/CanvasUI 判定） |
| AssetSource 扫描 | 只收 `*.scene.json|*.blueprint.json|*.widget.json`（AssetSource.ts:17），.ts 源天然不进 lint 全量扫描 |
| run_asset_lint MCP | 不受影响；编译产物与手写 json 同待遇 |

## 10. 测试计划（`tests/bpCompiler.test.ts`）

vitest 直接 `import` fixture 的 `.blueprint.ts`（vite 转译，`@` 别名 vitest.config.ts:9 已有），
**单测不经过 esbuild 打包**（那是 Node 管线的事）：

1. **golden 快照**：样例 def → `compileBlueprint` 输出结构（id 顺序 / 字段形状 / sourceHash 占位）。
2. **id 确定性**：两次编译 `toEqual`；调换 build 返回的 children 顺序，id 跟随节点移动。
3. **显式 id**：保留不覆盖；显式 id 冲突 / 与分配值撞车 → error。
4. **规范化错误**：缺 name、顶层 transform、ref+baseClass 同写、build() 抛异常 → error 带 path。
5. **sourceHash**：同文本同值；格式 `fnv1a-xxxxxxxx`（与 uiCompiler 实现互验）。
6. **lint 集成**：import checkers barrel → `validateWidgetDoc(编译产物, 'x/y.fake.blueprint.json')`
   → 0 error；注入未知 baseClass 组件 → `unknown-kind` error。
7. **scriptRef 形状**：产物 `{ baseClass: 'UIScriptComponent', properties: { script, args? } }`。

Node 管线本身（esbuild 打包 / 落盘 / exit code）由试点迁移做人工验收，不做自动化
（ui-compile-gate 同样无自动化，先例一致）。

## 11. 实施顺序

### P0（主干，一个会话可完成）
1. `uiCompiler/compile.ts` 的 fnv1a 加 `export`；新建 `bpCompiler/`（hash.ts / dsl.ts / compile.ts）。
2. `tests/bpCompiler.test.ts` 全绿。
3. `scripts/bp-compile-gate.mjs` + `scripts/bp-compile-main.ts` + npm script `bp`。
4. MCP `bp_compile` 工具。
5. `BlueprintAsset.ts` 加 `sourceHash?`；`BlueprintEditorService` 保存守卫。

**DoD 验收**：
- [ ] `npm run bp -- projects/warm-current/asset/blueprints/stars/earth.blueprint.ts` 编译 + lint 全绿落盘；
- [ ] 蓝图编辑器打开产物正常预览；游戏运行 spawn 无差异（编译 json 与手写 json 同格式）；
- [ ] 编辑器对带 sourceHash 的资产 Ctrl+S 被拦且提示正确；
- [ ] vitest 全绿；`npx tsc --noEmit` 不引入新错（基线全绿须保持）。

### P1
6. 试点迁移：stars 系列 3 件先行（earth / mars / jupiter + 共享 `starDefs.ts` 参数表），
   验收 = 编译产物与原手写 json **语义等价**（忽略 id / sourceHash 的深度比较）；
7. `bp:all` 全量脚本 + `--check` 模式。

### P2（按需）
8. bp_reload 编辑器命令（编译后免 F5）；BlueprintEditor 只读 banner；
9. skl-create-blueprint-asset skill 补"源码格式"章节（试点验证后再写，避免规则未定型）；
10. P3 远期：从 comp schema 生成组件 properties 的精确 TS 类型。

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| lint 假通过（checker 未注册） | gate 显式 import checkers barrel，注释标注 ★（ui-compile-gate.ts:12 同款坑） |
| esbuild `@` 别名漂移（vite 改了别名这里忘了） | alias 常量集中定义；单测 6 的 fixture 用 `@` 导入，别名坏了单测先红 |
| 用户在源里 import 引擎运行时（拖入 three 等） | 文档约束 + review 把关；一期不做机器校验（打包成功与否本身就是信号） |
| 手改编译产物被下次编译覆盖 | sourceHash 冲突检测 + 覆盖前显式告警（§6.2 步骤 7）；逃生门 = 删 sourceHash 转手写 |
| 非确定性源（random/Date.now）导致 diff 抖动 | 文档约定，作者自负；`--check` 模式会暴露 |
| tsc 基线污染 | 新文件全部走严格 TS；DoD 含 tsc --noEmit 检查 |

## 13. 开放问题（不阻塞 P0）

1. `bp:all` / `--check` 是否进 CI 或 pre-commit——建议先纯手动 npm script，资产量上来再议。
2. P2 banner 与 bp_reload 的优先级——用一段时间后按痛点排。
3. skill 更新时机——试点迁移完成后随 P2 一起。
