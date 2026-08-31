---
name: implement_gem_shop_and_upgrade_panel
task_type: feature
outcome: partial
date: 2026-08-31
---
## Summary

用户反馈游戏内没有宝石商店入口，助手先用多维 grep 排查 fastForward/shop/gem 消费路径，确认缺失商店 UI 和建筑升级面板的宝石加速按钮后，新建 building_upgrade 与 gem_shop 两套 widget+script，集成进 FishBaseGameMode 和 BaseHud 并更新 devdocs，最后尝试 e2e 但 run_scenario 参数反复失败，改为 tsc + 文件存在性静态验证。

## Lessons

有效路径：先按 spendGems/fastForward/shop/gem 多关键词 grep 建立消费场景矩阵，确认缺失项后按『widget.json + script.ts + GameMode 集成 + HUD 按钮 + devdocs 状态』五层补齐，改完先跑 npx tsc --noEmit 验证编译。踩的坑：run_scenario 多次调用参数格式不一致导致无法启动游戏，editor_click/editor_emit 启动游戏也不可靠，最终 e2e 未真正跑通。下次遇到 e2e：先查 run_scenario 工具描述/历史成功参数，或优先用 editor.executeJavaScript 调 window.__fishBattle 调试桥进入关卡验证；若无法启动游戏，至少保留 tsc + widget 文件 glob 检查 + 面板方法静态调用链核对作为兜底验证。

## Effective Path

src/projects/fish/gameplay/base/FishBaseGameMode.ts
