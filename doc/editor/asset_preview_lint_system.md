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
| `AssetPreviewManager` | 资产预览统一入口（按资产类型分发） |
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

## 3. assetLint 资产检查器

### 架构

```
src/editor/asset/assetLint/
├── AssetLintEngine.ts        # 检查核心引擎（模块级单例，事件驱动）
├── AssetCheckerRegistry.ts   # 检查器注册表
├── AbstractAssetChecker.ts   # 检查器基类
├── AssetSource.ts            # 资产来源（文件扫描）
├── AssetWalker.ts            # 文档遍历（walkDocument）
├── schemaEngine.ts           # JSON Schema 校验引擎
├── checkers/                 # 内置检查器
│   ├── componentChecker.ts   # 组件检查（组件注册/属性/字段同步）
│   ├── nodeCheckers.ts       # 节点检查（actor/ref/transform 等）
│   └── docCheckers.ts        # 文档级检查
└── types.ts                  # LintIssue / CheckerContext 类型
```

### 触发机制（事件驱动，无定时器）

```
1. 打开/切换工程 → 全量扫描一次（建立监听 + 首扫）
2. asset 目录文件变化（主进程 fs.watch 通知）→ 300ms 去抖后重扫
   → 内容指纹缓存（hashOf，djb2 哈希）判定真正变化才重新校验
   （未变文件复用上次 issue，跳过 walk+schema）
```

### 输出

- 违规经 `logger.warn/error` 输出（自动写日志文件 + 控制台面板），带 `[AssetLint]` 前缀与节点定位
- 全局单例 + `globalThis` 守卫：StrictMode 双挂载 / HMR 都只保留一份 store 订阅与监听

### 检查范围（按资产类型）

| 资产 | 检查 |
|---|---|
| `*.scene.json` | `doc:scene` / `node:actor` / `node:ref` 等 |
| `*.blueprint.json` | `doc:blueprint` / `node` / `comp` |
| `*.widget.json` | UI 控件树结构/组件 |
| 配置/数据表 | 结构校验（schemaEngine） |

## 4. 组件字段同步约定

> 组件添加新字段要**同步更新资产和资产检查器**（项目约定）——assetLint 会校验组件字段与注册表定义一致。

## 5. 依赖关系

```
AssetPreviewManager → ScenePreviewManager / BlueprintPreviewManager / UIPreviewManager
UIPreviewManager → World / UIManager / BlueprintRegistry / CanvasUIComponent / UITransformComponent
UIPreviewManager → TransformGizmo / AnchorGizmo / SelectionManager（编辑交互）
AssetLintEngine → AssetSource / AssetWalker / AssetCheckerRegistry / schemaEngine
AssetLintEngine → useEditorStore（project folder）/ logger
```
