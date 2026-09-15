---
name: add_toolcard_image_view
task_type: feature
outcome: success
date: 2026-09-16
prefix: [src/components/agent/ToolCard.tsx, electron/main.ts, tests/e2e/agent/tool-card-diff.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

read_image 工具卡片展开渲染图片本体（IPC read-image-file 读盘 → data URL + 路径标注，替代原始 JSON 输入/输出），任一环失败回退通用视图；vitest 19 例 + e2e 合成历史 6 例全绿，文档 §12.7 同步

## Lessons

1. 渲染进程加载本地图片别用 <img src="file://">：编辑器页面跑在 http://localhost（vite dev）下 file:// 子资源被跨域拦截——复用 read-text-file 模式新开 read-image-file IPC（root 逃逸防护与 read-text-file 同规则 + png/jpg/jpeg/gif/webp/bmp 白名单 → base64+mime → data URL），浏览器模式无 electronAPI 自然回退。2. testing-library 的 waitFor 只在回调抛错时重试，回调返回 null 算通过——`waitFor(() => querySelector(...))` 首次拿到 null 即失败退出；必须回调内 expect(...).not.toBeNull() 或 throw。3. 渲染策略：加载中抑制通用视图（防 JSON 闪现再变图）；DSH result 的 <path>/<type>/<content> 文本完全不解析——永远从磁盘现读，文件被删诚实回退。4. electron/main.ts+preload.ts 保存后 vite 自动重编译 dist-electron 产物（改完即见于文件），但运行中的主进程要重启编辑器才加载新 IPC——用户有其他会话在跑时别主动 editor_restart，交付时说明"重启后生效"。5. e2e 复用 stubAgentPage 合成历史装置加 opts.imageData（默认 1x1 PNG base64 成功、null 模拟 IPC 失败），naturalWidth===1 断言 Chromium 真实解码。决策规则见 memory:agent_tool_card_diff_ui_decisions 第六条。

## Effective Path

src/components/agent/ToolCard.tsx（图片视图 + suppressGenericView）+ electron/main.ts（read-image-file）+ tests/e2e/agent/tool-card-diff.spec.ts（stubAgentPage opts.imageData）
