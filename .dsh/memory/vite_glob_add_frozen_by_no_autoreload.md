---
name: vite_glob_add_frozen_by_no_autoreload
description: noAutoReloadPlugin 的 hotUpdate:()=>[] 拦掉"新增目录"型 import.meta.glob 扩展——新建工程在现役 dev server 上永不出现，mtime bump importer 是唯一确定性解法
type: project
prefix: [vite.config.ts, src/editor/MockElectronAPI.ts, src/editor/projects/registry.ts]
---

# vite import.meta.glob 对"新增文件"冻结（noAutoReloadPlugin 副作用）

**Problem:** 2026-09-22 e2e 框架"新项目零注册"链路测试发现：dev server 运行中新建 `projects/<id>/`（含 project.json + register.ts）后，无论刷新多少次页面，首页工程卡和工厂注册表都看不到新工程；fetch `/src/editor/MockElectronAPI.ts` 的 transform 产物里烘焙的 glob 文件清单始终缺新目录。

**Cause:** `vite.config.ts` 的 noAutoReloadPlugin 用 `hotUpdate: { handler: () => [] }` 全量禁用 HMR。**改动**已存在文件的失效走 module graph（文件自身失效，F5 重 transform）→ 不受影响；但**新增文件触发 glob 扩展**没有"被改的模块"可失效——其传播机制本身就是 glob importer 的 HMR 更新，被 `() => []` 整个拦掉。registry.ts 头注释写的"重启 dev server（或整页刷新）才能被发现"中"整页刷新"一档在该插件存在后不成立。

**Solution:** 让 importer 重新 transform 就会重扫文件系统：`fs.utimesSync(importer, now, now)` bump mtime → chokidar 报 change → 模块失效 → 下次请求重 transform 时 glob 重新展开。两个消费方（`src/editor/MockElectronAPI.ts` 工程卡、`src/editor/projects/registry.ts` 工厂注册）各 bump 一次，然后轮询 fetch transform 产物确认纳入/移除（e2e 框架 tests/e2eFrameworkAutoScan.test.ts 的 touchGlobImporters + waitForViteGlobState 即落地范本）。**对称坑**：删除目录后同样要 bump，否则烘焙清单残留死引用，后续页面加载 import 已删文件直接报错。

**Applicable:** 一切"运行中的 dev server 上新增/删除被 import.meta.glob 收集的文件"场景（projects/*/register.ts、project.json、widget、gm 脚本等）；需要动态感知 glob 变化的 e2e/工具脚本。
