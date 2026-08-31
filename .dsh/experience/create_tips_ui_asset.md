---
name: create_tips_ui_asset
task_type: feature
outcome: success
date: 2026-08-31
---
## Summary

创建通用 Tips UI widget 和绑定脚本，并在建筑升级面板和宝石商店中集成金币/宝石不足提示

## Lessons

有效做法：先读参考资产（toast.widget.json）理解 widget 结构，用 todo_write 分步跟踪，集成后在多个入口（BuildingUpgrade、GemShop）复用同一套静态方法 showError/showSuccess，最后用 npx tsc --noEmit 和临时 node 测试脚本验证。踩坑：Tips.script.ts 中静态方法里用动态 import 引入 UIScriptComponent 导致 tsc 报错，应直接在文件顶部静态导入；集成提示时要在 getComponent 前确保类型正确。下次做通用 UI 资产建议先确定公共 API（静态便捷方法）再改调用方，避免边改边暴露接口问题。

## Effective Path

src/projects/fish/asset/blueprints/ui/tips.widget.json + src/projects/fish/gameplay/base/Tips.script.ts 作为通用资产，再在 BuildingUpgrade.script.ts / GemShop.script.ts 中导入调用
