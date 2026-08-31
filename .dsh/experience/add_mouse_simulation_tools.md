---
name: add_mouse_simulation_tools
task_type: feature
outcome: success
date: 2026-08-31
---
## Summary

为 ds-engine-tools 新增模拟玩家鼠标/键盘操作工具（mouse_click/mouse_move/mouse_drag/key_press）：引擎侧定义 AI 事件常量/payload 并在 registerBuiltinAIHandlers 注册处理器，DSH 侧新建 mouseSimulation.ts 封装工具走 emit_ai_event→AIModule→InputSys 完整管线

## Lessons

有效路径是复用现有 InputSys 的 handlePointerDown/Move/Up/Scroll 与 ai.scrollCamera 先例，通过 AIEvents→registerBuiltinAIHandlers→InputSys→PhySys 全管线注入而非另写模拟。动手前先 grep/read 调研 InputSys、PhySys、GameInstance、registerBuiltinAIHandlers 等确认接口可用。踩坑：处理器里用 THREE.Vector3 需补 import；InputSys 返回 boolean 要与 handler 签名匹配；改完分引擎/DSH 两侧分别跑 tsc --noEmit 验证类型，再跑 oxlint 清未使用导入；新事件常量记得从引擎 index.ts 导出。

## Effective Path

harness/ds-engine-tools/src/tools/mouseSimulation.ts
