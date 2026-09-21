---
name: e2e_split_engine_vs_projects
task_type: feature/test-infra
outcome: success
date: 2026-09-21
prefix: [playwright.e2e.config.ts, package.json, e2e/README.md, e2e/framework/projects.ts, tests/e2eFrameworkAutoScan.test.ts]
---
## Summary

（三轮更新）e2e 分层定稿：根 e2e/=引擎+框架，项目用例下沉 projects/<id>/e2e/ 自动扫描零注册；补回归锁 tests/e2eFrameworkAutoScan.test.ts（parseCardName 契约 + --list 收集层 + 真实建新工程实跑全绿的生命周期层）。

## Lessons

1) 定稿分层：engine={testDir:'./e2e'}，projects={testDir:'./projects', testMatch:/[\\/]e2e[\\/].+\.spec\.ts$/}；脚本 test:e2e=engine、test:e2e:project（-- projects/<id>），无全量入口（2026-09-22 用户决策）。2) 描述符零注册=文本提取 ProjectModule.name（register.ts 有 import.meta.glob/@/engine，Playwright 进程 import 不动），纯函数 parseCardName 可单测。3) 【核心坑·规则见 memory:vite_glob_add_frozen_by_no_autoreload】noAutoReloadPlugin 把"新增目录"型 glob 扩展拦截——新建工程在现役 dev server 上永不出现；解法=utimesSync bump MockElectronAPI.ts/registry.ts 的 mtime 强制重 transform，然后 fetch transform 产物轮询确认纳入；删除后对称 bump 防死引用。4) playwright CLI 位置过滤参数按正则匹配路径：path.join 的反斜杠（projects\e2e-selftest 的 \e 被吃）匹配不上任何文件报 "No tests found"——过滤器一律用正斜杠（ unix 化路径二次匹配会命中）。5) vitest 里 spawn playwright 用异步 spawn，spawnSync 长阻塞会打爆 worker RPC（onTaskUpdate timeout unhandled error）。6) 与并行会话共享 dev server 时生命周期测试会因负载偶发超时（boot 240s 被拖爆、失败证据目录被对方 run 清掉）——先跑一次 --list 判断是并发还是链路问题；干净条件稳定复绿。7) 手动复现的最短路径：copy hello 改名 + utimes 两个 glob 消费方 + 直接 node cli.js 跑，15.6s 全绿即证明链路通，再回头修测试层。

## Effective Path

playwright.e2e.config.ts（testDir 分层） || e2e/framework/projects.ts（parseCardName 自动扫描） || tests/e2eFrameworkAutoScan.test.ts（零注册链路回归锁）
