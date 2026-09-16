# 测试用例：蓝图 TS 源编译（.blueprint.ts → .blueprint.json）

> 对应方案：同目录 `plan.md` ｜ 用例总数：48 ｜ 优先级标注：P0 必须自动化（或验收门槛）/ P1 建议自动化 / P2 手工观察
>
> 前置说明：A/B 两组为纯函数/进程内校验，全部可 vitest 自动化（`tests/bpCompiler.test.ts`）；
> C/D 组走 Node CLI 与 MCP 工具（AI 会话内可直接验收）；E/F 组涉及编辑器与游戏运行，人工验收；
> 编译器单测**不经 esbuild 打包**（打包行为本身由 C 组覆盖）。

## fixture 与环境约定

- 单测 fixture 全部**内联**在 `tests/bpCompiler.test.ts`（直接构造 `defineBlueprint` 返回的 def 对象），
  不建独立 `.ts` fixture 文件。
- lint 集成测试（B 组）两处强制前置：
  1. `import '../src/editor/asset/assetLint/checkers/index'`（副作用注册 checker，漏了 = lint 假通过，
     `scripts/ui-compile-gate.ts:12` 同款坑）；
  2. `import '@/engine'`（组件工厂注册；三态派发判 unknown 依赖工厂在册——vitest 引擎级既有坑）。
- 集成断言用的伪文件路径后缀**必须**是 `.blueprint.json`（避免 `shouldRunUiDesignCheck` 误触发
  ui-design 检查干扰断言；ui-design 正反两向单独在 TC-B4 验证）。

## A. 编译器纯函数（compileBlueprint）

### TC-A1 golden 快照 【P0】

- **输入**：
  ```ts
  const def = defineBlueprint({ build: () => ({
    name: 'Demo',
    components: [transform([0, 0, 0]), comp('MeshComponent', { geometry: 'box', size: [2, 1, 2] })],
    children: [
      { name: 'Pylon', baseClass: 'Actor', components: [transform([0, 1, 0])] },
      { name: 'Dock', ref: 'asset/blueprints/dock.blueprint.json' },
    ],
  })})
  compileBlueprint(def, { sourceHash: 'fnv1a-00000000' })
  ```
- **预期**：`ok: true`，doc 结构 = `{ name, baseClass: 'Actor', components[2], children[2], sourceHash }`；
  children[0].id = 10001、children[1].id = 10002（先序递增）；transform 产物 =
  `{ baseClass: 'TransformComponent', properties: { position, rotation, scale } }`（未传的轴补零值）；
  ref 节点无 baseClass 键。

### TC-A2 id 确定性 【P0】

- **步骤**：同一 def 编译两次 `toEqual`；调换 build 返回的 children 数组顺序后再编译。
- **预期**：两次编译深度相等；调换顺序后 id 跟随节点移动（id 属于节点内容序，不粘位置）。

### TC-A3 显式 id 保留与冲突 【P0】

- **步骤**：子节点带显式 `id: 20001` 编译；两个子节点带相同显式 id 编译；显式 id 为 0 / 负数 / 非整数。
- **预期**：显式 id 原样保留且分配器跳过该值（下一个无 id 节点拿 10002 而非撞 20001）；
  重复显式 id → `duplicate-id` error 带 path；非法 id 值 → error。

### TC-A4 缺省值补齐 【P0】

- **步骤**：build 返回仅 `{ name: 'X' }` 的根；子节点省略 components/children。
- **预期**：根补 `baseClass: 'Actor'`、`components: []`、`children: []`；子节点同样补齐；
  产物不含 undefined 键（JSON 序列化后无残缺字段）。

### TC-A5 错误收集不 fail-fast 【P0】

- **步骤**：构造同时含 ≥2 处错误的 def（如顶层 transform + ref/baseClass 同写）。
- **预期**：一次返回全部 error（`ok: false`，errors.length ≥ 2），每条含
  `{ path, rule, message }`，path 形如 `children[0]` / `<根>`。

### TC-A6 顶层 transform 禁止 【P0】

- **步骤**：build 返回根带 `position: [0,0,0]` 字面量。
- **预期**：`top-transform-forbidden` error，path = `<根>`，message 引导写进 TransformComponent。

### TC-A7 ref/baseClass 互斥 【P0】

- **步骤**：同一子节点同时带 `ref` 与 `baseClass`；两者都缺。
- **预期**：分别报 `child-bp-ref-conflict` / `child-missing-type` error（规则名与 lint 对齐）。

