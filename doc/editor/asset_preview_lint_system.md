# 资产预览与检查系统（Editor Preview & AssetLint）

> 资产预览（场景/蓝图/UI widget）与资产检查器（assetLint）双引擎。
> 代码位置：`src/editor/asset/`
> 相关文档：[系统总览](../system_overview.md) / [渲染系统](../engine/rendering_system.md)

## 1. 概述

编辑器资产模块包含两大引擎：

1. **预览引擎**：三类资产（场景/蓝图/UI widget）的独立预览管理器，共享同一套公开接口
2. **检查引擎**：`assetLint` 资产检查器（零 lint 错误是资产创建硬性要求）

## 2. 预览系统

### 核心管理器

| 类 | 说明 |
|---|---|
| `AssetPreviewManager` | 资产预览统一入口（按资产类型分发）；`register(path, instance)` / `get(path)` / `setActive(path)` |
| `ScenePreviewManager` | 场景资产预览（含 `PreviewSceneManager`：fly 飞越 / orbit 轨道 + WASD 漫游） |
| `BlueprintPreviewManager` | 蓝图资产预览（3D Actor 实例化预览） |
| `UIPreviewManager` | UI widget 资产预览（2D 正面预览） |
| `RuntimeUIEditor` | 运行时 UI 编辑 |

### 统一接口

```
loadBlueprint / getActorTree / collectSaveData / selectActor / focusActor /
activate / resize / dispose
```

便于 BlueprintEditor 与 Outline 无缝切换使用。

### UIPreviewManager 设计要点

- 独立 THREE.Scene + OrthographicCamera（Z 正对 UI，无透视变形）
- 专用 WebGLRenderer（无光照/网格辅助——UI 用 MeshBasicMaterial 不需要光照）
- 交互：左键/右键平移 · 滚轮缩放（调 zoom）· WASD 平面平移
- 内置 World + UIManager 实例化 widget 蓝图
- `fitToActor` 以根 Actor 直接挂载的画布 mesh 为基准（忽略子文本过大的 worldWidth）
- 自动清理（dispose）

### ScenePreviewManager 场景嵌套（2026-08-17 起）

- 场景 `actor`/`ref` 节点支持 `children` 递归子对象；预览经 onSpawn 回调（深度优先先序 + 路径栈）构建 Actor→JSON 节点/路径映射
- 大纲在 ref 实例内部只显示场景自有子对象（`_actorJsonMap` 登记），蓝图内部结构不展开
- 结构编辑（`addSceneObject`/`removeSceneObject`/`duplicateSceneObject`/`renameSceneObject`）复用快照撤销：提交时 push 基准快照 + 全量重建预览；undo/redo 结构不一致时自动回退为「注册表/快照重载 + 重建」，transform/属性编辑仍走原地回滚
- assetLint 同步：`doc:scene` 同父重名校验、`node:ref` 支持 `children` 字段、walker 递归派发 ref 子节点

## 3. 使用方法

### 3.1 预览系统入口

| 方法 | 签名 | 说明 |
|---|---|---|
| 注册 | `AssetPreviewManager.register(path, instance)` | 注册时自动 `watchWorldActorChanges`（大纲即时刷新）；key = 资产磁盘相对路径 |
| 查询 | `get(path)` / `getActive()` / `setActive(path)` | 按路径取实例/活跃实例 |
| 加载蓝图 | `BlueprintPreviewManager.loadBlueprint(path, diskPath?): boolean` | `BlueprintRegistry.get` 深拷贝为 `_jsonTree`；Spawn 失败 → warn + false |
| 保存数据 | `collectSaveData(): Record \| null` | 遍历大纲 actor，`getPersistentProps()` 合入 JSON（不删键）；含 TransformComponent 的节点删除顶层 transform 并写组件 properties |
| 场景加载 | `ScenePreviewManager.loadSceneAsset(sceneData): boolean` | 内部 `loadScene()` + 根 GenericActor |
| 检查引擎 | `assetLintEngine.start()` / `scheduleScan(delay=300)` / `scanOnce()` / `stop()` | start 幂等 + globalThis 守卫防 StrictMode/HMR 重复订阅 |

```ts
// BlueprintEditor.tsx
mgr.loadBlueprint(assetKey, assetPath)
AssetPreviewManager.register(assetPath, mgr)   // 成功后才注册

// Outline.tsx
AssetPreviewManager.get(assetPath)?.selectActor(actor)
```

### 3.2 触发时机与使用前提

- assetLint 触发：① 打开/切换工程 → 全量扫描；② asset 目录文件变化 → 300ms 去抖重扫；③ MCP `run_asset_lint` → 手动全量重扫（绕过内容指纹缓存，返回违规列表，可选 `project` 参数指定目标工程 folder/显示名）；内容指纹（`hashOf` djb2）未变复用上次 issue 跳过 walk+schema
- 场景预览保存后需**重新 `activate(assetPath)`**（loadSceneAsset 内部 clearPreview 清掉 `_currentScenePath`，不 reactivate 则 Outline 返回空树）

## 4. 工作流程

### 4.1 assetLint 触发机制（事件驱动，无定时器）

