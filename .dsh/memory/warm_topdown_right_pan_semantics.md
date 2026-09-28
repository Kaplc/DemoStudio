---
name: warm_topdown_right_pan_semantics
description: warm 俯视态相机语义 2026-09-28 定案：右键拖拽=平移镜头、orbitMode 关闭（推翻 2026-09-15 聚焦环绕的俯视态右键环绕）；环绕只留观察态/全息特写
type: project
prefix: [projects/warm-current/gameplay/systems/ViewDirectorComponent.ts, projects/warm-current/e2e/focus_orbit.spec.ts]
---

规则（2026-09-28 用户定案）：warm-current 俯视态（行星系默认取景 / 轨道蓝图台）**右键拖拽 = 平移镜头，orbitMode=false，轨道旋转模式关闭**；环绕只保留特写观察态（双击行星/卫星 enterPlanetObserve/enterMoonObserve）与全息特写（openHologram）。蓝图台全景的边缘平移保持开，行星系俯视保持关。

**Why:** 用户原话"进入俯视角状态右键就变成平移镜头关闭轨道旋转模式"——推翻 2026-09-15 聚焦环绕改版中"行星系聚焦默认右键环绕"的俯视态语义（环绕语义收缩到特写观察态；2026-09-26 的水平方向翻转只对观察态仍有意义）。

**How to apply:** 相机交互语义收口在 `ViewDirectorComponent.applyFocusCameraMode`（orbitMode 恒 false，特写入口自行开环绕），滚轮空目标软退出也走它；不要再把俯视态 orbitMode 翻回 true。断言锁：focus_orbit.spec §1/§5/§9 + hologram.spec §4 均 orbitMode=false，§1b 锁"右键拖拽 = target/相机同向等距平移"；观察态环绕断言（§2/§4）不变。

**补充（2026-09-28 同日精化，滚轮吸附模型）：** 用户先说"编辑模式屏蔽鼠标吸附目标"，随即纠正为**吸附保留**——滚轮继续放大并吸附锁定天体球心（含蓝图台）；吸附态右键拖拽 = 纯平移不旋转；**平移即解除吸附锁定**（rig.pan 成对移动 target、每滚按光标重拾无粘滞，勿给滚轮吸附加"平移后仍复挂"的粘滞逻辑）。曾误将 `scrollPan.candidates` 在 routeEditMode 清空，已回滚——不要再去掉编辑模式的天体吸附。断言锁：orbit_blueprint.spec §6（6a 吸附/6b 平移解除/6c 重吸附）。
