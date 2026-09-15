---
name: warm_holo_freeze_frame_starvation
description: warm 月球全息"卡死"根因=渲染帧饥饿（rAF 1~11fps）而非逻辑死锁；运动最重的视图最先读作卡死
type: project
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts, projects/warm-current/gameplay/ui/HologramPanelScript.script.ts]
---

# warm 月球全息"卡死"= 渲染帧饥饿，非逻辑死锁（2026-09-16 定案）

**Problem:** 用户报告"点开月球全息 → UI 异常直接卡死，地球全息没事"（2026-09-16 00:26~00:32 三次会话）。游戏日志无异常无死锁：冻结"后"用户点击仍被处理（game B 全息打开后 30s 内聚能环按钮正常响应）；openHologram 同步流程日志完整走完。

**Cause:** 编辑器页面渲染帧饥饿——rAF 实测仅 1~11fps（窗口可见/未最小化/反节流开关全开/GPU 硬件加速正常的前提下），JS 主线程 evaluate 全程 2ms 健康。月球全息是**运动最重视图**：月球公转漂移 → Tick 逐帧 rig.pan 跟随 + 环绕控制，低帧率下相机 1 秒级跳变 + 合成器陈旧帧混显 → 读作"UI 异常 + 直接卡死"。地球全息画面近静态，同帧率下勉强可读，故用户感知"月球卡地球不卡"。全息代码本身零问题（全链路审计 + 6 次实机复现全通过）。

**Solution:** 诊断"卡死"类问题时**先测 rAF 实际帧率**（page.evaluate 内 rAF 计数 2s），不要只看 JS 心跳/日志静默——主线程活着 ≠ 画面在动。修复方向：① 播放时降低机器负载/重启编辑器对比；② 引擎侧可加 dt 钳制（帧间隔超阈值暂停仿真防追赶暴跳）+ 帧率恶化告警日志。

**Applicable:** warm/hoi4/fish 一切"画面卡死但日志正常"的排障；低帧率下运动最重的视图（相机跟随/环绕/全息动画）最先被读作卡死。