```
1. 打开/切换工程 → 全量扫描一次（建立监听 + 首扫）
2. asset 目录文件变化（主进程 fs.watch 通知）→ 300ms 去抖后重扫
   → 内容指纹缓存（hashOf，djb2 哈希）判定真正变化才重新校验
   （未变文件复用上次 issue，跳过 walk+schema）
3. MCP run_asset_lint（2026-09-01 新增）→ 手动全量重扫（runNow：清缓存绕过指纹），
   可选 project 参数指定目标工程（folder 或显示名，如 fish / FishMaster）；缺省 = 当前打开工程。
   返回全部违规列表给 AI；当前打开工程同时右下角检查面板同步更新，
   指定非当前打开工程则为旁路扫描（只经返回值输出，不覆盖面板）
```

### 4.2 assetLint 架构

```
src/editor/asset/assetLint/
├── AssetLintEngine.ts        # 检查核心引擎（模块级单例，事件驱动）
├── AssetCheckerRegistry.ts   # 检查器注册表（幂等，同 kind 只保留首次）
├── AbstractAssetChecker.ts   # 检查器基类（schema + run + validate 钩子）
├── AssetSource.ts            # 资产来源（Electron 磁盘扫描 / 浏览器内存降级）
├── AssetWalker.ts            # 文档遍历（walkDocument：根判定 + 节点派发）
├── schemaEngine.ts           # JSON Schema 校验引擎
├── checkers/                 # 内置检查器（22 个：doc/node/comp）
└── types.ts                  # LintIssue / CheckerContext 类型
```

### 4.3 输出与报告

- 违规经 `logger.warn/error` 输出（自动写日志文件 + 控制台面板），带 `[AssetLint]` 前缀与节点定位：`${filePath} > ${nodePath} [${field}] ${message} (${ruleId})`
- **log 级增量**：`filePath::nodePath::field::ruleId` 指纹集合，只报新 issue
- **面板发布（共用右下角检查面板）**：`reportNew` 全量覆盖发布到 `useCodeLintStore.setAssetIssues`（`toAssetIssueView` 映射），与 codeLint 问题分节显示在状态栏 tips 面板（[code_lint_system.md §4.4](./code_lint_system.md)）；`onProjectChanged` 先清空旧工程数据
- 全局单例 + `globalThis` 守卫：StrictMode 双挂载 / HMR 都只保留一份 store 订阅与监听

### 4.4 检查范围（按资产类型）

| 资产 | 检查 |
|---|---|
| `*.scene.json` | `doc:scene` / `node:actor` / `node:ref` 等 |
| `*.blueprint.json` | `doc:blueprint` / `node` / `comp` |
| `*.widget.json` | UI 控件树结构/组件 |
| 配置/数据表 | 结构校验（schemaEngine） |

## 5. 边界条件

| 条件 | 行为/后果 | 处理方式 |
|---|---|---|
| `loadBlueprint` 蓝图未注册/Spawn 失败 | warn + 返回 false（不设 current key） | 调用方判 false 处理 |
| 无 `_currentBlueprintDiskPath` | `commitPreviewEdit` warn 跳过拖拽提交 | loadBlueprint 传 diskPath |
| ref 实例（isRefInstance） | 不入 `_actorJsonMap`（无法就地提交） | 引擎内置过滤 |
| `collectSaveData` 旧格式节点 | 只回写 `pos`（旧格式无 rotation/scale） | 已知限制 |
| 无 electronAPI（浏览器） | `AssetSource` 降级为 RegistryAssetSource（遍历内存注册表，抓不到解析失败文件） | 引擎内置降级 |
| 无工程打开 | assetLint 静默 | 引擎内置 |
| 未知文档根 | `'无法识别文档根（既非 scene 也非 blueprint）'` warn | 检查资产结构 |
| JSON 解析失败 | error `'JSON 解析失败: ...'`（仅磁盘扫描能抓到） | 修复资产文件 |
| MCP `run_asset_lint` 无工程且无 `project` 参数 | 返回 `{ total:0, issues:[] }`（assetLint 静默语义） | 传 `project` 参数或先打开工程 |
| MCP `run_asset_lint` 扫描中重入 | 防重入返回空数组（引擎 `running` 锁） | 稍后重试 |
| MCP `run_asset_lint` 指定无效工程 | 返回 `{ status:'error', message:'未找到工程: X，可用: ...' }` | 用 message 中列出的可用 folder |
| MCP `run_asset_lint` 指定非当前打开工程 | 正常扫描该工程（旁路，不覆盖检查面板） | 结果以返回值为准 |
| `fitToActor` 包围盒过小（<0.01） | 相机回默认 `(5,4,5)` 看原点 | 引擎内置 |
| 场景预览保存后 | Outline 空树（`_currentScenePath` 被清） | **必须重新 activate** |
| `ScenePreviewManager.dispose()` | `world.Destroy()`（终局销毁） | 防 World 三件套泄漏 |

## 6. 组件字段同步约定

> 组件添加新字段要**同步更新资产和资产检查器**（项目约定）——assetLint 会校验组件字段与注册表定义一致。

## 7. 依赖关系

```
AssetPreviewManager → ScenePreviewManager / BlueprintPreviewManager / UIPreviewManager
UIPreviewManager → World / UIManager / BlueprintRegistry / CanvasUIComponent / UITransformComponent
UIPreviewManager → TransformGizmo / AnchorGizmo / SelectionManager（编辑交互）
AssetLintEngine → AssetSource / AssetWalker / AssetCheckerRegistry / schemaEngine
AssetLintEngine → useEditorStore（project folder）/ logger
```
