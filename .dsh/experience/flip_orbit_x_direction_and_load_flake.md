---
name: flip_orbit_x_direction_and_load_flake
task_type: feature/gameplay-camera
outcome: success
date: 2026-09-27
prefix: [src/engine/rendering/CameraRigComponent.ts, projects/warm-current/e2e/focus_orbit.spec.ts]
---
## Summary

翻转 warm 鼠标左右环绕方向（引擎 CameraRigComponent.onRightPanMove 单点 dx 取反）+ focus_orbit.spec 加叉积方向锁；首次回归遇 §2 负载假红，trace 取证排除本改动后重跑复绿。

## Lessons

1) 环绕方向类微改落点：orbitRotate 为私有、唯一调用点在 onRightPanMove 的 orbitRotate(dx·s, -dy·s)（垂直轴 2026-09-20 已翻）；翻转水平 = dx 也取反，只影响 orbitMode 用户（当前仅 warm，fish/hoi4 走平移分支不触达）。doc 无方向约定文档，约定写在代码注释（带日期+用户口径）即可，无需建文档。2) 方向翻转必须配 e2e 方向锁：弦长/位移断言方向无关防不住回退；用 p2→p3 相对 target 的 xz 偏移叉积符号锁方向（yaw>0 绕 +Y 正转 → 叉积 = o2x·o3z−o2z·o3x < 0），对角度回绕无歧义。3) focus_orbit §2「双击月球进观察」存在负载敏感假红：指纹 = trace console 里「星球信息面板：moon ×2 且全文无 卫星观察 日志」（双击被结算成两次单击）+ 游戏 3fps + 「完全加载完毕」时间戳异常晚（贴图/云层 4096² 柔化在共享负载下拖数十秒）；双击桥与 orbit 拖拽改动静理无交集 → 原样重跑复绿即判抖动（与并行实例共享 dev server/CPU 场景，经验库既有结论一致）。4) trace 取证法：playwright trace.zip 展开，0-trace.trace 是 ndjson，PS5.1 逐行 ConvertFrom-Json 过滤 type=console（?? 运算符不可用，Get-Content 大文件可接受）。
