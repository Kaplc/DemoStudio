---
name: perf_profiler_implementation
task_type: feature
outcome: success
date: 2026-09-21
prefix: [src/engine/debug/perf/PerfStatsCollector.ts, src/types/perf.ts, doc/dev/perf_profiler_plan.md]
---
## Summary

按 doc/dev/perf_profiler_plan.md 实现性能分析器：模块化采集器（IPerfModule 扩展点 + 四内置模块）+ ai.getPerfStats + Window 菜单独立窗口（perf.html 三入口 MPA）+ IPC 快照往返；单测 10 绿 + e2e 5 绿，方案文档回填实装差异

## Lessons

1) renderer.info.autoReset 坑实锤：three 默认每次 render() 后重置，本引擎每帧两趟（世界+UI 叠加），直读只剩 UI 趟——采集器接管 autoReset=false + 每帧手动 reset，e2e A1 断言 calls>0 锁口径。2) 可测试性设计：rAF/window 全守卫（node 环境自动跳过）+ _tick 箭头函数公开给测试直驱 + resetForTest 静态清理（模块级单例跨用例泄漏是必踩坑，项目先例 clearImageDataUrlCacheForTest）——10 单测零环境依赖。3) e2e 面板验证手法：B 组零引导直开 /perf.html（Mock 注入），运行时替换 window.electronAPI.perfGetSnapshot 喂合成快照（含未知模块）验证精排+通用段，不依赖真实采集与 Electron。4) AI 读数控上下文：ai.getPerfStats 默认不带历史，samples 参数显式要（[0,120] 夹取）。5) 并行会话信号：两次 tsc 之间 warm ViewDirector 错误数自己变了、vitest 基线红从记忆里的 2 条漂到 12 条（warmSupplyChain/SlotsAndDesign/FleetMaint/imageLightbox）——跑门禁先按文件归属判定，勿把他人的基线红当成自己的回归。6) Electron 链路（菜单开窗/preload 通道）浏览器 e2e 覆盖不到，重启编辑器才生效，已在方案文档 §12.5 留人工验证前置。

## Effective Path

src/engine/debug/perf/（PerfTypes+builtinModules+PerfStatsCollector）；src/types/perf.ts（共享类型）；e2e/perf/profiler.spec.ts
