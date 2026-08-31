---
name: add_get_hud_tool
task_type: feature
outcome: success
date: 2026-09-01
---
## Summary

实现 ai.getHUD 事件 + get_hud 工具：引擎侧递归遍历 UI 树返回文字/按钮状态/组件信息，DSH 侧新增 getHUD.ts 工具，编译挂载测试后按用户反馈补 zOrder 与可见性字段，最终按用户纠正明确大纲树结构才是渲染顺序权威。

## Lessons

新增 AI 可感知工具时先弄清 UI 组件数据落点（UITextComponent._text、UIButtonComponent.state、CanvasUIComponent.zOrder），走引擎 AIEvents+registerBuiltinAIHandlers 加事件 → DSH 工具 → index.ts 注册 → tsc/oxlint → mount_plugin 挂载 → 重启游戏实测的固定链路；中途踩坑：缺 ButtonState import 报 tsc 错、插件挂载后游戏已停需重启、lint 报未使用 import；用户纠正了关键认识：渲染前后顺序由 UI 大纲树结构决定（同一父节点下靠后的子节点渲染在前面），zOrder 只是派生的遍历序号，判断最顶层应看 active + 同级最后出现，而不是看 zOrder 数值。

## Effective Path

harness/ds-engine-tools/src/tools/getHUD.ts + src/engine/ai/AIEvents.ts 与 registerBuiltinAIHandlers.ts 配套修改
