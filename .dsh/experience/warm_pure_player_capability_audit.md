---
name: warm_pure_player_capability_audit
task_type: feature/tooling
outcome: success
date: 2026-09-13
prefix: [src/engine/ai/registerBuiltinAIHandlers.ts, src/engine/input/InputSys.ts, projects/warm-current/gameplay/base/WarmCurrentPlayerController.ts, e2e/warm/player_input.spec.ts]
---
## Summary

（两轮更新）评估并补齐"纯玩家操作 warm-current"的工具缺口：修复 mouseClick 只按不抬 + mouseDrag 无右键参数 + 新增 projectScreenPos 投影查询 + 顺手修掉 CameraRig 裸 _camera 潜伏 bug；e2e/warm/player_input.spec.ts 4 用例全绿回归锁。

## Lessons

1) 修复落地（2026-09-13）：ai.mouseClick 补 handlePointerUp（完整按下+释放）；ai.mouseDrag 加 button 参数 + 校验同步/步进后台化（AIModule.emit 同步聚合，async 处理器回执是 Promise——校验必须同步可见，返回带 async:true）；新增 ai.projectScreenPos（actor|worldPos → screenX/Y/inFront，换算同 clickActor 反投）。DSH 侧 ds-engine-tools 新 project_screen_pos 工具 + mouse_drag 暴露 button（mount_plugin 部署，重启 DSH 生效）。2) 【CameraRig 潜伏 bug】手动 new 的组件不进 Actor 组件表（AObjectComponent 构造只存 owner）→ getComponent 看不见、BeginPlay 永不执行 → CameraRig._camera 恒 null → 右键平移/边缘平移静默失效，滚一次滚轮（zoom 走 resolveCamera）才"自愈"；修复=使用点惰性解析 resolveCamera()；规则见 memory:engine_manual_component_not_registered。3) e2e 实战坑：a) Actor 名=类名（'EarthActor' 非 'Earth'，getState 同口径）；b) getHUD 的 position 是**局部坐标**（沿父链累加），UI 画布 1920×1080 中心原点 +y 向上 → top-left 换算 (960+ax, 540-ay) 再 contain 变换到页面坐标；c) HUD 树双根镜像（'/HUD/...' + '/WarmCurrentHud/...'）断言需按 path 前缀去重；d) headless 下拖拽 stepDelay 定时器被节流（10 步可拖 10s），断言前轮询投影稳定（deadline 放 12s）；e) released 通路正向断言用"HUD 暂停按钮动作生效 + 按钮态回 normal"，右键卡滞回归用"click2 后 mouse_move 不平移"。4) GM 11 命令定性：status/stock()/holo state 查询类可被 get_hud/getState 替代；作弊类均有真实玩家链路。能力评估旧教训（只按不抬/无右键/无投影查询）已全部闭环。