### TC-A8 ref 路径格式前置校验 【P1】

- **步骤**：`ref: 'blueprints/dock.json'`（不以 `asset/` 开头）与 `ref: 'asset/x/y.json'`（后缀错）。
- **预期**：`ref-invalid-path` error（lint 兜底之前在编译期就报，path 指认到该子节点）。

### TC-A9 build() 抛异常 【P0】

- **步骤**：build 内 `throw new Error('boom')`。
- **预期**：`ok: false`，单条 `build-threw` error，message 含原始 'boom'，不产生半成品 doc。

### TC-A10 非 defineBlueprint 输入 【P0】

- **步骤**：`compileBlueprint(undefined, …)`、`compileBlueprint({}, …)`、`compileBlueprint({ build: 'x' }, …)`。
- **预期**：均 `missing-define-blueprint` error，message 提示"须 default export defineBlueprint(...) 的返回值"。

### TC-A11 scriptRef 产物形状 【P0】

- **步骤**：`scriptRef('gameplay/ui/HudScript')` 与 `scriptRef('x/y', { a: 1 })` 分别进组件数组编译。
- **预期**：产物 `{ baseClass: 'UIScriptComponent', properties: { script: '...' } }`；
  带 args 时 `properties.args = { a: 1 }`，不带时**无** args 键（与 emitDataScript 行为一致）。

### TC-A12 sourceHash 附着 【P0】

- **步骤**：同 sourceHash 编译两次；`sourceHashOf('abc')` 与 `uiCompiler/compile.ts` 的 fnv1a('abc') 互验。
- **预期**：doc.sourceHash 原样附着；`sourceHashOf` 与 widget 侧同格式同值（`fnv1a-xxxxxxxx`）。

### TC-A13 深层嵌套先序 id 【P1】

- **步骤**：3 层嵌套树（root → children[0] → children[0].children[0] → …，每层 2 个子节点）编译。
- **预期**：id 按深度先序分配（父先于子、同级按数组序）：10001, 10002(第一子层的第一个孙), …；
  全文件唯一。

### TC-A14 active/overrides 透传 【P1】

- **步骤**：子节点带 `active: false` 与（ref 节点）`overrides: { … }`。
- **预期**：两字段原样出现在产物对应节点；不触发 id 之外的形状改写。

## B. lint 集成（checkers barrel + validateWidgetDoc）

### TC-B1 编译产物零错误门槛 【P0】

- **步骤**：TC-A1 的产物 `validateWidgetDoc(doc, 'tests/fake/x.blueprint.json')`（先 import checkers barrel）。
- **预期**：severity = 'error' 的 issue 为 0（warn 允许存在并回显）。

### TC-B2 未知组件拦截 【P0】

- **步骤**：def 里 `comp('NotARealComponent', {})` 编译后过 lint（须先 import '@/engine' 注册工厂）。
- **预期**：`unknown-kind` error（三态派发：无 checker 且无工厂）→ 若在 gate 里将 exit 4 不落盘。

### TC-B3 name 重复由 lint 兜底 【P0】

- **步骤**：两个同名 children 编译后过 lint。
- **预期**：编译器**不**报 name 重复（设计如此），lint 报 `duplicate-name` error。

### TC-B4 ui-design 正反两向 【P0】

- **步骤**：正向 = 3D 蓝图（无 CanvasUI）过 lint；反向 = 构造含 CanvasUIComponent 的树过 lint。
- **预期**：正向无任何 `ui:` 系 issue（`.blueprint.json` 路径不触发设计检查）；反向触发
  doc:ui-design（含 `ui:root-anchor` 等规则）——UI 蓝图经 TS 编译同样被设计规则覆盖。

## C. Node 管线（scripts/bp-compile-gate.mjs）

### TC-C1 正常编译落盘与幂等 【P0】

- **步骤**：`node scripts/bp-compile-gate.mjs <合法源>` 连跑两次，对比两次产物字节。
- **预期**：exit 0；stdout 含 `✅ assetLint 通过（已注册 checker: …）` 与
  `✅ 编译+lint 落盘: …（sourceHash=fnv1a-…）`；产物 2 空格缩进 + 末尾换行；**两次产物逐字节一致**。

### TC-C2 编译错误 exit 3 不落盘 【P0】

