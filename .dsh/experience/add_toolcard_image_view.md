---
name: add_toolcard_image_view
task_type: feature
outcome: success
date: 2026-09-16
prefix: [src/components/agent/ToolCard.tsx, electron/main.ts, tests/e2e/agent/tool-card-diff.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

read_image 工具卡片展开渲染图片本体（IPC read-image-file → data URL + 会话级 LRU 缓存 40 条 + 失败提示行回退），文件被删后未刷新/未重启期间已看过的图持续可见；vitest 21 例 + e2e 6 例全绿，文档 §12.7 同步

## Lessons

1. 渲染进程加载本地图片别用 <img src="file://">：编辑器页面跑在 http://localhost（vite dev）下 file:// 子资源被跨域拦截——复用 read-text-file 模式新开 read-image-file IPC（root 逃逸防护与 read-text-file 同规则 + png/jpg/jpeg/gif/webp/bmp 白名单 → base64+mime → data URL），浏览器模式无 electronAPI 自然回退。2. testing-library 的 waitFor 只在回调抛错时重试，回调返回 null 算通过——必须回调内 expect/throw。3. 渲染策略：加载中抑制通用视图（防 JSON 闪现再变图）；DSH result 的 <path>/<type>/<content> 文本完全不解析——永远从磁盘现读；失败回退必须带一行失败提示（.tool-image--missing），否则用户分不清"功能没生效"还是"文件没了"（2026-09-16 实际发生）。4. 会话缓存：模块级 Map 做 LRU（40 条，命中 delete+set 触碰），卡片卸载/切会话/重挂载不重读盘，文件被删后未刷新期间已看过的图持续可见；只缓存成功；导出 clearImageDataUrlCacheForTest 供 vitest 用例间隔离（模块级状态跨用例泄漏是必踩坑）。5. "没有效果"先查数据源存活再怀疑代码：test-results/ 是 playwright 输出目录每次跑测试被清空，历史卡片引用的图多半已删；实机验证用 CDP 直连（端口按 electron PID 扫 Get-NetTCPConnection 监听端口找，CDP 端口在 5 万段而非 9222），page.evaluate 里直接调 window.electronAPI.readImageFile 断言 success/len/拒绝路径。6. electron/main.ts+preload.ts 保存后 vite 自动重编译 dist-electron，但运行中的主进程要重启编辑器才加载新 IPC；若编辑器在改动之后启动则无需重启。规则见 memory:agent_tool_card_diff_ui_decisions 第六条。

## Effective Path

src/components/agent/ToolCard.tsx（readImageFileAsDataUrlCached + imageDataUrlCache LRU 40）+ electron/main.ts（read-image-file）+ tests/e2e/agent/tool-card-diff.spec.ts（stubAgentPage opts.imageData）
