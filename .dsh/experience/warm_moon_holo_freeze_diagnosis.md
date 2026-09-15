---
name: warm_moon_holo_freeze_diagnosis
task_type: debug/diagnosis
outcome: partial
date: 2026-09-16
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts, logs/cdp-keeper.js]
---
## Summary

诊断 warm"月球全息卡死"：日志取证 + CDP 实机复现 6 次 + 全链路代码审计，排除逻辑死锁，定位为渲染帧饥饿（rAF 实测 1~11fps，运动最重视图最先读作卡死）

## Lessons

1) "画面卡死"先测 rAF 实际帧率（evaluate 里 rAF 计数 2s）再查逻辑——本例主线程 evaluate 2ms 健康、input 正常处理（用户冻结后 30s 的点击日志为证），但 rAF 只有 1~11fps；JS 心跳 ≠ 画面在动。2) CDP 截图在帧饥饿下会给出陈旧/混叠帧：面板堆叠+黑屏"复现"多次全是合成器旧帧伪影，必须用 bridge 查询+日志交叉验证每个"异常"，否则会被伪影带偏数小时（本 session 就被带偏过）。3) 排除法链：窗口可见性/最小化（user32 IsIconic）、进程优先级、GPU（WEBGL_debug_renderer_info）、反节流开关（backgroundThrottling:false + 三 appendSwitch 均已配置且进程晚于提交日）逐一排除后，剩余指向机器负载/帧 pacing——刷新页面也不能恢复 60fps 说明是环境级而非页面级。4) keeper 长驻 CDP 诊断脚本好用（Debugger 域 + 心跳停摆自动 pause 抓栈 + 命令文件接口），但命令去重必须按 raw 字符串比较——按 JSON.parse 对象比较永远不等，会把同一条命令每 500ms 重跑一次（本次 openHologram 被重跑数百次污染现场）。5) PowerShell Set-Content UTF8 带 BOM 会炸 JSON.parse，写命令文件用 [IO.File]::WriteAllText。6) 未定案残留：帧饥饿的根因（机器负载 57%/AMD 驱动/DWM pacing/长会话）未锁定，刷新页面后仍 11fps 排除了页面级老化；后续可用干净开机环境对比定位。
