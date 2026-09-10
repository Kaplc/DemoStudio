---
name: fix_inspector_getproperties_key_case
task_type: bugfix
outcome: success
date: 2026-09-10
prefix: src/engine || tests
---
## Summary

用户报告 warm 项目 Inspector 里大气组件属性全灰不可调（getProperties PascalCase vs getEditableProperties camelCase 精确匹配失败），修 9 组件 24 键 + 契约回归锁；后续用户保存蓝图时暴露同一修复的第二段断链——visible 可编辑属性工厂未消费 + assetLint schema 未声明，补全 mesh 家族完整链路，并按用户决策把地球大气改为蓝图资产声明。

## Lessons

- Inspector 显示契约：行来自 getProperties()，控件靠 getEditableProperties() find(p=>p.key===k) 大小写敏感匹配，匹配不上静默变灰（doc/editor/core/property_edit_system.md 坑1）。修完只算第一环。
- 可编辑属性完整链路共四环，缺一环炸法不同：①getProperties 键精确匹配（不匹配=灰行）②工厂/配置器消费（ComponentRegistry runWithDropCheck 用 Proxy get-trap 跟踪 p 的读取，未读=加载时 error"工厂未消费属性"）③assetLint schema 声明（componentChecker，未声明=unknown-property error）④applier 重建回写。注册 getEditableProperties 时四环要一次查全——getPersistentProps 默认遍历全部可编辑属性，用户一保存没接的键就写进资产当场炸。
- mesh 家族 visible 断链修法：applyMeshColor（applier）+ applyMeshMaterialKind（4 工厂共用，get-trap 同一 p 对象能记录到）消费 p.visible；四个 mesh checker schema 加 properties.visible boolean；白名单注释同步。
- 蓝图保存会全量写回兄弟组件 persistentProps + collectSaveData 全量组件表：运行时挂载的组件（setupCloseup addComponent）会被固化进资产 → 与运行时再挂载撞成重复实例（地球双大气叠光）。用户决策（2026-09-10"资产挂组件"）：大气改 earth.blueprint.json 显式声明，setupCloseup 只管 bump，e2e 加"大气恰好一个"断言锁回归。
- 门禁基线对照照旧有效：warm e2e 6 条既有红（点击冷却×2/二级按钮/航线偏移/存档桥/开局取景）+ vitest 2 条红（FleetMaint/ShipCap，stash 已证）。跑法必须 npm run test:e2e:warm（playwright.e2e.config.ts），裸跑 npx playwright test 会 invalid URL。eslint 工具链损坏（v10 无 config），门禁=tsc+vitest+e2e。
- registerBuiltinComponents.ts 带 UTF-8 BOM，edit 后要补回（见记忆 edit_tool_strips_utf8_bom）。

## Effective Path

src/engine/tools/registerBuiltinComponents.ts
