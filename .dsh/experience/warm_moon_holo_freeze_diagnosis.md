---
name: warm_moon_holo_freeze_diagnosis
task_type: debug/diagnosis
outcome: solved
date: 2026-09-16
prefix: [projects/warm-current/gameplay/ui/HologramPanelScript.script.ts, src/engine/ui/UIScrollContainerComponent.ts, src/engine/entity/Actor.ts]
---
## Summary

（2026-09-16 二次诊断**推翻凌晨结论**）warm"月球全息卡死"真因 = 引擎 bActive 爬顶重算与 VisBinder 直写 visible 的语义冲突，非帧饥饿/机器负载。完整证据链：CDP hook 抓到写入调用栈。

## Lessons

1) 凌晨会话误诊教训：rAF 帧率低 + JS 心跳健康 ≠ 环境级帧饥饿——先查**渲染负载来源**（renderer.info 分场景：主场景 8 calls vs UI 场景 2377 calls）再归因环境。"刷新后仍低帧"当时测的是开过全息的固化态（泄漏不恢复），错当环境级。2) CDP hook visible setter 抓写入栈（Object.defineProperty + new Error().stack）是定位"谁改了渲染状态"的杀手锏，一次命中。3) "UI 异常"的用户描述是字面真相：所有收起面板瞬间全亮叠满屏幕 = 真实 UI 状态破坏，不是合成器伪影。4) 引擎雷区：Actor.bActive setter 爬到树根 applyActiveTree 重算全树 root.visible=_bActive 派生值；任何脚本直写 root.visible（VisBinder）后，任何一处 bActive 写入（UIScrollContainer._updateScrollbar 的 track.bActive）都会把直写状态抹掉且 VisBinder 差分缓存阻止恢复=永久固化。5) 数据链：287→2664 draw calls、geoms 169→1588 全部首传、fps 68→11、关闭不回落；hook 栈：HologramPanelScript.relayoutScrollRows→refresh→_updateScrollbar→track.bActive→bActive setter→HUD.applyActiveTree→RingPanel/Root/Panel visible false→true。
