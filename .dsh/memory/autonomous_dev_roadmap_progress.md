---
name: autonomous_dev_roadmap_progress
description: agent 自主开发游戏进化路线（P0-P3）与已落地进度：e2e 多项目回归框架（2026-09-10）
type: project
scope: private
prefix: [doc/testing/e2e_framework.md, e2e/framework/fixtures.ts]
---

**决策（2026-09-10）**：自主开发进化按 P0-P3 推进——P0 视觉闭环（截图/布局断言）+ 游戏启停工具；P1 playtest 回归 + 日志自愈；P2 git 安全网 + 设计上游模板；P3 程序化素材 + 经验自动提炼 skill + 多 agent 并行。回归框架用户选定建在 `e2e/`（Playwright + 通用 ai.* 事件），而非引擎侧 PlaytestRunner 方案。

**已落地**：e2e 多项目回归框架（fixtures + 失败取证四件套 + 新项目三步接入），fish 冒烟全绿；设计文档 `doc/testing/e2e_framework.md`，做事轨迹见经验 `build_e2e_multiproject_framework`。

**下一步候选**：日志自愈（消费 `test-results/e2e-report.json` + 证据附件）、视觉闭环截图、ds-engine-tools 加 playtest 触发工具。