- **步骤**：注入 TC-A6 类错误源编译（磁盘已有旧 json）。
- **预期**：exit 3，stderr 逐条列 `path: message`；旧 json 内容与 mtime 不变。

### TC-C3 lint 门槛 exit 4，warn 放行 【P0】

- **步骤**：源产出 lint error（未知组件）编译；再构造仅 warn（schemaless 组件）源编译。
- **预期**：error → exit 4 不落盘且逐条打印 `[ruleId] nodePath > field: message`（ui gate 同格式）；
  仅 warn → 正常落盘，warn 回显。

### TC-C4 用法与文件错误 【P0】

- **步骤**：无参数调用；传不存在路径。
- **预期**：exit 1（打印用法文案）/ exit 2。

### TC-C5 '@' 别名哨兵 【P0】

- **步骤**：fixture 源 `import { defineBlueprint, … } from '@/editor/asset/bpCompiler/dsl'` +
  相对导入工程内数据模块，走完整 gate。
- **预期**：打包执行成功——本用例即别名漂移哨兵（vite/vitest 改别名而 gate 未跟时此用例先红）。

### TC-C6 覆盖语义三分支 【P0】

- **步骤**：分别以 a) 磁盘已有无 sourceHash 手写 json；b) 有 sourceHash 但与本次不同；
  c) sourceHash 相同——三种前置重编译。
- **预期**：三种都覆盖落盘；a 打印"迁移转换"告警、b 打印"曾被手改，以源码为准"告警、c 无告警。

### TC-C7 --check 模式 【P0】

- **步骤**：编译后立即 `--check`；手改磁盘 json（改一个数值）再 `--check`；删掉磁盘 json 再 `--check`。
- **预期**：exit 0 / exit 5 / exit 5；比较忽略 sourceHash 字段；错误输出指明首个差异 path。

### TC-C8 非确定性源暴露 【P1】

- **步骤**：build 里掺 `Math.random()`，连续两次编译后 `--check`。
- **预期**：产物不稳定 → `--check` exit 5（演示确定性约定未被遵守时的表现，文档引用）。

### TC-C9 临时产物复用 【P1】

- **步骤**：连续编译 ≥5 次，检查 tmp 目录（demostudio 同款固定名策略）。
- **预期**：临时 cjs 覆盖复用，无累积垃圾文件。

## D. MCP 工具（bp_compile）

### TC-D1 正常调用 【P0】

- **步骤**：MCP `bp_compile` 传仓库相对路径（如 `projects/warm-current/asset/blueprints/stars/earth.blueprint.ts`）。
- **预期**：返回文本含 gate 的 stdout（✅ 两行）；磁盘 json 已更新。

### TC-D2 失败透传 【P0】

- **步骤**：对 TC-C2/C3 的坏源调用工具。
- **预期**：返回 ❌ 错误清单全文，**不**误报成功（AI 可据 path/message 一次修正——对应 ui_compile
  TC-E2 的"错误面向源文件"体验）。

### TC-D3 编辑器离线可用 【P0】

- **步骤**：编辑器进程未启动（9877 无监听）时调用工具。
- **预期**：编译成功（spawn 不依赖 callEditor）；对照 `ui_compile` 此时报"编辑器不可达"。

### TC-D4 死循环超时保护 【P1】

- **步骤**：build 内 `while(true){}`，调用工具。
- **预期**：30s 超时返回错误文本；mcp-server 进程本身不挂死，后续工具调用正常。

## E. 编辑器侧（sourceHash 守卫与运行时无感）

### TC-E1 保存被拦 【P0】

- **步骤**：蓝图编辑器打开编译产物 → Inspector 改属性 → Ctrl+S。
- **预期**：`save` 返回 `ok: false`，错误文案含三要素：源码管辖（改 `.blueprint.ts`）、
  重编译（bp_compile）、逃生门（删除 json 中 sourceHash 转手写）。工作副本改动不落盘。

### TC-E2 saveAssetOnly 同守卫 【P0】

- **步骤**：对带源资产走 dispatch save / saveAssetOnly 路径。
- **预期**：同样被拦，文案一致。

### TC-E3 只拦落盘不拦编辑 【P0】

- **步骤**：带源资产执行 read / 预览重建 / Inspector 属性修改 / 撤销重做。
- **预期**：全部正常（守卫仅在 save/saveAssetOnly 入口），无其他功能回归。

### TC-E4 逃生门转手写 【P0】

