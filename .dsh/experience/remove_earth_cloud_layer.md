---
name: remove_earth_cloud_layer
task_type: refactor/code-removal
outcome: success
date: 2026-09-10
prefix: [projects/warm-current/asset/blueprints/stars/earth.blueprint.json, projects/warm-current/gameplay/map/StarActor.ts]
---
## Summary

（已更新）地球云层壳移除任务的原始轨迹保留；2026-09-10 晚些时候大气归属再次变更：用户决策"资产挂组件"，AtmosphereComponent 改为 earth.blueprint.json 显式声明，setupCloseup 不再运行时挂载，"蓝图只定本体"的结论对大气已过时。

## Lessons

- 【已过时，留作对比】本任务当时的结论"星图天体 = 蓝图只定本体（Transform+SphereMesh），大气/bump 由 StarActor.setupCloseup() 运行时挂载"——2026-09-10 用户决策"资产挂组件"后，大气已改为 earth.blueprint.json 显式声明（Inspector 调参随资产保存），setupCloseup 只剩 bump。现在动地球外观：大气参数在蓝图/Inspector 里改，bump 仍在 StarActor.ts。
- 多层外观先分层再动手的分层方法仍有效：星图天体 = 蓝图声明 + StarActor.setupCloseup() 运行时装配（现在只剩 bump）。改外观前先分清参数活在资产还是代码。
- 移除一条表现链要顺手收死代码（earthCloudsUrl/观察增益分支/文案）；纯视觉移除会让契约测试变红必须同步（tests/warm_earth_closeup.test.ts 曾因夜灯移除后 import 死符号编译不过）。
- 蓝图保存会全量写回运行时挂载组件 → 双实例叠辉光（本次大气事故的根因）；e2e earth_closeup 已加"大气恰好一个"断言锁回归（readEarthComponents 过滤计数）。
- 引擎级能力 ≠ 项目级表现：CloudLayerComponent 引擎组件仍保留（零使用者），与"地球不要云"是两回事。
- e2e 断言运行时组件表口径：构造器名（getAllComponents().map(c=>c.constructor.name)）；跑法 npm run test:e2e:warm；6 条既有基线红清单见 fix_inspector_getproperties_key_case 经验。

## Effective Path

projects/warm-current/gameplay/map/StarActor.ts
