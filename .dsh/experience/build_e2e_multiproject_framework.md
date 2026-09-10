---
name: build_e2e_multiproject_framework
task_type: feature
outcome: success
date: 2026-09-10
---
## Summary

在 e2e/ 下搭多项目共用 E2E 回归框架（Playwright fixtures + 通用 ai.* 事件断言 + 失败自动取证四件套），并按用户要求整理为一项目一文件夹（e2e/fish/、e2e/warm/）；fish 冒烟实跑全绿，新项目三步接入。

## Lessons

1) 启动按钮绝不能用 hasText '▶' 定位（大纲折叠箭头/agent 面板箭头都是 '▶'，.first() 是 DOM 序赌博，实测一次通过一次挂死 2 分钟）；MenuBar 启动按钮可访问名 "▶ Launch" 且仅 currentProject 就绪时渲染，getByRole 定位唯一且自带就绪语义。2) page.evaluate 的字符串按纯 JS 求值不经过 TS 转译，字符串里写 as 断言直接 SyntaxError；带类型的逻辑用函数形式（测试文件整体转译）。3) 运行时回执形状必须实测：ai.getHUD 实际返回 {ok, hud: 数组}（多根）而非 AIEvents.ts 注释暗示的单根；ai.getSceneOutline 同理；ai.getState 才是裸快照——以 registerBuiltinAIHandlers.ts 的 return 为准。4) 浏览器模式（MockElectronAPI）工程状态不持久，Launch 触发的整页重载偶发打回首页，boot 必须 waitRunningOrHome 双信号轮询 + 整轮重试而非干等超时。5) 失败取证先行设计极其划算：首轮两个断言 bug 全靠自动落盘的 game-hud.json/game-state.json 定位。6) 目录约定（用户定）：e2e/<项目>/ 一项目一文件夹，文件夹内文件不再带项目前缀（fish/smoke.spec.ts 而非 fish/fish.smoke.spec.ts），framework/ 与 README.md 留在 e2e/ 根。

## Effective Path

e2e/framework/（types/console/ai/projects/session/fixtures）+ e2e/<项目>/ 文件夹（fish/smoke.spec.ts、warm/*.spec.ts，一项目一文件夹）+ e2e/README.md + playwright.e2e.config.ts + package.json scripts（test:e2e*，按文件夹名过滤）+ doc/testing/e2e_framework.md
