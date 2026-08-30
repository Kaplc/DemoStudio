---
name: remove_editor_screenshot_tool
task_type: refactor/code-removal
outcome: success
date: 2026-08-31
---
## Summary

移除 ds-editor-tools 插件中的 editor_screenshot 工具：grep 定位定义与注册点，编辑 index.ts 删除 import 和 ALL_TOOLS 注册，删除 editorScreenshot.ts 源文件，重新编译插件并重启编辑器生效。

## Lessons

有效路径：先在项目内 grep 定位工具的定义/注册位置，同步从 index.ts 的 import 和 ALL_TOOLS 数组两处移除，再删源文件、编译、重启编辑器。踩坑：第一次 grep 搜了 node_modules 里的无关路径浪费一次调用，下次应直接从项目根目录（E:\DemoStudio）开始；另外第一次 pwsh 用 `cd A && npm run build` 没有输出/未生效，换 `cd A; npm run build` 才成功——PowerShell 下先 cd 再执行命令用分号更可靠。

## Effective Path

harness/ds-editor-tools/src/index.ts（移除 import 与注册）→ 删 tools/editorScreenshot.ts → cd harness/ds-editor-tools; npm run build → editor_restart
