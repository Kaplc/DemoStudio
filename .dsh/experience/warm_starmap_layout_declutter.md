---
name: warm_starmap_layout_declutter
task_type: feature/layout-tuning
outcome: success
date: 2026-09-12
prefix: [projects/warm-current/asset/config/star_map.config.json, tests/assetLintPolicy.test.ts]
---
## Summary

warm 星图内系统密度治理：太阳 96→64 + 内轨道重排（水170/金300/地460/火680）+ 地球标注锚改聚能弧环外缘，tsc/assetLint/e2e 全过零新增回归

## Lessons

1) 布局改坐标时保持初相位：沿原方向向量按新旧半径比例缩放锚点（orbitPhase=atan2 只取方位角，半径全派生自 orbitRadiusPx，见 memory:warm 布局消费者均在 helpers.ts 派生——聚能弧/角速度/隔离点/子表锚点零改动跟随）。2) 逐项核对的非派生消费点：相机取景距离（太阳中景 480→1000）、GameMode 命中判定注释、e2e 断言注释；开局 d=3400/地球系 3200/2600 半径经计算确认不用动。3) 门禁链：tsc --noEmit + vitest tests/assetLintPolicy.test.ts（编辑器 assetLint 的 CLI 代理）+ npm run test:e2e:warm；warm 全量 33 用例既有 6 红基线（2026-09-11 口径）+ 坑46 二次启动抖动（render_postprocess 第3个 test waitWarmMap 超时）——超基线的红先单跑 --grep 甄别，单跑绿=抖动非回归。4) 视觉验证法：e2e 全景基准图 test-results/warm-render-solar.png 上量屏幕像素、按已知轨道反推比例尺回算各行星世界半径，数字级确认布局生效。5) 踩坑：edit 大文件偶发 Win32 1175 EIO，原样重试即过；BOM 补回见 memory:edit_tool_strips_utf8_bom（本次 GameMode 实际触发）。6) 地球标注新锚（sun.y+轨道半径+28）在默认全景下贴近底部 HUD 条，被 UI 遮住属预期取舍——它标注的就是那条环，缩放/平移后可读。

## Effective Path

projects/warm-current/asset/config/star_map.config.json