- **步骤**：手删 json 中 `sourceHash` 字段 → 重新打开 → 保存。
- **预期**：保存成功，恢复手写资产语义；随后再编译触发 TC-C6.b"曾被手改"覆盖告警。

### TC-E5 刷新语义确认 【P2】

- **步骤**：外部编译落盘后观察已打开的资产页签，再 F5 / 重开页签。
- **预期**：旧内容保持到刷新为止（预期行为，防误判 bug）；刷新后为新内容。

### TC-E6 运行时无感知 【P0】

- **步骤**：游戏运行 `BlueprintAsset.Instantiate('asset/blueprints/stars/earth')`；
  检查 `BlueprintRegistry.resolve` 产物字段。
- **预期**：spawn 成功且组件/属性与手写版一致；resolve 产物**无** sourceHash 字段
  （运行时零感知的最终证明）。

## F. 试点迁移（stars 系列）

### TC-F1 earth 迁移语义等价 【P0】

- **步骤**：编写 `earth.blueprint.ts`（星环参数进共享 `starDefs.ts`）→ 编译 → 与原手写
  `earth.blueprint.json` 深度比较（一次性 node 脚本，忽略 id/sourceHash）。
- **预期**：语义等价（组件集合、逐属性值一致；数组顺序允许按源定义序）。

### TC-F2 mars/jupiter 同等迁移 【P0】

- **步骤**：同 TC-F1，三件共享同一张 starDefs 参数表。
- **预期**：各自语义等价——表驱动一改三份的 TS 价值得到实证。

### TC-F3 全量 lint 【P0】

- **步骤**：迁移后 `run_asset_lint`（warm-current 工程）。
- **预期**：0 error（warn 与迁移前基线一致）。

### TC-F4 游戏内观感一致 【P1】

- **步骤**：进图对比地球/火星/木星渲染（自转、云层、大气壳）与迁移前。
- **预期**：视觉一致（headless 截图法参照 warm-headless-visual-check 记忆条目；注意 WebGL 须整页截图合成）。

### TC-F5 tsc 基线 【P0】

- **步骤**：`npx tsc --noEmit`。
- **预期**：保持全绿（基线本就全绿，新增文件不得引入报错）。

### TC-F6 vitest 回归 【P0】

- **步骤**：跑既有 vitest 套件。
- **预期**：无回归（新增 tests/bpCompiler.test.ts 全绿）。

## G. 边界与防御

### TC-G1 大树与深嵌套 【P2】

- **步骤**：程序生成 200 节点 / 20 层嵌套的 def 编译。
- **预期**：< 1s 量级完成，无栈溢出，id 分配正确。

### TC-G2 循环导入 【P2】

- **步骤**：源 A import B、B import A，走 gate。
- **预期**：esbuild 报错信息可读（指向循环链），exit 非 0，不产出半成品 json。

### TC-G3 误 import 引擎运行时 【P2，观察项】

- **步骤**：源内 `import { BehaviourScript } from '@/engine'`（运行时导入而非 type-only），走 gate。
- **预期**：记录实际表现（打包体积/执行报错与否），结论写进作者文档约束条目；一期不做机器校验。

### TC-G4 Windows 文件占用 【P2】

- **步骤**：编辑器同时持有该 json（写入竞争）时触发编译落盘。
- **预期**：写盘异常时 exit 非 0 并报错；不静默吞掉。已知边界：writeFileSync 非原子，
  极端竞争可能半写——源码恒为权威，重跑编译即恢复（文档注明）。

### TC-G5 BOM 源文件 【P1】

- **步骤**：带 UTF-8 BOM 的 `.blueprint.ts` 走 gate。
- **预期**：sourceHash 按去 BOM 文本计算（与 uiCompiler `source.replace(/^\uFEFF/, '')` 同规则），
  编译正常，产物与无 BOM 版一致。

## 用例 × 优先级汇总

| 组 | 数量 | P0 | P1 | P2 |
|---|---|---|---|---|
| A 编译器纯函数 | 14 | 11 | 3 | 0 |
| B lint 集成 | 4 | 4 | 0 | 0 |
| C Node 管线 | 9 | 7 | 2 | 0 |
| D MCP 工具 | 4 | 3 | 1 | 0 |
| E 编辑器侧 | 6 | 5 | 0 | 1 |
| F 试点迁移 | 6 | 5 | 1 | 0 |
| G 边界与防御 | 5 | 0 | 1 | 4 |
| 合计 | 48 | 35 | 8 | 5 |
