---
name: ai_mouse_click_press_only_pitfall
description: （已修复 2026-09-13）ai.mouseClick 只按不抬坑的根因与修复：UI 按钮"碰巧能点"掩盖 released 缺失；修复后回归锁在 e2e/warm/player_input.spec.ts
type: project
prefix: [src/engine/ai/registerBuiltinAIHandlers.ts, src/engine/input/InputSys.ts]
scope: private
---

**Problem:** 旧版 emit `ai.mouseClick` 只调 `handlePointerDown` 从不释放：UI 按钮动作能触发但按钮卡 pressed 视觉态；warm 星图点选/清选/框选结算、全息轻点落位（`BindMouseButton('released')` 订阅者）永不触发；`button: 2` 后 `CameraRigComponent.rightDragging` 卡 true，之后每次 `mouse_move` 都在平移相机（2026-09-13 定位）。

**Cause:** 处理器缺 `handlePointerUp`（InputSys 无自动释放）。UI 按钮"碰巧能点"是因为 `PhySys.raycastClick` 里 `handleClick` 在**按下**结算，掩盖了 released 通道整体失效。

**Solution:** 已修复（2026-09-13）：mouseClick 补 `handlePointerUp`（完整按下+释放）；`ai.mouseDrag` 加 `button` 参数且处理器改同步校验+后台步进（emit 同步聚合下 async 处理器回执是 Promise，校验必须同步可见）；新增 `ai.projectScreenPos` 世界→屏幕投影查询（精确点击世界空间目标）。回归锁 `e2e/warm/player_input.spec.ts`（4 用例全绿）；DSH 侧 mouse_drag 暴露 button、新增 project_screen_pos 工具。

**Applicable:** 所有经 ai.mouseClick/mouseDrag 模拟玩家输入的游戏操作任务（engine AI 层，全项目通用）；判断"点击工具是否正常"先看 released 通道可观测点（按钮态回 normal / HUD 状态翻转），别被按下结算的按钮动作骗过。
