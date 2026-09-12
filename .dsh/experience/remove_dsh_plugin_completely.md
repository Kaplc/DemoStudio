---
name: remove_dsh_plugin_completely
task_type: refactor/code-removal
outcome: success
date: 2026-09-10
prefix: [editor.bat, scripts/sync-dsh-plugins.mjs]
---
## Summary

彻底移除一个 DSH 插件（ds-context-warning）：unmount_plugin 清 home 侧 → 删目录 → 清项目侧 patch → 改生成器脚本 → 同步文档 → 四重验证。

## Lessons

有效路径：① unmount_plugin 只清 home 侧（~/.dsh/profiles 的 junction + patch 行），**不会**清项目侧 .dsh/profiles/*.yml，更不会改生成器；② 真正的"复活源"是 scripts/sync-dsh-plugins.mjs——它内嵌完整 patch 模板，editor.bat 每次启动都重新生成项目侧 patch 并复制到 home 侧，漏改它下次启动插件就回来了；junction 侧不用担心，editor.bat 的 :createJunctions 动态遍历 harness/ds-*（目录删了自然跳过）；③ 卸载前先全仓 grep 包名找引用面（本次靠它发现了脚本和两处文档提及）；④ 验证四件套：两侧 patch Select-String 无残留 + junction Test-Path 不存在 + 全仓 grep 归零 + root npx tsc --noEmit 归零；重跑 node scripts/sync-dsh-plugins.mjs 后确认生成物与其余插件条目完好。坑：对同一文件连续发多个 edit 会撞 ReplaceFileW EIO（Win32 1175），同文件多处改动要逐个串行发。
