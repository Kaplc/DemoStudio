---
name: warm_holo_tab_rework
task_type: feature/ui-rework
outcome: success
date: 2026-09-16
prefix: [projects/warm-current/gameplay/ui/holoHudModel.ts, projects/warm-current/gameplay/ui/HoloHudScript.script.ts, projects/warm-current/gameplay/ui/HologramPanelScript.script.ts]
---
## Summary

warm 全息地球底栏改版：业务 6 按钮下架，工具条改 4 固定按钮（⚡环节点+资源/地表建筑/轨道建筑），全息面板内容按分类切换（轨道建筑嵌入 orbit_build 行），全息态隐藏左侧入口面板；GameMode.holoTab 权威 + 两 widget 重编译 + 口径单测 + 新 e2e 2 用例全绿。

## Lessons

1) 分类面板改版三件套沿用项目既有模式：GameMode 权威字段（holoTab + setHoloTab，openHologram 重置）→ 脚本 8Hz 差分呈现 → 纯函数口径进 holoHudModel 配 vitest 锁定；UI 显隐走 VisBinder/bActive（见 memory:warm_holo_freeze_frame_starvation），滚动区行组显隐后必须 relayoutScrollRows() 重排。2) widget 编译通道再验证：编辑器 MCP HTTP（127.0.0.1:9877 起 POST /api/command {command:'ui_compile', params:{asset:'…widget.json'}}，参数传 json 路径），零 error 零 lint 即落盘，Node fetch 直调最稳。3)【本 session 最大坑】PS5.1 两坑叠加浪费数轮：`-match "\x{FEFF}"` 报 Insufficient hexadecimal digits（要用 [\uFEFF] 或 char code 比较）；`$bom=[string][char]0xFEFF` 经 pwsh -Command 传参后变空串 → IndexOf('') 恒 0 → 全行误报 BOM noise。BOM 对比唯一可靠法：Node execSync('git show HEAD:path')（返回原始 Buffer）比对头 3 字节；PS 管道/cmd 重定向都会重编码。本次实测 10 个 warm 文件 HEAD/工作区均无 BOM（memory:edit_tool_strips_utf8_bom 样本清单已过期并更新）——别按旧记忆预防性补 BOM，会反过来制造噪声。4) flex 行宽预算要算 padding：MainRow 1364 border-box − 32 padding = 1332 内宽，150+2+W+96+36(gap) → StatusText ≤1048，首版 1050 溢出 2px，收 1040。5) 基线红判定法有效：e2e hud.spec「二级按钮」红 = simState.overclocked 字段漂移（并行改动域）；vitest 12 红 = 工坊域/FleetMaint/imageLightbox——用「失败测试 import 与本次改动文件零交集」佐证无关，避免误修。

## Effective Path

projects/warm-current/gameplay/ui/holoHudModel.ts || projects/warm-current/gameplay/ui/HoloHudScript.script.ts || projects/warm-current/gameplay/ui/HologramPanelScript.script.ts || projects/warm-current/asset/blueprints/ui/holo_hud.widget.html || e2e/warm/holo_tabs.spec.ts
