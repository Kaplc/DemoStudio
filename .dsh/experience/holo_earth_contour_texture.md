---
name: holo_earth_contour_texture
task_type: feature/rendering
outcome: success
date: 2026-09-16
prefix: [projects/warm-current/gameplay/map/starTextures.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts, e2e/warm/holo_contour.spec.ts]
---
## Summary

warm 全息地球大陆轮廓层（earth.jpg 逐像素派生海岸线/陆地填充，页面级缓存，加色叠全息球随球自转）；含一次东西向反转的用户纠错回归：默认 UV 才是对的，镜像修正反而翻反。

## Lessons

1)【修正 2026-09-17 用户实测】全息轮廓贴图必须保持 SphereGeometry 默认 UV 放置、禁止 repeat.x=-1 镜像：本作 latLonToLocal 框架 + 地球系取景相机（框架 90E 附近）下，默认放置屏幕东西 = 真实地理（日本在中国右边），且与真球 earth.jpg 同向；加了 repeat.x=-1 反而东西翻转（日本跑到中国左边）。教训：贴图朝向别信"three.js equirect 镜像"的抽象论断，用实证链路验证——view() 读相机 XZ 得框架经度 Lc，holoSurfaceScreenPos 投影已知城市，对照截图判断。2)【e2e 日志指纹大坑】游戏日志每事件落 console 两行（真实 sink + [MockGameLog:info] sink），指纹断言绝对数必错（toBe(1) 实为 2）；必须用与基线的差值断言。诊断法：把收集行嵌进 expect 自定义消息（spec 内 console.log 在 list reporter 不可见）。3) closeHologram 只清状态，渲染层 holoRoot 隐藏不摘组（重开零重建无挂载日志）；只有切换天体才走 disposeHolo/buildHolo 重建——测「重开」语义前先读 closeHologram 实现。4) editor_restart 后 editor_screenshot 工具报 value.width must be a number（schema bug），editor_click 可能连到同源 5173 的 agent.html 窗口：绕行 = playwright connectOverCDP 真实端口 + 精确 /^http:\/\/localhost:5173\/?$/ 匹配主编辑器页；游戏操作用 page.evaluate 里 window.__ai.emit(ai.clickActor/ai.gmCommand)。5) 并行会话共享编辑器会互相干扰（游戏被无日志静默停止）——实机取证要 Launch→Btn_load→GM holo enter→截图一气呵成。

## Effective Path

projects/warm-current/gameplay/map/starTextures.ts || projects/warm-current/gameplay/map/StarMapRenderComponent.ts || e2e/warm/holo_contour.spec.ts
