---
name: warm_view_lock_camera_tilt
task_type: feature
outcome: success
date: 2026-09-14
prefix: [projects/warm-current/gameplay/map/SolarCameraActor.ts, e2e/warm/view_toggle.spec.ts]
---
## Summary

warm 视角锁定地球系改造：下架 ViewToggle widget（HudScript 不再 spawn）、屏蔽双击行星/点太阳/setViewMode(solar)/switchView(solar) 全部切换入口、GM sol 收敛为仅 earth；移除垂直俯视机位（删 SolarCameraActor.focusOn，place/focusSolarSystem 全走 observeFocus 35° 斜视角），e2e 重写 view_toggle/hologram 并回归通过。

## Lessons

1) gameplay 热改后编辑器内验证必须先刷页面（模块缓存假阳/假阴性各坑过一次）+ 日志指纹验证——完整坑见 memory:gameplay_edit_stale_module_cache。2) editor_screenshot 工具报 value.width must be a number 时的 CDP fallback：scripts/cdp-shot.mjs 只认 DevToolsActivePort+9222 会全 miss，须 Get-NetTCPConnection 扫 electron 进程监听端口直连 playwright-core；截游戏画面取最大可见 canvas，截编辑器整页用 page.screenshot。3) e2e 坑 46：warm spec 合并为单 test 分节断言（多 test 的二次 boot 会超时）；断言要对照当前机制核对——舞台钉扎下聚焦行星恒在世界原点，旧 spec 的"target 不在原点"口径作废（该条本就是已知红）。4) WarmCurrentGameMode.ts 带 UTF-8 BOM，每轮 edit 后都需补回（本轮补了两次，命令见 memory:edit_tool_strips_utf8_bom）。5) 取景收敛设计：closeHologram/exitPlanetObserve/setViewMode('earth') 全部经 focusSolarSystem 一处走到 observeFocus，机位改动单点生效。

## Effective Path

projects/warm-current/gameplay/map/SolarCameraActor.ts || e2e/warm/view_toggle.spec.ts
