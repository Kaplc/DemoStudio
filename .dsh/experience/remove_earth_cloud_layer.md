---
name: remove_earth_cloud_layer
task_type: refactor/code-removal
outcome: success
date: 2026-09-10
prefix: projects/warm-current || e2e/warm
---
## Summary

用户要求「地球不需要云层，可以移除这个组件」——定位到云层不在蓝图而是 EarthActor.setupCloseup() 运行时挂载，删挂载 + 清整条死代码链（earthCloudsUrl / 观察增益分支 / 文案）+ 修好坏掉的契约测试 + 补 e2e 回归锁；单测 316 全绿、warm e2e 新用例 3/3 绿（改动前基线必红，其余 6 条红为既有问题）。

## Lessons

- **多层外观先分层再动手**：星图天体 = 蓝图（Transform + SphereMesh，只定本体）+ StarActor.setupCloseup() 运行时 addComponent（云层/大气/bump）。只改 `asset/blueprints/stars/earth.blueprint.json` 是无效操作（里面根本没有 CloudLayerComponent）——"改地球外观"先看 `projects/warm-current/gameplay/map/StarActor.ts`。
- **移除一条表现链要顺手收死代码**，否则留半拉子：本次连带删掉 `starTextures.earthCloudsUrl()`（SSS 无云图 → 恒 null 的死导出）、`WarmCurrentGameMode.applyObserveBoost/resetObserveBoost` 里的云层 opacity 分支、注释/日志里的"云层/大气/bump"口径。判据：删完后 `grep CloudLayerComponent projects/` 应只剩引擎自身。
- **纯视觉移除也会让测试变红，必须同步契约测试**：同一天早些的"夜灯移除"把 `makeEarthNightTexture` 删了但没改 `tests/warm_earth_closeup.test.ts`，该文件一直在 import 已删除的符号（静默编译不过）。移除类任务结束时先跑相关单测文件，别让红灯无人认领。
- **引擎级能力 ≠ 项目级表现**：`src/engine/rendering/CloudLayerComponent`（+ registerBuiltinComponents 注册 + assetLint checker + tests/warm_planet_atmosphere）是通用能力，与"地球不要云"不是一回事。按字面"移除这个组件"只解挂载、保留引擎能力，并在汇报里主动点出"引擎组件现在零使用者，要不要一并删"——避免过度删除难回滚。
- **e2e 断言"运行时组件表"的正确口径**：`e2e/warm/earth_closeup.spec.ts` 用框架 fixtures（`test.use({ project: 'warm' })`）boot 到 running → `game.clickActor({name:'Btn_new'})` 进星图 → `waitForFunction(__warmCurrent.ready())` → `mode().togglePause()` 防自然 defeat 全屏 Dim 拦截。组件断言走构造器名：`ai.getSceneOutline` 的 `components`（= `getAllComponents().map(c => c.constructor.name)`）或 `__warmCurrent.mode().starActors.get('earth').getAllComponents()`。dev server 若已在 :5173，直接跑 playwright 即可。
- **"6 条红灯是不是我弄的"用基线对照回答**：`git stash push -m x -- <本改动的文件>` → 重跑同一批用例 → `git stash pop`（放 finally 里保证恢复，另留 TEMP 备份兜底）。本次基线证明 warm 全套里 6 条红（点击冷却/二级按钮/航线偏移/存档桥/开局取景）改动前就红，同时证明新写的 e2e 改动前必红——既排除回归，又证明回归锁真的有效。
- **门禁命令随沙箱状态变**：沙箱关时 `npx tsc --noEmit` / `npx vitest run` / `npm run test:e2e:warm` 正常；沙箱开（workspace-write）时 npx 与外部 exe 管道会被拒，要直连 node 二进制 + 对命令提权一次。详见记忆 root_lint_script_broken。

## Effective Path

projects/warm-current/gameplay/map/StarActor.ts || e2e/warm/earth_closeup.spec.ts
