---
name: warm_holo_close_keep_camera
task_type: feature/gameplay-camera
outcome: success
date: 2026-09-16
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, e2e/warm/hologram.spec.ts, e2e/warm/focus_orbit.spec.ts, playwright.e2e.config.ts]
---
## Summary

全息面板 ✕/Esc 关闭把相机拉回默认取景 → closeHologram 改 clearObserveState 保持相机原位（用户定案"关闭不重新取景"），hologram.spec 加同帧相机原位锁；顺带把 focus_orbit.spec 两处陈旧/几何脆弱断言现代化，并查明日志揭示的拖拽完成竞态根因。

## Lessons

1) 诊断路径有效：游戏在运行就先读 logs/game_*.log——mousedown 坐标与 [SolarCamera]/[WarmCurrent] 取景日志逐帧对齐，直接锁定点关闭→相机重置的真实链路（closeHologram→focusSolarSystem），不靠猜。2) 修复落点：clearObserveState 本就是"清状态不取景复位"的收口，closeHologram 换用它 + applyZoomFloor 回落即成；7 处互斥调用方（openPlanetInfo/openOrbitBuild/openShipyardPanel/openShipDesign/enterPlanetObserve/enterMoonObserve/Esc）自动获得同语义。3) focus_orbit.spec 两个陈旧断言（非本改动所致，靠"改动不在链路"论证判定）：跟随断言停在旧"成对平移锁距离"口径（实现已是五版原地转头只拉 target）→ 按代码注释口径改"相机不动<3"；环绕位移断言 >60 对俯仰角脆弱（位移=R×cos(pitch)×1.003，pitch 随聚焦逼近几何 35°~55° 浮动）→ 改按 p2 实际 R_h 推期望弦长×0.6 容差。4) 【本 session 最大坑】ai.mouseDrag 是排队后台步进，headless 节流下步间隔 1~3s 随负载浮动：固定时长保底（12s）和窄稳定窗（300ms×2）都会把半程误判成终点（位移恰好减半 48~55 反复）；确定性方案=等处理器的完成日志（page.waitForEvent('console', text 含 'mouseDrag'+'完成')，Logger 落 page console）。5) 尝试过 playwright launchOptions 加反节流 flags（--disable-background-timer-throttling 等）：帧密度骤变把原本稳定的双击/滑移断言全打破，已回退——节流环境下的应对放 spec 内做确定性等待，注释留在 playwright.e2e.config.ts 防后人再踩。6) 收尾时发现另一会话在并行改"真实天体历法"（balance/helpers/StarActor/StarMapRenderComponent，月球周期×1000 变慢→§3 月球位移断言 +20→+2000 被对方改掉）：改共享 spec 前先重读文件，"file changed since read" 报错 = 并行工作信号，及时收窄自己的改动域避免对冲。

## Effective Path

projects/warm-current/gameplay/base/WarmCurrentGameMode.ts（closeHologram） || e2e/warm/hologram.spec.ts（§4 同帧对照锁） || e2e/warm/focus_orbit.spec.ts（§3/§4 断言现代化）
